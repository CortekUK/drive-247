'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Car,
  Percent,
  ShieldCheck,
  Receipt,
  Shield,
  Truck,
  MapPin,
  Package,
  CalendarPlus,
  DollarSign,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { useRentalCharges, type RentalCharge } from '@/hooks/use-rental-ledger-data';
import { useRentalInvoice, useRentalPaymentBreakdown, useRentalRefundBreakdown } from '@/hooks/use-rental-invoice';
import { useRentalInsurancePolicies } from '@/hooks/use-rental-insurance-policies';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface Rental {
  id: string;
  customer_id?: string;
  rental_period_type?: string | null;
  delivery_fee?: number | null;
  collection_fee?: number | null;
  deposit_hold_amount?: number | null;
  deposit_hold_status?: string | null;
  status?: string | null;
  approval_status?: string | null;
  has_installment_plan?: boolean | null;
  // PAYG fields — present on PAYG rentals, null/false otherwise.
  is_pay_as_you_go?: boolean | null;
  payg_start_ts?: string | null;
  payg_next_accrual_at?: string | null;
  payg_last_reminder_sent_at?: string | null;
  payg_reminder_count?: number | null;
  payg_reminder_interval_days?: number | null;
  payg_paused?: boolean | null;
  payg_closed_at?: string | null;
  payg_accrual_day_count?: number | null;
}

interface PaymentBreakdownProps {
  rental: Rental;
  customerEmail?: string | null;
  customerName?: string | null;
}

interface HoldMeta {
  deposit_hold_status?: string | null;
  deposit_hold_last_error?: string | null;
  deposit_hold_last_error_code?: string | null;
  deposit_hold_next_retry_at?: string | null;
}

interface Row {
  label: string;
  category: string;
  amount: number;
  detail: string;
  icon: any;
  color: string;
  bg: string;
}

// Renter-facing wording for the pre-auth hold. The DB column is only our
// claim about the hold, and it can now legitimately say things other than
// "held" — including states that need the CUSTOMER to act, which no amount of
// server-side retrying can fix. Say so plainly rather than flattening every
// non-`held` value into a blank "Refundable deposit".
const HOLD_DETAIL_COPY: Record<string, string> = {
  held: 'On hold',
  processing: 'Being placed',
  refreshing: 'Being renewed',
  capturing: 'Being charged',
  requires_action: 'Needs your attention',
  // `failed` carries a scheduled retry — it is not a dead end, so don't word it
  // like one.
  failed: 'Retrying automatically',
  needs_review: "We're checking this",
  disputed: 'Under dispute',
  captured: 'Charged',
  released: 'Released',
  expired: 'No longer held',
};

// Not a DB status — the placement failed and the status was rolled back to
// NULL, which otherwise renders as an ordinary "no hold yet" row.
const NOT_PLACED_DETAIL = "Couldn't be placed";
const NOT_PLACED_BADGE = {
  label: 'Not placed',
  cls: 'text-red-500 border-red-500/30 bg-red-500/10',
};

const HOLD_BADGE_COPY: Record<string, { label: string; cls: string }> = {
  held: { label: 'Held', cls: 'text-amber-500 border-amber-500/30 bg-amber-500/10' },
  processing: { label: 'Processing', cls: 'text-blue-500 border-blue-500/30 bg-blue-500/10' },
  refreshing: { label: 'Renewing', cls: 'text-indigo-500 border-indigo-500/30 bg-indigo-500/10' },
  capturing: { label: 'Charging', cls: 'text-purple-500 border-purple-500/30 bg-purple-500/10' },
  requires_action: {
    label: 'Action needed',
    cls: 'text-orange-500 border-orange-500/30 bg-orange-500/10',
  },
  failed: { label: 'Not held', cls: 'text-red-500 border-red-500/30 bg-red-500/10' },
  needs_review: { label: 'Checking', cls: 'text-amber-500 border-amber-500/30 bg-amber-500/10' },
  disputed: { label: 'Disputed', cls: 'text-red-500 border-red-500/30 bg-red-500/10' },
  captured: { label: 'Charged', cls: 'text-red-500 border-red-500/30 bg-red-500/10' },
  released: { label: 'Released', cls: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' },
  expired: { label: 'Expired', cls: 'text-muted-foreground border-muted-foreground/30' },
};

// `requires_action` is written for THREE different reasons and only one of them
// involves the bank: genuine SCA (`authentication_required`), a card that is
// unusable after we re-resolved the payment method, and no usable card on file
// at all. The last two are fixed by adding a working card — telling those
// renters to look for an approval prompt in their banking app sends them
// somewhere nothing will ever arrive. `deposit_hold_last_error_code` is the
// only signal that separates them, so when we have it we branch on it, and
// when we don't we say something that is true for all three.
const SCA_ERROR_CODES = new Set([
  'authentication_required',
  'payment_intent_authentication_failure',
]);

// Codes that mean "this card cannot be used" — the fix is a different card.
const CARD_PROBLEM_CODES = new Set([
  'no_payment_method',
  'card_declined',
  'expired_card',
  'incorrect_number',
  'incorrect_cvc',
  'invalid_cvc',
  'invalid_number',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'lost_card',
  'stolen_card',
  'pickup_card',
  'restricted_card',
  'card_not_supported',
  'card_velocity_exceeded',
  'currency_not_supported',
  'do_not_honor',
  'transaction_not_allowed',
  'invalid_account',
  'account_closed',
  'insufficient_funds',
  'withdrawal_count_limit_exceeded',
]);

// KNOWN LIMITATION (tracked against `update-payment-method`, not fixable here):
// that function resolves the Stripe account from the tenant's CURRENT config
// rather than from the rental's anchored `platform_account`. For a tenant
// mid UK→UAE flip, a card saved from this page lands on the new account's
// Stripe customer while a UK-anchored hold chain re-resolves the payment
// method on the old one, so the advertised fix silently does nothing. No
// tenant with live holds is mid-flip today; the fix belongs in that function.
const UPDATE_CARD_HINT = '“Update Card” on the Payments page';

type HoldGuidance = { text: string; cls: string };

const ACTION_CLS = 'text-orange-600 dark:text-orange-400';
const CALM_CLS = 'text-muted-foreground';

// `failed` is the AUTO-RECOVERING state: the hold engine writes it together
// with a scheduled retry for transient and soft-decline failures and tries
// again on a backoff. Asking the renter to do something here is wrong — the
// states that genuinely need them are `requires_action` and a placement that
// never happened at all.
function retryPhrase(nextRetryAt?: string | null): string {
  if (!nextRetryAt) return 'We’ll try again automatically.';
  const ms = new Date(nextRetryAt).getTime();
  if (Number.isNaN(ms)) return 'We’ll try again automatically.';
  const mins = Math.round((ms - Date.now()) / 60000);
  if (mins <= 1) return 'We’ll try again automatically, shortly.';
  if (mins < 60) return `We’ll try again automatically in about ${mins} minutes.`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `We’ll try again automatically in about ${hours} hour${hours === 1 ? '' : 's'}.`;
  return `We’ll try again automatically in about ${Math.round(hours / 24)} days.`;
}

function holdGuidanceFor(
  status: string | null | undefined,
  errorCode: string | null | undefined,
  lastError: string | null | undefined,
  nextRetryAt: string | null | undefined
): HoldGuidance | undefined {
  const code = (errorCode || '').toLowerCase();

  // Hold was never placed: `place-deposit-hold` rolls the status back to empty
  // on failure but leaves the error behind, so this looks like "no hold" unless
  // we go looking for the error.
  if (!status && lastError) {
    return CARD_PROBLEM_CODES.has(code)
      ? {
          text: `We couldn’t place the security-deposit hold on your card. Adding a working card with ${UPDATE_CARD_HINT} will let us try again.`,
          cls: ACTION_CLS,
        }
      : {
          text: `We couldn’t place the security-deposit hold on your card yet. If it doesn’t clear shortly, check your card with ${UPDATE_CARD_HINT}.`,
          cls: ACTION_CLS,
        };
  }

  if (status === 'requires_action') {
    if (SCA_ERROR_CODES.has(code)) {
      return {
        text: 'Your bank needs you to approve this hold. Check your banking app or a message from your bank and confirm it — this step can only be done by you.',
        cls: ACTION_CLS,
      };
    }
    if (CARD_PROBLEM_CODES.has(code)) {
      return {
        text: `We need a working card for this hold — your current one can’t be used. Add one with ${UPDATE_CARD_HINT}.`,
        cls: ACTION_CLS,
      };
    }
    // Cause unknown. Lead with the fix that is right in two of the three cases
    // and still harmless in the third.
    return {
      text: `This hold needs you. Start with ${UPDATE_CARD_HINT} to make sure we have a working card — and if your bank has asked you to approve the hold instead, confirm it in your banking app.`,
      cls: ACTION_CLS,
    };
  }

  if (status === 'failed') {
    return {
      text: `This hold didn’t go through. ${retryPhrase(nextRetryAt)} Nothing for you to do — we’ll get in touch if we need a different card.`,
      cls: CALM_CLS,
    };
  }

  if (status === 'needs_review') {
    return {
      text: 'We’re looking into this hold. Nothing for you to do right now — our team will contact you if anything is needed from you.',
      cls: CALM_CLS,
    };
  }

  return undefined;
}

const EXT_CATEGORIES = [
  'Extension',
  'Extension Rental',
  'Extension Tax',
  'Extension Service Fee',
  'Extension Insurance',
];

export default function PaymentBreakdown({ rental, customerEmail, customerName }: PaymentBreakdownProps) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const isPayg = rental?.is_pay_as_you_go === true;

  const { data: rawInvoice } = useRentalInvoice(rental.id);
  const { data: rentalCharges } = useRentalCharges(rental.id);
  const { data: paymentBreakdown } = useRentalPaymentBreakdown(rental.id);
  const { data: refundBreakdown } = useRentalRefundBreakdown(rental.id);
  const { data: insurancePolicies } = useRentalInsurancePolicies(rental.id);

  // The hold columns the parent page does not select. Fetched here rather than
  // widened upstream so this component owns everything it needs to describe the
  // hold honestly — in particular the error code, without which we cannot tell
  // an SCA prompt from a dead card, and the retry time, without which we would
  // tell renters to act on a state the system fixes by itself.
  const { data: holdMeta } = useQuery({
    queryKey: ['rental-hold-meta', rental.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rentals')
        .select(
          'deposit_hold_status, deposit_hold_last_error, deposit_hold_last_error_code, deposit_hold_next_retry_at'
        )
        .eq('id', rental.id)
        .maybeSingle();
      if (error) throw error;
      return (data as HoldMeta | null) ?? null;
    },
    enabled: !!rental.id,
  });

  // When the extra read fails or has not landed we fall back to the status the
  // parent already had. Guidance then degrades to the cause-neutral wording
  // rather than to a confident claim about a cause we cannot see.
  // Charged-deposit tenants never place a hold: the deposit is an ordinary
  // charge on the invoice, refunded (in full or in part) at the end of the
  // rental. Neutralising the hold inputs at this one point switches off every
  // hold badge, status line and piece of guidance downstream, rather than
  // special-casing each render site.
  const depositIsCharged = tenant?.deposit_charge_enabled === true;
  const holdStatus = (depositIsCharged
    ? null
    : (holdMeta ? holdMeta.deposit_hold_status : rental.deposit_hold_status)) as
    | string
    | null
    | undefined;
  const holdLastError = depositIsCharged ? null : (holdMeta?.deposit_hold_last_error ?? null);
  // A hold that was never placed: status rolled back to NULL, error left behind.
  const holdNotPlaced = !depositIsCharged && !holdStatus && !!holdLastError;
  const holdGuidance = depositIsCharged ? undefined : holdGuidanceFor(
    holdStatus,
    holdMeta?.deposit_hold_last_error_code ?? null,
    holdLastError,
    holdMeta?.deposit_hold_next_retry_at ?? null
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedOriginal, setSelectedOriginal] = useState<Set<string>>(new Set());
  // Map of extension number → selected categories
  const [selectedExt, setSelectedExt] = useState<Record<number, Set<string>>>({});

  // PAYG rentals have no upfront invoice — synthesise an invoice-shaped object
  // from ledger_entries so the Payment Breakdown card can render. Regular rentals
  // keep using the real invoice row untouched.
  const invoice = useMemo(() => {
    if (rawInvoice) return rawInvoice;
    if (!isPayg) return null;

    const sumBy = (cat: string) =>
      (rentalCharges || [])
        .filter((c) => c.category === cat)
        .reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const rentalFee = sumBy('Rental');
    const taxAmount = sumBy('Tax');
    const serviceFee = sumBy('Service Fee');
    const insurancePremium = sumBy('Insurance');
    const deliveryFee = sumBy('Delivery Fee');
    const extrasTotal = sumBy('Extras');

    return {
      id: 'payg-synthetic',
      rentalFee,
      taxAmount,
      serviceFee,
      securityDeposit: 0,
      insurancePremium,
      deliveryFee,
      extrasTotal,
      totalAmount: rentalFee + taxAmount + serviceFee + insurancePremium + deliveryFee + extrasTotal,
      status: rental?.payg_closed_at ? 'closed' : 'active',
    } as NonNullable<typeof rawInvoice>;
  }, [rawInvoice, isPayg, rentalCharges, rental?.payg_closed_at]);

  // PAYG-accrued categories (Rental always; Tax if tenant taxes; Service Fee only
  // when the tenant uses percentage-based fees since fixed-amount service fees
  // are a one-off upfront charge, not accrued daily).
  const paygCategories = useMemo(() => {
    if (!isPayg) return [] as string[];
    const cats: string[] = ['Rental'];
    if ((Number(tenant?.tax_percentage) || 0) > 0) cats.push('Tax');
    if (tenant?.service_fee_type === 'percentage' && (Number(tenant?.service_fee_value) || 0) > 0) {
      cats.push('Service Fee');
    }
    return cats;
  }, [isPayg, tenant?.tax_percentage, tenant?.service_fee_type, tenant?.service_fee_value]);

  // categoryRemainingAmounts — from ledger
  const categoryRemainingAmounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    if (paymentBreakdown) {
      Object.entries(paymentBreakdown).forEach(([cat, t]) => {
        out[cat] = t.remaining;
      });
    }
    return out;
  }, [paymentBreakdown]);

  // Group extension charges by extension number
  const extensionGroups = useMemo(() => {
    const allExt = (rentalCharges || []).filter((c) => EXT_CATEGORIES.includes(c.category));
    const groups: Record<number, RentalCharge[]> = {};
    let nextLegacy = 1;
    allExt.forEach((charge) => {
      const m = charge.reference?.match(/Extension #(\d+)/);
      const n = m ? parseInt(m[1], 10) : nextLegacy++;
      if (!groups[n]) groups[n] = [];
      groups[n].push(charge);
    });
    const extPolicies = (insurancePolicies || [])
      .filter((p: any) => p.policy_type === 'extension')
      .sort(
        (a: any, b: any) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    return Object.entries(groups)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([num, charges], idx) => {
        // Any charge in the group whose extension_id is stamped is authoritative.
        // All charges that share a group should resolve to the same extension_id.
        const stampedCharge = charges.find((c) => c.extension_id);
        return {
          extensionNumber: parseInt(num),
          extensionId: stampedCharge?.extension_id ?? null,
          charges,
          totalAmount: charges.reduce((s, c) => s + c.amount, 0),
          totalRemaining: charges.reduce((s, c) => s + c.remaining_amount, 0),
          rentalCharge: charges.find(
            (c) => c.category === 'Extension Rental' || c.category === 'Extension'
          ),
          insurancePolicy: extPolicies[idx] || null,
        };
      });
  }, [rentalCharges, insurancePolicies]);

  const originalBonzah = (insurancePolicies || []).find(
    (p: any) => p.policy_type !== 'extension'
  );

  // Invoke checkout for a set of categories and a total.
  // `extensionId` scopes the payment to a specific rental_extension so the
  // server can apply it to THAT extension's charges instead of FIFO-draining
  // the customer's entire outstanding balance.
  const payCategories = async (
    totalAmount: number,
    targetCategories: string[],
    extensionId?: string | null,
    paygAccrualId?: string | null,
  ) => {
    if (!tenant?.id || totalAmount <= 0) return;
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: rental.id,
          totalAmount,
          tenantId: tenant.id,
          customerEmail,
          source: 'booking',
          targetCategories,
          ...(extensionId ? { extensionId } : {}),
          ...(paygAccrualId ? { paygAccrualId } : {}),
          successUrl: `${window.location.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rental.id}&type=invoice`,
          cancelUrl: `${window.location.origin}/portal/bookings/${rental.id}`,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error('Failed to create payment link');
      }
    } catch (e) {
      toast.error('Failed to create payment link');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!invoice) return null;

  const isCancelledOrRejected =
    rental.status === 'Cancelled' || rental.approval_status === 'rejected';

  // Build original rows
  const insuranceCharge = (rentalCharges || []).find((c) => c.category === 'Insurance');
  const insuranceAmount = insuranceCharge?.amount ?? invoice.insurancePremium ?? 0;
  const deliveryFeeAmount = rental.delivery_fee || invoice.deliveryFee || 0;
  const collectionFeeAmount =
    (rentalCharges || []).find((c) => c.category === 'Collection Fee')?.amount ??
    rental.collection_fee ??
    0;

  const originalRows: Row[] = [
    {
      label: 'Rental',
      category: 'Rental',
      amount: invoice.rentalFee,
      detail: rental.rental_period_type || 'Monthly',
      icon: Car,
      color: 'text-green-500',
      bg: 'bg-green-500/10',
    },
    {
      label: 'Tax',
      category: 'Tax',
      amount: invoice.taxAmount,
      detail:
        invoice.taxAmount > 0 && invoice.rentalFee > 0
          ? `${((invoice.taxAmount / invoice.rentalFee) * 100).toFixed(1)}% rate`
          : 'Tax on rental',
      icon: Percent,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      label: originalBonzah ? 'Bonzah Insurance' : 'Insurance',
      category: 'Insurance',
      amount: insuranceAmount,
      detail: originalBonzah ? 'Bonzah Insurance' : 'Insurance coverage',
      icon: ShieldCheck,
      color: 'text-teal-500',
      bg: 'bg-teal-500/10',
    },
    {
      label: 'Service Fee',
      category: 'Service Fee',
      amount: invoice.serviceFee,
      detail: 'Platform fee',
      icon: Receipt,
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
    },
    {
      label: depositIsCharged ? 'Security Deposit' : 'Pre-Auth Hold',
      category: 'Security Deposit',
      // Charged path reads the ledger like any other category; deposit_hold_*
      // is stale history there and must not be consulted.
      amount: depositIsCharged
        ? (paymentBreakdown?.['Security Deposit']?.total || invoice.securityDeposit)
        : (rental.deposit_hold_amount || invoice.securityDeposit),
      detail: depositIsCharged
        ? (((paymentBreakdown?.['Security Deposit']?.total ?? 0) > 0 &&
            (paymentBreakdown?.['Security Deposit']?.remaining ?? 0) <= 0)
              ? 'Paid — refunded after your rental'
              : 'Refundable deposit')
        : (holdNotPlaced
            ? NOT_PLACED_DETAIL
            : HOLD_DETAIL_COPY[holdStatus || ''] || 'Refundable deposit'),
      icon: Shield,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Delivery Fee',
      category: 'Delivery Fee',
      amount: deliveryFeeAmount,
      detail: 'Vehicle delivery',
      icon: Truck,
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
    },
    {
      label: 'Collection Fee',
      category: 'Collection Fee',
      amount: collectionFeeAmount,
      detail: 'Vehicle collection',
      icon: MapPin,
      color: 'text-rose-500',
      bg: 'bg-rose-500/10',
    },
    {
      label: 'Extras',
      category: 'Extras',
      amount: invoice.extrasTotal,
      detail: 'Add-ons',
      icon: Package,
      color: 'text-indigo-500',
      bg: 'bg-indigo-500/10',
    },
  ];

  // Excess mileage
  const excessMileage = (rentalCharges || []).find((c) => c.category === 'Excess Mileage');
  if (excessMileage) {
    originalRows.push({
      label: 'Excess Mileage',
      category: 'Excess Mileage',
      amount: excessMileage.amount,
      detail: excessMileage.reference || 'Over mileage allowance',
      icon: Receipt,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    });
  }

  // PAYG rentals: strip PAYG-accrued categories from this fixed-charges breakdown
  // (they live in the PaygSection rendered separately, above this component).
  if (isPayg) {
    for (let i = originalRows.length - 1; i >= 0; i--) {
      if (paygCategories.includes(originalRows[i].category)) {
        originalRows.splice(i, 1);
      }
    }
  }

  const renderTable = (
    rows: Row[],
    selected: Set<string>,
    setSelected: (s: Set<string>) => void,
    extensionId?: string | null,
    sectionIsPayg: boolean = false,
  ) => {
    // For PAYG sections (the Original Rental table on a PAYG rental): sort PAYG
    // categories to the top so the blue-tinted rows form one contiguous group,
    // matching the admin portal's layout.
    const orderedRows = sectionIsPayg
      ? [...rows].sort((a, b) => {
          const aPayg = paygCategories.includes(a.category);
          const bPayg = paygCategories.includes(b.category);
          if (aPayg && !bPayg) return -1;
          if (!aPayg && bPayg) return 1;
          return 0;
        })
      : rows;
    // A row is selectable (= customer can pay for it) when it has an amount
    // and is not already fully paid. "Fully paid" means a ledger charge
    // exists AND its remaining is 0. When no charge exists yet (fresh rental,
    // ledger not primed), the category is NOT paid and is selectable —
    // apply-payment creates the ledger charge on the fly.
    const chargesForRow = (category: string) => {
      const isExt = category.startsWith('Extension');
      return (rentalCharges || []).filter((c) => {
        if (c.category !== category) return false;
        if (isExt && extensionId) return c.extension_id === extensionId;
        return true;
      });
    };

    const selectable = orderedRows
      .filter((r) => {
        if (r.amount <= 0) return false;
        if (r.category === 'Security Deposit') return false; // handled via Pre-Auth Hold, not this pay flow
        const charges = chargesForRow(r.category);
        const total = charges.reduce((s, c) => s + Number(c.amount), 0);
        const remaining = charges.reduce((s, c) => s + Number(c.remaining_amount), 0);
        const fullyPaid = charges.length > 0 && total > 0 && remaining <= 0;
        return !fullyPaid;
      })
      .map((r) => r.category);

    // Amount-to-pay per selectable category: outstanding ledger balance when
    // charges exist; otherwise the row's own amount (invoice value) since
    // we'll create the charge on pay.
    const amountToPay = (category: string, rowAmount: number): number => {
      const charges = chargesForRow(category);
      if (charges.length === 0) return rowAmount;
      return charges.reduce((s, c) => s + Number(c.remaining_amount), 0);
    };

    const allSelected =
      selectable.length > 0 && selectable.every((c) => selected.has(c));
    const someSelected = selectable.some((c) => selected.has(c));

    const selectedTotal =
      Math.round(
        orderedRows
          .filter((r) => selected.has(r.category))
          .reduce((sum, r) => sum + amountToPay(r.category, r.amount), 0) * 100
      ) / 100;

    const toggle = (category: string) => {
      const next = new Set(selected);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      setSelected(next);
    };

    const toggleAll = () => {
      if (allSelected) setSelected(new Set());
      else setSelected(new Set(selectable));
    };

    return (
      <>
        <Table>
          <TableHeader>
            <TableRow>
              {selectable.length > 0 && (
                <TableHead className="pl-6 w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all unpaid"
                  />
                </TableHead>
              )}
              <TableHead className={selectable.length > 0 ? '' : 'pl-6'}>Category</TableHead>
              <TableHead className="w-[110px]">Mode</TableHead>
              <TableHead className="text-center w-[110px]">Status</TableHead>
              <TableHead className="text-right w-[110px]">Amount</TableHead>
              <TableHead className="text-right w-[110px]">Refunded</TableHead>
              <TableHead className="text-right pr-6 w-[120px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orderedRows.map(({ label, category, amount, detail, icon: Icon, color, bg }, idx) => {
              // PAYG grouping: spot the transition from PAYG block to non-PAYG rows
              // so we can drop an indigo divider between them. Matches the admin layout.
              const thisIsPayg = sectionIsPayg && paygCategories.includes(category);
              const prevRow = idx > 0 ? orderedRows[idx - 1] : null;
              const prevIsPayg = sectionIsPayg && prevRow && paygCategories.includes(prevRow.category);
              const isFirstNonPaygAfterPayg = sectionIsPayg && !thisIsPayg && prevIsPayg;
              // PAYG rows are filtered out of this breakdown (handled in PaygSection),
              // so no click handler is needed here.
              const rowOnClick = undefined;
              // Mode badge: PAYG > Installments > Regular.
              const rowMode: 'PAYG' | 'Installments' | 'Regular' = thisIsPayg
                ? 'PAYG'
                : (!thisIsPayg && rental.has_installment_plan && ['Rental', 'Tax', 'Extras'].includes(category))
                  ? 'Installments'
                  : 'Regular';
              const applied = amount > 0;
              // Scope by extension_id when rendering an extension table so two
              // extensions with the same "Extension Rental" category don't
              // collide. For original rows, extensionId is undefined and all
                    // charges with that category are in scope.
              const isExtensionCategory = category.startsWith('Extension');
              const catCharges = (rentalCharges || []).filter((c) => {
                if (c.category !== category) return false;
                if (isExtensionCategory && extensionId) return c.extension_id === extensionId;
                return true;
              });
              const catChargeTotal = catCharges.reduce((s, c) => s + Number(c.amount), 0);
              const catChargeRemaining = catCharges.reduce((s, c) => s + Number(c.remaining_amount), 0);
              const catAllocated = catCharges.reduce(
                (s, c) => s + c.allocations.reduce((ss, a) => ss + Number(a.amount_applied), 0),
                0
              );
              const isSecurityDeposit = category === 'Security Deposit';
              // The hold row carries meaning even when no money was ever taken
              // — "we couldn't place it" is exactly the case where the amount
              // is missing, and it must not be flattened into "Not applied".
              const showHoldState =
                isSecurityDeposit && (!!holdStatus || holdNotPlaced);
              const rowGuidance = isSecurityDeposit ? holdGuidance : undefined;
              const refunded = isExtensionCategory && extensionId
                ? (refundBreakdown?.extensionCategoryRefunds?.[`${extensionId}|${category}`] ?? 0)
                : (refundBreakdown?.categoryRefunds?.[category] ?? 0);
              const fullyRefunded = !isSecurityDeposit && applied && refunded > 0 && refunded >= amount;
              const hasPartialRefund = !isSecurityDeposit && refunded > 0 && !fullyRefunded;
              const isPaid = !isSecurityDeposit && !fullyRefunded && !hasPartialRefund && catCharges.length > 0 && catChargeTotal > 0 && catChargeRemaining <= 0;
              const isPartial = !isSecurityDeposit && !fullyRefunded && !hasPartialRefund && catAllocated > 0 && catChargeRemaining > 0;
              const hasUnpaid = applied && !isSecurityDeposit && !fullyRefunded && !isPaid;
              const remaining = catChargeRemaining;
              const isSelectable = selectable.includes(category);
              const isSelected = selected.has(category);

              return (
                <Fragment key={category}>
                <TableRow
                  className={`${(!applied && !showHoldState) && !thisIsPayg ? 'opacity-40' : ''} ${rowOnClick ? 'cursor-pointer hover:bg-muted/30' : ''} ${thisIsPayg ? 'bg-indigo-50 dark:bg-indigo-950/20' : ''} ${isFirstNonPaygAfterPayg ? 'border-t-4 border-t-indigo-200 dark:border-t-indigo-800/60' : ''}`}
                  onClick={rowOnClick}
                >
                  {selectable.length > 0 && (
                    <TableCell className="pl-6 w-10" onClick={(e) => e.stopPropagation()}>
                      {isSelectable ? (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggle(category)}
                          aria-label={`Select ${label}`}
                        />
                      ) : null}
                    </TableCell>
                  )}
                  <TableCell className={selectable.length > 0 ? '' : 'pl-6'}>
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-7 w-7 rounded-full flex items-center justify-center ${applied ? bg : 'bg-muted/30'}`}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 ${applied ? color : 'text-muted-foreground/50'}`}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium flex items-center gap-1.5">
                          {label}
                          {rowOnClick && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {applied || showHoldState ? detail : 'Not applied'}
                        </p>
                        {rowGuidance && (
                          <p className={`text-xs mt-1 max-w-[26rem] ${rowGuidance.cls}`}>
                            {rowGuidance.text}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        rowMode === 'PAYG'
                          ? 'text-indigo-600 border-indigo-300 bg-indigo-100 dark:text-indigo-400 dark:border-indigo-700 dark:bg-indigo-950/30 text-[11px]'
                          : rowMode === 'Installments'
                            ? 'text-violet-600 border-violet-300 bg-violet-100 dark:text-violet-400 dark:border-violet-700 dark:bg-violet-950/30 text-[11px]'
                            : 'text-muted-foreground border-muted-foreground/20 text-[11px]'
                      }
                    >
                      {rowMode}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {(() => {
                      // HOLD path only. An authorisation has hold states, not
                      // payment states, so "Paid" would be wrong for it.
                      //
                      // A CHARGED deposit is a real debit on the customer's card
                      // and belongs on the same Paid / Partially Paid / Refunded
                      // ladder as every other line. Short-circuiting here showed
                      // them "No Hold" against money that had actually left their
                      // account — which reads as though nothing was taken.
                      if (isSecurityDeposit && !depositIsCharged) {
                        // Every status the column can carry gets its own badge,
                        // plus the statusless-but-errored row that means the
                        // hold was attempted and never landed. Anything else
                        // falls through to "No Hold", which is only correct
                        // when there genuinely is no hold and no failure.
                        if (holdNotPlaced)
                          return <Badge variant="outline" className={`${NOT_PLACED_BADGE.cls} text-[11px]`}>{NOT_PLACED_BADGE.label}</Badge>;
                        const holdBadge = HOLD_BADGE_COPY[holdStatus || ''];
                        if (holdBadge)
                          return <Badge variant="outline" className={`${holdBadge.cls} text-[11px]`}>{holdBadge.label}</Badge>;
                        return <Badge variant="outline" className="text-muted-foreground/60 border-muted-foreground/20 text-[11px]">No Hold</Badge>;
                      }
                      if (!applied)
                        return <Badge variant="outline" className="text-muted-foreground/60 border-muted-foreground/20 text-[11px]">Not Applied</Badge>;
                      if (fullyRefunded)
                        return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Refunded</Badge>;
                      if (hasPartialRefund)
                        return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Partial Refund</Badge>;
                      if (isPaid)
                        return <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[11px]">Paid</Badge>;
                      if (isPartial)
                        return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Partially Paid</Badge>;
                      if (isCancelledOrRejected)
                        return <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 text-[11px]">Cancelled</Badge>;
                      return <Badge variant="outline" className="text-red-500 border-red-500/30 bg-red-500/10 text-[11px]">Not Paid</Badge>;
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`text-sm font-semibold ${!applied ? 'text-muted-foreground/50' : ''}`}
                    >
                      {formatCurrency(amount, currencyCode)}
                    </span>
                    {isPartial && (
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(remaining, currencyCode)} remaining
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {refunded > 0 ? (
                      <span className="text-sm text-amber-500 font-medium">
                        {formatCurrency(refunded, currencyCode)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground/40">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                    {hasUnpaid && !isCancelledOrRejected ? (
                      <button
                        className="text-xs font-medium text-blue-500 hover:text-blue-400 hover:underline disabled:opacity-50"
                        disabled={isProcessing}
                        onClick={(e) => {
                          e.stopPropagation();
                          payCategories(amountToPay(category, amount), [category], extensionId);
                        }}
                      >
                        Pay
                      </button>
                    ) : (
                      <span className="text-muted-foreground/30">-</span>
                    )}
                  </TableCell>
                </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>

        {selected.size > 0 && (
          <div className="sticky bottom-0 border-t bg-primary/10 border-primary/30 px-6 py-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {selected.size} item{selected.size > 1 ? 's' : ''} selected &mdash;{' '}
              <span className="font-semibold text-foreground">
                {formatCurrency(selectedTotal, currencyCode)}
              </span>
            </p>
            <Button
              size="sm"
              disabled={isProcessing}
              onClick={() =>
                payCategories(
                  selectedTotal,
                  Array.from(selected).filter((c) => selectable.includes(c)),
                  extensionId
                )
              }
            >
              {isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <DollarSign className="h-3.5 w-3.5 mr-1.5" />
              )}
              Pay Selected
            </Button>
          </div>
        )}
      </>
    );
  };

  // Build extension row set for a group
  const renderExtensionTable = (group: (typeof extensionGroups)[number]) => {
    const refCharge = group.rentalCharge;
    const dateMatch = refCharge?.reference?.match(/\((.+?) → (.+?)\)/);
    const fromDate = dateMatch?.[1] || '';
    const toDate = dateMatch?.[2] || '';
    const daysMatch = refCharge?.reference?.match(/(\d+) day/);
    const extDays = daysMatch?.[1] || '';
    const dateDetail = extDays
      ? `${extDays} day${extDays !== '1' ? 's' : ''} (${fromDate} → ${toDate})`
      : refCharge?.reference || `Extension #${group.extensionNumber}`;

    const extRental = group.charges.find(
      (c) => c.category === 'Extension Rental' || c.category === 'Extension'
    );
    const tax = group.charges.find((c) => c.category === 'Extension Tax');
    const svcFee = group.charges.find((c) => c.category === 'Extension Service Fee');
    const insCharge = group.charges.find((c) => c.category === 'Extension Insurance');
    const insPolicy = group.insurancePolicy as any;
    const insuranceAmt = insCharge?.amount ?? insPolicy?.premium_amount ?? 0;

    const extRows: Row[] = [
      {
        label: 'Rental',
        category: extRental?.category || 'Extension Rental',
        amount: extRental?.amount ?? 0,
        detail: dateDetail,
        icon: Car,
        color: 'text-green-500',
        bg: 'bg-green-500/10',
      },
      {
        label: 'Tax',
        category: tax?.category || 'Extension Tax',
        amount: tax?.amount ?? 0,
        detail:
          tax && extRental
            ? `${((tax.amount / extRental.amount) * 100).toFixed(1)}% rate`
            : 'Tax on rental',
        icon: Percent,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
      },
      {
        label: insPolicy ? 'Bonzah Insurance' : 'Insurance',
        category: 'Extension Insurance',
        amount: insuranceAmt,
        detail: insPolicy ? 'Bonzah Insurance' : 'Insurance coverage',
        icon: ShieldCheck,
        color: 'text-teal-500',
        bg: 'bg-teal-500/10',
      },
      {
        label: 'Service Fee',
        category: svcFee?.category || 'Extension Service Fee',
        amount: svcFee?.amount ?? 0,
        detail: 'Platform fee',
        icon: Receipt,
        color: 'text-purple-500',
        bg: 'bg-purple-500/10',
      },
    ];

    const selected = selectedExt[group.extensionNumber] || new Set<string>();
    const setSelected = (s: Set<string>) =>
      setSelectedExt((prev) => ({ ...prev, [group.extensionNumber]: s }));

    return renderTable(extRows, selected, setSelected, group.extensionId);
  };

  const hasExtensions = extensionGroups.length > 0;

  // For pure PAYG rentals with no extras/fines/excess mileage and no extensions,
  // the fixed-charges breakdown has nothing left to render — hide the card entirely.
  const hasNonZeroOriginalRow = originalRows.some((r) => r.amount > 0);
  if (isPayg && !hasExtensions && !hasNonZeroOriginalRow) return null;

  if (!hasExtensions) {
    return (
      <Card className={isProcessing ? 'opacity-50 pointer-events-none' : ''}>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-medium">Payment Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {renderTable(originalRows, selectedOriginal, setSelectedOriginal, undefined, isPayg)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={isProcessing ? 'opacity-50 pointer-events-none' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Payment Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Accordion type="single" defaultValue="original" className="w-full space-y-3 px-4 pb-4">
          <AccordionItem value="original" className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline bg-green-500/5 data-[state=open]:border-b">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Car className="h-3 w-3 text-green-500" />
                </div>
                <span className="text-sm font-medium">Original Rental</span>
                <Badge variant="outline" className="text-[10px] ml-1">
                  {formatCurrency(invoice.totalAmount, currencyCode)}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-0 pb-0">
              {renderTable(originalRows, selectedOriginal, setSelectedOriginal, undefined, isPayg)}
            </AccordionContent>
          </AccordionItem>

          {extensionGroups.map((group) => {
            const hasInsuranceCharge = group.charges.some(
              (c) => c.category === 'Extension Insurance'
            );
            const extInsAmt = hasInsuranceCharge
              ? 0
              : (group.insurancePolicy as any)?.premium_amount ?? 0;
            const extTotal = group.totalAmount + extInsAmt;
            return (
              <AccordionItem
                key={`ext-${group.extensionNumber}`}
                value={`extension-${group.extensionNumber}`}
                className="border rounded-lg overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline bg-blue-500/5 data-[state=open]:border-b">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-500/10 flex items-center justify-center">
                      <CalendarPlus className="h-3 w-3 text-blue-500" />
                    </div>
                    <span className="text-sm font-medium">
                      Extension #{group.extensionNumber}
                    </span>
                    <Badge variant="outline" className="text-[10px] ml-1">
                      {formatCurrency(extTotal, currencyCode)}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-0 pb-0">
                  {renderExtensionTable(group)}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
