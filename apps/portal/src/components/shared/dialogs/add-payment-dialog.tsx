import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CalendarIcon, DollarSign, Loader2, Banknote, CreditCard, Building2, Smartphone, FileText, MoreHorizontal, ExternalLink, Mail, ChevronDown, Info, ShieldAlert, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { useAuth } from "@/stores/auth-store";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useTenant } from "@/contexts/TenantContext";
/** Stripe's mark, rendered inline so this file carries no provider indirection. */
function StripeMark({ className = "w-4 h-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#635BFF" aria-hidden="true">
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
    </svg>
  );
}
import { bookingOriginFor } from "@/lib/booking-origin";
import { useCustomerVehicleRental } from "@/hooks/use-customer-vehicle-rental";
import { useCustomerBalanceWithStatus, useRentalChargesAndPayments } from "@/hooks/use-customer-balance";
import { createInvoice } from "@/lib/invoice-utils";
import { extractFunctionError } from "@/lib/edge-error";
import { cn } from "@/lib/utils";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";

const paymentSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  vehicle_id: z.string().optional(),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  payment_date: z.date({
    required_error: "Payment date is required",
  }),
  method: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface BreakdownItem {
  label: string;
  amount: number;
  type?: 'discount' | 'normal';
}

interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer_id?: string;
  vehicle_id?: string;
  rental_id?: string;
  defaultAmount?: number;
  insuranceChargeMode?: boolean;
  targetCategories?: string[];
  extensionId?: string;
  /**
   * PAYG accrual id of the invoice the customer is paying off. When set, the
   * Send-payment-link and Email-Stripe-Link paths forward it as
   * `paygAccrualId` to `create-checkout-session`, which stamps it on the
   * Stripe Checkout metadata. The Stripe webhook then calls
   * `payg_settle_invoice(payment_id, accrual_id)` to flip the accrual to
   * `paid` (and supersede earlier opens), so PAYG status mirrors the
   * non-PAYG flow where Stripe payments settle automatically.
   * The Charge-saved-card path does not forward it: like the manual
   * Record-Payment path it settles through `apply-payment`, which resolves and
   * settles the latest open accrual itself once the money is allocated.
   */
  paygAccrualId?: string;
  /**
   * Called after a successful action. The `kind` arg tells the caller whether
   * the payment is already settled in the DB or only initiated:
   *   - 'recorded' — manual Record Payment path, or the Charge-saved-card path
   *     (whose edge function inserts the payment row and runs `apply-payment`
   *     before it responds). Ledger + payment row are committed, so the caller
   *     may safely run any "post-settle" logic (e.g. flipping invoice status).
   *   - 'pending'  — Send-payment-link / Email-Stripe-Link path; only a checkout
   *     session was created. The actual Stripe webhook will commit the payment
   *     and run any settlement logic. Callers MUST NOT mark anything as paid here.
   * The arg is optional so existing callers that ignore it keep working.
   */
  onPaymentSuccess?: (kind?: 'recorded' | 'pending') => void;
  breakdownItems?: BreakdownItem[];
  /**
   * Authoritative outstanding balance computed by the caller. Use when the
   * parent has already calculated the rental's true outstanding (e.g. the
   * rental detail page composes ledger + invoice-fill + extension_totals to
   * get the same number as its Balance Due tile). Passing this avoids the
   * dialog's internal hooks under-counting cases where extension charges or
   * invoice fill-ins haven't yet landed in the ledger.
   */
  outstandingBalanceOverride?: number;
  /**
   * When true, the Stripe webhook will place a deposit pre-auth hold off-session
   * after the customer pays the rental — using the card they just used to pay.
   * Set true from the new-rental post-creation flow when the tenant has
   * security_deposit_enabled and global_deposit_amount > 0. The webhook handles
   * the hold via place-deposit-hold; if the rental already has a hold, that
   * edge function no-ops.
   */
  placeDepositHoldAfter?: boolean;
  /**
   * Effective security-deposit amount for THIS rental (the rental's
   * deposit_amount_override if set, otherwise the tenant's
   * global_deposit_amount). Used in the per-mode confirmation popup so the
   * operator sees the actual amount that will be held / quoted to the
   * customer — not just the tenant default.
   */
  depositHoldAmount?: number;
}

/**
 * Like `extractFunctionError`, but also returns the edge function's `code` and
 * the rest of the JSON body. charge-saved-card's whole contract is in those
 * fields: `authentication_required` (the card is fine, the customer just has to
 * authenticate — only a payment link fixes it), `possible_duplicate` (needs an
 * explicit operator override) and `charged_but_not_recorded` (money HAS moved
 * and `paymentIntentId` is the only handle anyone has on it). Collapsing those
 * into a message string is what turns "we took their money" into "charge
 * failed", so the body has to survive the unwrap.
 *
 * NOTE: this is deliberately a superset of `extractFunctionError` in
 * `@/lib/edge-error`; that shared helper is owned elsewhere and returns only a
 * string. Fold this back into it when the two can be changed together.
 */
const extractFunctionErrorDetail = async (
  error: unknown,
  fallback: string,
): Promise<{ message: string; code?: string; body?: Record<string, any> }> => {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const body = await ctx.clone().json();
      const msg = body?.error || body?.message;
      return {
        message: typeof msg === "string" && msg.trim() ? msg : fallback,
        code: typeof body?.code === "string" ? body.code : undefined,
        body: body && typeof body === "object" ? body : undefined,
      };
    } catch { /* body wasn't JSON — fall through */ }
  }
  const m = (error as { message?: string })?.message;
  return {
    message: m && m !== "Edge Function returned a non-2xx status code" ? m : fallback,
  };
};

/** Minimum length the edge function enforces on the operator's reason. */
const MIN_CHARGE_REASON_LENGTH = 5;

/**
 * FNV-1a. Used only to turn a charge intent into a short, STABLE token for the
 * idempotency key — never for security. The point is determinism: the same
 * rental + amount + purpose must produce the same key across a dialog reopen, a
 * component remount and a full page reload, because "the request timed out, let
 * me try again" is the exact moment a random-per-open key becomes a second real
 * charge.
 */
const fnv1aHex = (input: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** 16 hex chars from two independent passes — enough to make collisions moot. */
const stableIntentToken = (input: string): string =>
  `${fnv1aHex(input)}${fnv1aHex(`${input.length}|${input.split("").reverse().join("")}`)}`;

const PAYMENT_METHODS = [
  { value: "Cash", label: "Cash", icon: Banknote },
  { value: "Card", label: "Card", icon: CreditCard },
  { value: "Bank Transfer", label: "Transfer", icon: Building2 },
  { value: "Zelle", label: "Zelle", icon: Smartphone },
  { value: "Check", label: "Check", icon: FileText },
  { value: "Other", label: "Other", icon: MoreHorizontal },
];

export const AddPaymentDialog = ({
  open,
  onOpenChange,
  customer_id,
  vehicle_id,
  rental_id: propRentalId,
  defaultAmount,
  insuranceChargeMode,
  targetCategories,
  extensionId,
  paygAccrualId,
  onPaymentSuccess,
  breakdownItems,
  outstandingBalanceOverride,
  placeDepositHoldAfter,
  depositHoldAmount: depositHoldAmountProp,
}: AddPaymentDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Operator-controllable override for the post-payment deposit hold. Seeded
  // from the `placeDepositHoldAfter` prop (true in the new-rental flow when the
  // tenant has a deposit configured) but the operator can UNCHECK it per guest
  // — e.g. auto-extend guests who don't pay a deposit. When unchecked, the
  // Send-payment-link / Email-Stripe-Link / Charge-saved-card paths omit the
  // hold entirely.
  const [depositHoldEnabled, setDepositHoldEnabled] = useState(Boolean(placeDepositHoldAfter));
  // Pending action awaiting operator confirmation in the deposit-hold popup.
  // Only used when placeDepositHoldAfter+tenant deposit is configured; in every
  // other context the buttons run their handlers immediately as before.
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'record'; data: PaymentFormData }
    | { type: 'stripe' }
    | { type: 'email' }
    | null
  >(null);
  // Bypass flag set just before re-invoking the manual onSubmit after the
  // operator confirms — avoids re-opening the popup in an infinite loop.
  const skipConfirmRef = useRef(false);
  // Synchronous double-submit guards. React `loading` state is async — between
  // a click and the next render, a second click can slip through and create a
  // duplicate payment / duplicate Stripe checkout. Refs update synchronously
  // so they catch rapid double-clicks even within the same event-loop tick.
  const submitInFlight = useRef(false);
  const stripeInFlight = useRef(false);
  const emailInFlight = useRef(false);
  const chargeInFlight = useRef(false);
  // Direct off-session charge of the card already on file (charge-saved-card).
  // Separate confirmation step because this one actually moves money the moment
  // it is clicked — unlike every other button in this footer, which only creates
  // a link for the customer to act on.
  const [chargeCardOpen, setChargeCardOpen] = useState(false);
  const [chargeLoading, setChargeLoading] = useState(false);
  const [chargeReason, setChargeReason] = useState("");
  // Set when Stripe answers `authentication_required`: the card is good but the
  // issuer wants the cardholder present, so the confirm step turns into an
  // "email them a link instead" offer rather than a dead end.
  const [chargeNeedsAuth, setChargeNeedsAuth] = useState(false);
  // Set when the edge function charged the card but could NOT write the payments
  // row (or could not prove it hadn't already). Money has moved and nothing
  // records it. This is the one state in the dialog that must not be dismissible
  // by clicking away, and must never be described as a failed charge.
  const [chargeUnrecorded, setChargeUnrecorded] = useState<{ message: string; paymentIntentId?: string; amount?: number } | null>(null);
  // Set when the edge function found a matching recent payment on this rental.
  // The operator has to look at it and say "yes, charge again" — which is also
  // the only thing that rotates the idempotency key for a deliberate repeat.
  const [chargeDuplicate, setChargeDuplicate] = useState<{ message: string; existing?: Record<string, any> } | null>(null);
  // Overpayment acknowledgement (mirrors the manual path's window.confirm).
  const [overpayAcknowledged, setOverpayAcknowledged] = useState(false);
  // Idempotency-key ROTATIONS, keyed by charge intent.
  //
  // The key itself is DERIVED, not minted: `stableIntentToken(rental|amount|purpose)`.
  // That is deliberate. A key minted per confirm-step opening defeats the whole
  // mechanism — the operator's response to a timed-out request is to cancel and
  // reopen, which under a per-open key issues a genuinely second charge for the
  // same money. A derived key survives reopen, remount and page reload, so the
  // retry replays the first PaymentIntent instead of creating another.
  //
  // We only step the rotation when a repeat is provably safe or explicitly
  // wanted: Stripe REFUSED (so no charge exists, and reusing the key would just
  // replay Stripe's 24h-cached failure), or the operator confirmed a deliberate
  // duplicate. Rotations are stored per intent so that editing the amount and
  // editing it back cannot silently rewind to a burnt key.
  const chargeRotations = useRef<Map<string, number>>(new Map());
  // Intents whose duplicate warning the operator has already overridden. Without
  // this, a "charge anyway" that times out and is overridden a second time would
  // rotate the key twice and issue a real second charge — reintroducing the very
  // hole the derived key closes.
  const chargeDuplicateOverridden = useRef<Set<string>>(new Set());
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const { appUser, hasRole } = useAuth();
  const { canEdit } = useManagerPermissions();
  const queryClient = useQueryClient();

  useAuditLogOnOpen({
    open,
    action: "payment_create_dialog_shown",
    entityType: "payment",
    entityId: propRentalId || customer_id || "unknown",
    details: { rental_id: propRentalId, customer_id, defaultAmount },
  });

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      customer_id: customer_id || "",
      vehicle_id: vehicle_id || "",
      amount: undefined,
      payment_date: toZonedTime(new Date(), 'America/New_York'),
      method: "",
      notes: "",
    },
  });

  // Calculate breakdown total when breakdown items are provided
  const breakdownTotal = breakdownItems && breakdownItems.length > 0
    ? breakdownItems.reduce((sum, item) => sum + (item.type === 'discount' ? -Math.abs(item.amount) : item.amount), 0)
    : null;

  // Update form values when props change
  useEffect(() => {
    if (open) {
      // Re-seed the deposit-hold toggle from the prop each time the dialog opens.
      setDepositHoldEnabled(Boolean(placeDepositHoldAfter));
      if (customer_id) form.setValue("customer_id", customer_id);
      if (vehicle_id) form.setValue("vehicle_id", vehicle_id);
      // Prefer breakdown total > defaultAmount > outstanding
      if (breakdownTotal && breakdownTotal > 0) form.setValue("amount", Math.round(breakdownTotal * 100) / 100);
      else if (defaultAmount) form.setValue("amount", Math.round(defaultAmount * 100) / 100);
    }
  }, [open, customer_id, vehicle_id, defaultAmount, breakdownTotal, form, placeDepositHoldAfter]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setChargeCardOpen(false);
      setChargeReason("");
      setChargeNeedsAuth(false);
      setChargeDuplicate(null);
      setOverpayAcknowledged(false);
      // chargeUnrecorded is NOT cleared here and chargeRotations is NOT cleared
      // either: the unrecorded panel owns its own dismissal (money has moved and
      // the operator has to acknowledge it), and dropping the rotations would
      // rewind a burnt idempotency key.
      form.reset({
        customer_id: "",
        vehicle_id: "",
        amount: undefined,
        payment_date: toZonedTime(new Date(), 'America/New_York'),
        method: "",
        notes: "",
      });
    }
  }, [open, form]);

  const selectedCustomerId = form.watch("customer_id") || customer_id;
  const selectedVehicleId = form.watch("vehicle_id") || vehicle_id;

  // Auto-infer rental ID
  const { data: inferredRentalId } = useCustomerVehicleRental(selectedCustomerId, selectedVehicleId);
  const rentalId = propRentalId || inferredRentalId;

  // Get outstanding balance — use rental-specific when rental_id is available, fall back to customer-wide
  const { data: customerBalanceData } = useCustomerBalanceWithStatus(selectedCustomerId);
  const { data: rentalChargesData } = useRentalChargesAndPayments(rentalId);
  const customerOutstanding = customerBalanceData?.status === 'In Debt' ? customerBalanceData.balance : 0;
  const rentalOutstanding = rentalChargesData?.outstanding || 0;
  // Use the higher of rental-specific or customer-wide outstanding (rental charges may have future due dates filtered out in customer balance)
  const computedOutstanding = rentalId ? Math.max(rentalOutstanding, customerOutstanding) : customerOutstanding;
  // When the parent passes an override (e.g. rental detail page), trust it — it
  // composes ledger + invoice-fill + extension_totals which the dialog's hooks
  // can't see on their own. Falls back to the internal computation otherwise.
  const outstandingBalance = (typeof outstandingBalanceOverride === 'number' && outstandingBalanceOverride > 0)
    ? outstandingBalanceOverride
    : computedOutstanding;

  // Auto-fill amount with outstanding balance when it loads (and no defaultAmount was provided)
  useEffect(() => {
    if (open && outstandingBalance > 0 && !defaultAmount && !form.getValues("amount")) {
      // Round to 2dp — outstandingBalance is a sum of fractional charges and can carry FP noise.
      form.setValue("amount", Math.round(outstandingBalance * 100) / 100);
    }
  }, [open, outstandingBalance, defaultAmount]);

  // Vehicle lookup for selected customer
  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals", selectedCustomerId, tenant?.id],
    queryFn: async () => {
      if (!selectedCustomerId) return [];
      let query = supabase
        .from("rentals")
        .select("vehicle_id, vehicles!rentals_vehicle_id_fkey(id, reg, make, model)")
        .eq("status", "Active")
        .eq("customer_id", selectedCustomerId);
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (error) throw error;
      const vehicles = data?.map(r => r.vehicles).filter(Boolean) || [];
      return vehicles.reduce((acc: any[], vehicle: any) => {
        if (!acc.find(v => v.id === vehicle.id)) acc.push(vehicle);
        return acc;
      }, []);
    },
    enabled: !!selectedCustomerId,
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-for-payment", tenant?.id],
    queryFn: async () => {
      let query = supabase.from("customers").select("id, name, email");
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Fetch latest invoice for the rental
  const { data: latestInvoice } = useQuery({
    queryKey: ["latest-invoice-for-payment", rentalId, tenant?.id],
    queryFn: async () => {
      if (!rentalId) return null;
      let query = supabase
        .from("invoices")
        .select("id, invoice_number, total_amount")
        .eq("rental_id", rentalId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query.maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!rentalId && open,
  });

  // Fetch rental details for Stripe / Email
  const { data: rentalDetails } = useQuery({
    queryKey: ["rental-for-payment", rentalId],
    queryFn: async () => {
      if (!rentalId) return null;
      const { data, error } = await supabase
        .from("rentals")
        .select("id, monthly_amount, customer_id, vehicle_id, delivery_fee, insurance_premium, customers!rentals_customer_id_fkey(name, email)")
        .eq("id", rentalId)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!rentalId && open,
  });

  // Is there a card we could charge directly? Necessary-but-not-sufficient
  // signal: the customer has a Stripe Customer id, which is only ever minted by
  // a checkout that ran with setup_future_usage: 'off_session'. The edge
  // function does the authoritative check (the id is validated against the exact
  // account+mode it is about to charge, and the card must still be attached) and
  // answers with a `no_card_on_file` code, so this is purely about not showing
  // the operator a button that is guaranteed to fail.
  const { data: savedStripeCustomerId } = useQuery({
    queryKey: ["customer-card-on-file", selectedCustomerId, tenant?.id],
    queryFn: async () => {
      if (!selectedCustomerId) return null;
      // Per-account customer ids (uk/uae) plus the legacy shared column — a card
      // on EITHER platform account counts as "on file". The edge function does
      // the authoritative per-account validation.
      let query = supabase
        .from("customers")
        .select("stripe_customer_id, stripe_customer_id_uk, stripe_customer_id_uae")
        .eq("id", selectedCustomerId);
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query.maybeSingle();
      if (error) return null;
      return data?.stripe_customer_id ?? data?.stripe_customer_id_uk ?? data?.stripe_customer_id_uae ?? null;
    },
    enabled: !!selectedCustomerId && open,
  });
  const hasCardOnFile = !!savedStripeCustomerId;

  const customerVehicles = activeRentals || [];
  const selectedCustomer = customers?.find(c => c.id === selectedCustomerId);
  const customerEmail = selectedCustomer?.email || (rentalDetails?.customers as any)?.email;
  const customerName = selectedCustomer?.name || (rentalDetails?.customers as any)?.name || '';

  const isAnyLoading = loading || stripeLoading || emailLoading || chargeLoading;

  // Mirrors charge-saved-card's server-side RBAC gate: head_admin/admin (super
  // admins are handed head_admin by the auth store), or a manager explicitly
  // granted EDITOR on the payments tab. Viewers, ops and unscoped managers never
  // see the button — and would be refused by the edge function anyway.
  // hasRole() also enforces is_active, so a deactivated account fails both arms.
  const canChargeSavedCard = hasRole(['head_admin', 'admin'])
    || (hasRole('manager') && canEdit('payments'));

  // Single source of truth for "how much the card will actually be charged".
  //
  // STRICTLY the operator-visible amount field. NO FALLBACK CHAIN — that is the
  // whole point. The link buttons can afford a display/charge mismatch (the
  // customer sees the real number on Stripe's own page and has to consent before
  // anything moves); a direct off-session charge cannot, because the confirmation
  // is the last thing ANYONE sees before the money is gone. A fallback to
  // outstandingBalance / monthly_amount / the latest invoice means an operator who
  // clears the field, or who clicks before the auto-fill lands, charges a number
  // that was never on screen. If the field is empty or non-positive we charge
  // nothing and say why. The field is already auto-populated from
  // breakdownTotal / defaultAmount / outstandingBalance above.
  const watchedAmount = form.watch("amount");
  const parsedChargeAmount = Number(watchedAmount);
  const chargeAmount = Number.isFinite(parsedChargeAmount) && parsedChargeAmount > 0
    ? Math.round(parsedChargeAmount * 100) / 100
    : 0;

  // Ported from the manual Record-Payment path (which refuses this outright):
  // nothing is owed, so an off-session charge has no basis at all. Skipped when
  // the caller supplied the amount (extension / targeted payments), exactly as
  // onSubmit skips it.
  const chargeHasNoBasis = !defaultAmount && !breakdownItems
    && outstandingBalance !== undefined && outstandingBalance === 0;
  // Also ported: charging more than is owed leaves the excess as credit. The
  // manual path asks first; so does this one, via an explicit acknowledgement.
  const chargeIsOverpayment = !defaultAmount && !breakdownItems
    && outstandingBalance !== undefined && outstandingBalance > 0
    && chargeAmount > outstandingBalance;

  // Why the charge button is unavailable, so the operator isn't left guessing at
  // a dead control on a money screen.
  const chargeBlockedReason = !rentalId
    ? "Pick the rental this payment applies to first."
    : chargeAmount <= 0
      ? "Enter the amount to charge above — the card is charged exactly this figure."
      : chargeHasNoBasis
        ? "This customer has no outstanding balance to charge."
        : null;
  const canSubmitCharge = !chargeBlockedReason
    && chargeReason.trim().length >= MIN_CHARGE_REASON_LENGTH
    && (!chargeIsOverpayment || overpayAcknowledged);

  // Idempotency identity of THIS charge: rental + exact amount + what it is for.
  // The free-text reason is deliberately NOT in here. Reason wording varies
  // between attempts ("card retry", "card retry 2"), and any input that the
  // operator retypes on a retry would mint a new key and defeat the guard — the
  // very failure this replaced. Deliberate repeats are handled explicitly by the
  // duplicate confirmation, which rotates the key.
  const chargeIntent = `${rentalId ?? ""}|${chargeAmount.toFixed(2)}|${(targetCategories ?? []).join(",")}|${extensionId ?? ""}`;
  const chargeRequestIdFor = (intent: string) => {
    const rotation = chargeRotations.current.get(intent) ?? 0;
    return `chg-${stableIntentToken(intent)}${rotation > 0 ? `-r${rotation}` : ""}`;
  };
  /** Step the key — ONLY when a repeat is proven safe or explicitly wanted. */
  const rotateChargeRequestId = (intent: string) => {
    chargeRotations.current.set(intent, (chargeRotations.current.get(intent) ?? 0) + 1);
  };

  const invalidateAllPaymentQueries = async (finalCustomerId?: string) => {
    const invalidateOptions = { refetchType: 'all' as const };

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payments-data'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['payment-summary'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['customers'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['rentals'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['pnl'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-totals"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-charges"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-payments"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-payment-breakdown"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-refund-breakdown"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-extension-totals"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-policies"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-invoice"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"], ...invalidateOptions }),
      // The Payment Links panel. Every action in this dialog that mints a Stripe
      // Checkout session ("Charge via Stripe", "Email Stripe Link") writes a
      // `payments` row carrying stripe_checkout_session_id — which is exactly
      // what useRentalPaymentLinks reads. Without these two keys the row lands in
      // the database but the panel keeps serving its cache and reads
      // "No payment links have been sent yet", because the app sets
      // staleTime: 60s AND refetchOnWindowFocus: false (app/providers.tsx:47-48),
      // so returning to the tab does not refresh it either. Reported by GMT after
      // sending two links and seeing neither.
      queryClient.invalidateQueries({ queryKey: ["rental-payment-links"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["customer-payment-links"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["payment-applications"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["outstanding-balance"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["excess-mileage-charge"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-charges-payments"], ...invalidateOptions }),
    ]);

    if (rentalId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-totals", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental-charges", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental-payments", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["excess-mileage-charge", rentalId], ...invalidateOptions }),
      ]);
    }

    if (finalCustomerId) {
      await queryClient.invalidateQueries({ queryKey: ["customer-balance", finalCustomerId], ...invalidateOptions });
    }
  };

  // True when there's something worth confirming with the operator — i.e. the
  // post-rental-creation flow opened the dialog and the tenant actually has a
  // non-zero security deposit, so the choice of mode meaningfully affects the
  // hold outcome. In any other context (paying down an existing balance, etc.)
  // the popup adds friction with no value, so we bypass it.
  // Effective deposit amount for confirmation copy + downstream API calls:
  // the rental-specific override (passed in from the new-rental page) wins
  // over the tenant default. Without this the popup would show $3 even when
  // the operator set $10 on the Pre-Auth input.
  const effectiveDepositAmount = depositHoldAmountProp && depositHoldAmountProp > 0
    ? depositHoldAmountProp
    : Number(tenant?.global_deposit_amount) || 0;

  // True when a deposit hold COULD apply in this context (new-rental flow with a
  // configured deposit) — gates whether we render the operator opt-out checkbox.
  const depositHoldApplicable = !!placeDepositHoldAfter
    && !!tenant?.security_deposit_enabled
    // Charged-deposit tenants never place a hold — the deposit is collected as a
    // real payment. Gated here as well as at the caller so no parent can opt a
    // charged tenant back into double-securing the same money.
    && tenant?.deposit_charge_enabled !== true
    && effectiveDepositAmount > 0;

  // The hold only actually rides along when applicable AND the operator left the
  // checkbox checked. Everything downstream keys off this, not the raw prop.
  const shouldConfirmMode = depositHoldApplicable && depositHoldEnabled;

  // Manual payment submit
  const onSubmit = async (data: PaymentFormData) => {
    // Gate: if the operator hasn't yet seen the "Record Payment doesn't auto-hold"
    // confirmation, show it instead of submitting. After they confirm we re-call
    // this with skipConfirmRef set so the gate falls through.
    if (shouldConfirmMode && !skipConfirmRef.current) {
      setPendingConfirm({ type: 'record', data });
      return;
    }
    skipConfirmRef.current = false;
    // Synchronous double-submit guard — see ref declaration for rationale.
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setLoading(true);
    try {
      const finalCustomerId = data.customer_id || customer_id;
      const finalVehicleId = data.vehicle_id || vehicle_id;

      // Block submit if we couldn't resolve a rental for this payment. Without a
      // rental_id the payment row is inserted unlinked and `apply-payment` either
      // FIFOs across the customer's charges (lands on the wrong rental) or
      // becomes a Credit with zero applications — invisible to the intended
      // rental's "Collected" tile. Operator must pick the vehicle (= rental).
      if (!rentalId) {
        toast({
          title: "Select a rental",
          description: customerVehicles.length === 0
            ? "This customer has no active rental to apply the payment to."
            : "Pick the vehicle of the rental this payment applies to.",
          variant: "destructive",
        });
        setLoading(false);
        submitInFlight.current = false;
        return;
      }

      // Duplicate-payment guard. Staff have hit this multiple times — most
      // notably RevTek's R-1ac41d where the same $390.55 was recorded twice
      // (once after the customer paid the Stripe link, then again two days
      // later when no one was sure if the first entry had landed). Catch the
      // common case: same rental, same amount, recorded within the last 14
      // days, status not Cancelled. Applies to all entry paths (including
      // bundled Collect Now flows) because the duplicate is defined by what
      // hits the DB, not how staff got here.
      const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
      const sinceIso = new Date(Date.now() - recentWindowMs).toISOString();
      const { data: recentMatches } = await supabase
        .from('payments')
        .select('id, amount, payment_date, created_at, method, status, booking_source')
        .eq('rental_id', rentalId)
        .eq('amount', data.amount)
        .neq('status', 'Cancelled')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1);

      if (recentMatches && recentMatches.length > 0) {
        const m = recentMatches[0] as any;
        const when = m.payment_date
          ? new Date(`${m.payment_date}T00:00:00`).toLocaleDateString()
          : new Date(m.created_at).toLocaleDateString();
        const sourceLabel = m.booking_source === 'website' ? 'customer checkout' : (m.method ? `${m.method} payment` : 'payment');
        const confirmDuplicate = window.confirm(
          `A ${sourceLabel} of ${formatCurrency(Number(m.amount), tenant?.currency_code || 'USD')} was already recorded on this rental on ${when}.\n\nThis may be a duplicate. Continue anyway?`
        );
        if (!confirmDuplicate) {
          setLoading(false);
          submitInFlight.current = false;
          return;
        }
      }

      // Skip overpayment/zero-balance checks when defaultAmount is provided (extension payments, targeted payments)
      // The caller already calculated the correct amount
      if (!defaultAmount) {
        if (!breakdownItems && outstandingBalance !== undefined && data.amount > outstandingBalance && outstandingBalance > 0) {
          const confirmOverpay = window.confirm(
            `The payment amount (${formatCurrency(data.amount, tenant?.currency_code || 'USD')}) exceeds the outstanding balance (${formatCurrency(outstandingBalance, tenant?.currency_code || 'USD')}). ` +
            `The excess ${formatCurrency(data.amount - outstandingBalance, tenant?.currency_code || 'USD')} will remain as credit. Continue?`
          );
          if (!confirmOverpay) { setLoading(false); return; }
        }

        if (!breakdownItems && outstandingBalance !== undefined && outstandingBalance === 0) {
          toast({ title: "No Outstanding Balance", description: "This customer has no outstanding balance to pay.", variant: "destructive" });
          setLoading(false);
          return;
        }
      }

      const { data: payment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          customer_id: finalCustomerId,
          vehicle_id: finalVehicleId,
          rental_id: rentalId,
          amount: data.amount,
          payment_date: formatInTimeZone(data.payment_date, 'America/New_York', 'yyyy-MM-dd'),
          method: data.method,
          payment_type: 'Payment',
          status: 'Completed',
          remaining_amount: data.amount,
          tenant_id: tenant?.id,
          verification_status: 'approved',
          ...(targetCategories && targetCategories.length > 0 ? { target_categories: targetCategories } : {}),
          ...(extensionId ? { extension_id: extensionId } : {}),
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      const applyBody: any = { paymentId: payment.id };
      if (targetCategories && targetCategories.length > 0) {
        applyBody.targetCategories = targetCategories;
      }
      if (extensionId) {
        applyBody.extensionId = extensionId;
      }
      const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', { body: applyBody });

      // Roll back BOTH the ledger Payment entry AND the payments row when apply-payment
      // fails. Without the ledger delete, the FK fk_ledger_entries_payment_id (ON DELETE
      // SET NULL) leaves an orphan ledger Payment row with payment_id = NULL — and FIFO
      // on subsequent payments will happily drain it against open charges, producing
      // phantom credit. We hit this on one tenant where a $390.55 orphan made a
      // customer appear $390.55 in credit on top of his real payments.
      const rollbackPayment = async () => {
        let ledgerDelete = supabase
          .from('ledger_entries')
          .delete()
          .eq('payment_id', payment.id)
          .eq('type', 'Payment');
        if (tenant?.id) ledgerDelete = ledgerDelete.eq('tenant_id', tenant.id);
        await ledgerDelete;

        let paymentDelete = supabase.from('payments').delete().eq('id', payment.id);
        if (tenant?.id) paymentDelete = paymentDelete.eq('tenant_id', tenant.id);
        await paymentDelete;
      };

      if (applyError) {
        await rollbackPayment();
        throw new Error(applyError.message || 'Payment processing failed');
      }
      if (!applyResult?.ok) {
        await rollbackPayment();
        throw new Error(applyResult?.error || applyResult?.detail || 'Payment processing failed');
      }

      toast({ title: "Payment Recorded", description: `Payment of ${formatCurrency(data.amount, tenant?.currency_code || 'USD')} has been recorded and applied.` });
      logAction({ action: "payment_created", entityType: "payment", entityId: payment.id, details: { amount: data.amount, method: data.method || "manual", customer_id: finalCustomerId } });
      await invalidateAllPaymentQueries(finalCustomerId);
      if (onPaymentSuccess) onPaymentSuccess('recorded');
      form.reset();
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding payment:", error);
      toast({ title: "Error", description: (error as any).message || "Failed to add payment.", variant: "destructive" });
    } finally {
      setLoading(false);
      submitInFlight.current = false;
    }
  };

  // Stripe checkout handler
  const handleStripePayment = async () => {
    if (stripeInFlight.current) return;
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }
    if (!rentalId) {
      toast({
        title: "Select a rental",
        description: customerVehicles.length === 0
          ? "This customer has no active rental to apply the payment to."
          : "Pick the vehicle of the rental this payment applies to.",
        variant: "destructive",
      });
      return;
    }

    const amount = form.getValues("amount") || breakdownTotal || defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;
    if (amount <= 0) { toast({ title: "Error", description: "No outstanding amount to charge.", variant: "destructive" }); return; }

    stripeInFlight.current = true;
    setStripeLoading(true);
    // POPUP-BLOCKER SAFE: the tab is opened SYNCHRONOUSLY, while the click is
    // still the current user gesture, and pointed at the real URL once it
    // arrives. window.open() after an await has lost that gesture, so Chrome
    // blocks it silently — the toast said "opened in a new tab" and no tab
    // ever appeared.
    //
    // Declared OUTSIDE the try so the catch can close it. A const inside the
    // try block is not in scope in the catch, which is exactly how the first
    // version of this fix failed to compile.
    const checkoutTab = window.open("", "_blank");
    try {
      const portalOrigin = window.location.origin;

      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: rentalId || undefined,
          customerEmail: customerEmail || undefined,
          customerName,
          totalAmount: amount,
          tenantId: tenant?.id,
          successUrl: rentalId ? `${portalOrigin}/rentals/${rentalId}?payment=success` : portalOrigin,
          cancelUrl: rentalId ? `${portalOrigin}/rentals/${rentalId}?payment=cancelled` : portalOrigin,
          source: 'portal',
          ...(targetCategories && targetCategories.length > 0 ? { targetCategories } : {}),
          ...(extensionId ? { extensionId } : {}),
          // PAYG: stamp the accrual id on the checkout metadata so the Stripe
          // webhook can call payg_settle_invoice once the customer pays.
          ...(paygAccrualId ? { paygAccrualId } : {}),
          // First-rental flow: after the rental payment captures, the webhook
          // invokes place-deposit-hold to authorise the deposit off-session on
          // the same saved card.
          ...(depositHoldApplicable && depositHoldEnabled ? { placeDepositHoldAfter: true } : {}),
        },
      });

      if (error) {
        throw new Error(await extractFunctionError(error, 'Failed to create checkout session'));
      }
      if (!data?.url) throw new Error('No checkout URL returned');

      // Store targetCategories in localStorage so the fallback handler can use them
      if (targetCategories && targetCategories.length > 0 && rentalId) {
        localStorage.setItem(`payment_target_categories_${rentalId}`, JSON.stringify(targetCategories));
      }

      const checkoutUrl = data.url;

      if (checkoutTab) {
        checkoutTab.location.href = checkoutUrl;
      } else {
        // Blocked even so (or opened from an embedded view). Navigating
        // the current tab is better than a toast claiming a tab opened.
        window.location.href = checkoutUrl;
      }

      toast({ title: "Stripe Checkout opened", description: "Payment link opened in a new tab. Payment will be recorded automatically when the customer completes checkout." });
      // 'pending' — Stripe webhook will commit + settle the payment. Caller must NOT
      // flip any local "paid" state here.
      if (onPaymentSuccess) onPaymentSuccess('pending');
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating Stripe checkout:", error);
      // The blank tab was opened before we knew this would succeed. Leaving it
      // stranded on about:blank looks like a broken checkout.
      if (checkoutTab) checkoutTab.close();

      toast({ title: "Error", description: error.message || "Failed to create Stripe checkout.", variant: "destructive" });
    } finally {
      setStripeLoading(false);
      stripeInFlight.current = false;
    }
  };

  // Direct charge of the saved card (charge-saved-card edge function).
  //
  // This is the ONLY button in this dialog that moves money by itself: the other
  // two Stripe buttons create a Checkout URL and wait for the customer. The edge
  // function inserts the payments row and calls apply-payment exactly like the
  // manual Record-Payment path, so on success we report 'recorded' and callers
  // may run their post-settle logic (fine sync, …).
  const handleChargeSavedCard = async (opts: { confirmDuplicate?: boolean } = {}) => {
    if (chargeInFlight.current) return;
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }
    if (!rentalId) {
      toast({
        title: "Select a rental",
        description: customerVehicles.length === 0
          ? "This customer has no active rental to apply the payment to."
          : "Pick the vehicle of the rental this payment applies to.",
        variant: "destructive",
      });
      return;
    }

    // EXACTLY the number rendered on the confirm button — see chargeAmount. If
    // the operator-visible field is blank or non-positive there is no amount to
    // charge, and we refuse rather than reach for a plausible-looking number the
    // operator never saw.
    const amount = chargeAmount;
    if (amount <= 0) {
      toast({
        title: "Enter an amount",
        description: "The card is charged exactly the amount in the form. Type it in first.",
        variant: "destructive",
      });
      return;
    }

    // Ported from the manual Record-Payment path, which refuses this outright.
    if (chargeHasNoBasis) {
      toast({ title: "No Outstanding Balance", description: "This customer has no outstanding balance to pay.", variant: "destructive" });
      return;
    }
    // Ported from the manual path's overpayment window.confirm — here it is an
    // explicit in-dialog acknowledgement, so it can't be dismissed by reflex.
    if (chargeIsOverpayment && !overpayAcknowledged) {
      toast({
        title: "Confirm the overpayment",
        description: `This is more than the ${formatCurrency(outstandingBalance, tenant?.currency_code || 'USD')} outstanding. Tick the box to confirm the excess becomes credit.`,
        variant: "destructive",
      });
      return;
    }

    const reason = chargeReason.trim();
    if (reason.length < MIN_CHARGE_REASON_LENGTH) {
      toast({ title: "Reason required", description: "Say why this card is being charged — it is written to the audit log.", variant: "destructive" });
      return;
    }

    // A deliberate repeat is the ONE case where the key must move: the operator
    // has looked at the existing payment and said "charge again anyway", and
    // reusing the key would just replay the first PaymentIntent. Rotate ONCE per
    // intent though — overriding twice must retry the same second charge, not
    // create a third.
    const intent = chargeIntent;
    if (opts.confirmDuplicate && !chargeDuplicateOverridden.current.has(intent)) {
      chargeDuplicateOverridden.current.add(intent);
      rotateChargeRequestId(intent);
    }
    const clientRequestId = chargeRequestIdFor(intent);

    chargeInFlight.current = true;
    setChargeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('charge-saved-card', {
        body: {
          rentalId,
          amount: Math.round(amount * 100) / 100,
          reason,
          clientRequestId,
          ...(opts.confirmDuplicate ? { confirmDuplicate: true } : {}),
          ...(targetCategories && targetCategories.length > 0 ? { targetCategories } : {}),
          ...(extensionId ? { extensionId } : {}),
          // Same contract as the Checkout paths: when the new-rental flow asked
          // for a deposit hold and the operator left it ticked, the hold is
          // placed on this same card right after the charge captures.
          ...(depositHoldApplicable && depositHoldEnabled ? { placeDepositHoldAfter: true } : {}),
        },
      });

      if (error) {
        const detail = await extractFunctionErrorDetail(error, 'Failed to charge the saved card');

        // MONEY HAS MOVED and nothing recorded it. This must never be reported
        // as a failed charge: an operator who reads "charge failed" retries, and
        // a retry on top of an unreconciled real charge is the worst outcome
        // this whole feature can produce. Take over the dialog with a panel that
        // states the charge happened, carries the PaymentIntent id, and does not
        // auto-dismiss.
        if (detail.code === 'charged_but_not_recorded') {
          setChargeNeedsAuth(false);
          setChargeDuplicate(null);
          setChargeUnrecorded({
            message: detail.message,
            paymentIntentId: typeof detail.body?.paymentIntentId === 'string' ? detail.body.paymentIntentId : undefined,
            amount: typeof detail.body?.amount === 'number' ? detail.body.amount : amount,
          });
          setChargeCardOpen(true);
          // Deliberately no rotation and no toast: the key is the only thing
          // that would stop a manual retry becoming a second charge.
          return;
        }

        // The edge function found a matching recent payment on this rental. Show
        // it and make the operator decide, rather than silently charging again.
        if (detail.code === 'possible_duplicate') {
          setChargeNeedsAuth(false);
          setChargeDuplicate({
            message: detail.message,
            existing: detail.body?.existingPayment && typeof detail.body.existingPayment === 'object'
              ? detail.body.existingPayment
              : undefined,
          });
          return;
        }

        if (detail.code === 'authentication_required') {
          // Not a decline. Keep the confirm step open and offer the link fallback.
          setChargeNeedsAuth(true);
          return;
        }
        // These two codes mean the edge function reached Stripe and Stripe
        // REFUSED — no charge exists. Retrying under the same idempotency key
        // would just replay the cached failure for the next 24h, even after the
        // customer's bank clears the card, so step the key. Every other failure
        // (network drop, timeout, charged_but_not_recorded) leaves it alone: there
        // the charge may well have gone through, and replaying the same key is
        // exactly what stops a second one.
        if (detail.code === 'charge_failed' || detail.code === 'charge_not_succeeded') {
          rotateChargeRequestId(intent);
          // Fresh key ⇒ fresh attempt cycle, so a future duplicate warning is
          // overridable again.
          chargeDuplicateOverridden.current.delete(intent);
        }
        throw new Error(detail.message);
      }
      if (data && data.success === false) throw new Error(data.error || 'Failed to charge the saved card');

      const cardLabel = data?.card?.last4 ? ` (${data.card.brand ?? 'card'} ••${data.card.last4})` : '';
      toast({
        title: data?.alreadyRecorded ? "Already charged" : "Card charged",
        description: data?.alreadyRecorded
          ? `This charge had already been recorded — nothing was charged twice.`
          : `${formatCurrency(amount, tenant?.currency_code || 'USD')} charged to the card on file${cardLabel}.`,
      });

      // Money moved but something downstream did not — surface it loudly rather
      // than letting a green toast imply everything landed.
      const warnings: string[] = Array.isArray(data?.warnings) ? data.warnings : [];
      for (const w of warnings) {
        toast({ title: "Needs attention", description: w, variant: "destructive" });
      }

      await invalidateAllPaymentQueries(finalCustomerId);
      // 'recorded' — the payment row and its ledger allocation are committed by
      // the edge function before it responds.
      if (onPaymentSuccess) onPaymentSuccess('recorded');
      // Settled. Step the key so a later, genuinely-new charge of the same amount
      // on the same rental isn't served this PaymentIntent back.
      rotateChargeRequestId(intent);
      chargeDuplicateOverridden.current.delete(intent);
      setChargeCardOpen(false);
      setChargeReason("");
      setChargeDuplicate(null);
      setOverpayAcknowledged(false);
      form.reset();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error charging saved card:", error);
      // Deliberately NOT "Charge failed". A timeout or a dropped connection ends
      // up here too, and we genuinely do not know whether Stripe took the money —
      // asserting either way is wrong. Retrying is safe because the idempotency
      // key is unchanged on this path, so say that instead.
      toast({
        title: "Charge did not complete",
        description: `${error.message || "Failed to charge the saved card."} Retrying is safe — it reuses the same request and cannot charge twice.`,
        variant: "destructive",
      });
    } finally {
      setChargeLoading(false);
      chargeInFlight.current = false;
    }
  };

  // Email Stripe link handler — creates checkout session first, then emails it
  const handleSendInvoiceEmail = async () => {
    if (emailInFlight.current) return;
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }
    if (!customerEmail) { toast({ title: "Error", description: "Customer has no email address.", variant: "destructive" }); return; }
    if (!rentalId || !rentalDetails) { toast({ title: "Error", description: "No rental found.", variant: "destructive" }); return; }

    const invoiceToSend = latestInvoice;

    emailInFlight.current = true;
    setEmailLoading(true);
    try {
      const amount = form.getValues("amount") || breakdownTotal || invoiceToSend?.total_amount || rentalDetails?.monthly_amount || 0;

      // Mirror the PAYG reminder cron's URL strategy: emails go to real
      // customers and must always land on production (or wherever the customer
      // can actually reach). NEVER point at localhost — even when the admin is
      // testing from a local dev portal, the customer reading the email is on
      // their own machine and can't resolve test.localhost:3000.
      //
      // Resolution order (matches send-payg-reminders' deriveBookingOrigin):
      //   1. NEXT_PUBLIC_BOOKING_BASE_URL — explicit override (single-domain
      //      deployments or QA environments)
      //   2. https://{tenant.slug}.{NEXT_PUBLIC_BOOKING_BASE_DOMAIN || drive-247.com}
      //
      // Local DB updates still propagate because production booking-success
      // hits the same shared Supabase project, AND the rental detail page's
      // localStorage polling on the admin's machine fires `process-pending-payment`
      // every 5s for 5min as a safety net even if the customer never lands.
      // Same helper as the card path: on localhost this must stay on localhost,
      // or the emailed link points at a deployment that does not have the page.
      const bookingOrigin = bookingOriginFor(tenant?.slug);

      // Step 1: Create Stripe checkout session
      const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId,
          customerEmail,
          customerName,
          totalAmount: amount,
          tenantId: tenant?.id,
          successUrl: `${bookingOrigin}/booking-success?type=invoice&status=paid&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${bookingOrigin}/portal/payments`,
          source: 'portal',
          ...(targetCategories && targetCategories.length > 0 ? { targetCategories } : {}),
          ...(extensionId ? { extensionId } : {}),
          // PAYG: stamp the accrual id so when the customer clicks the
          // emailed link and pays, the Stripe webhook settles the right invoice.
          ...(paygAccrualId ? { paygAccrualId } : {}),
          // First-rental flow: after the rental payment captures, the webhook
          // invokes place-deposit-hold to authorise the deposit off-session on
          // the same saved card.
          ...(depositHoldApplicable && depositHoldEnabled ? { placeDepositHoldAfter: true } : {}),
        },
      });

      if (checkoutError || !checkoutData?.url) {
        throw new Error(
          checkoutError
            ? await extractFunctionError(checkoutError, 'Failed to create payment link')
            : 'Failed to create payment link'
        );
      }

      // Step 2: Send email with payment link (works with or without an existing invoice)
      // ALWAYS pass overrideAmount so the email's headline + Pay Now button match
      // the amount Stripe will actually charge. Without this, when the operator
      // is paying down a partial outstanding balance against a rental that has
      // an existing invoice on file, the email would default to showing the
      // INVOICE's total_amount (the full original invoice) instead of the
      // remaining balance the customer actually owes today — confusing the
      // customer with two different numbers (email vs Stripe Checkout).
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: {
          ...(invoiceToSend ? { invoiceId: invoiceToSend.id } : { rentalId, customerName, amount }),
          tenantId: tenant?.id,
          recipientEmail: customerEmail,
          paymentUrl: checkoutData.url,
          overrideAmount: amount,
          // When the rental payment will also trigger a deposit hold, pass the
          // hold amount so the email template can render the transparency
          // notice for the customer alongside the Pay Now button. Uses the
          // per-rental override when set, falls back to tenant default.
          // The charged-tenant term matches depositHoldApplicable above. Without it
          // this one call site could still ask send-invoice-email to promise the
          // customer a "security deposit hold" that will never be placed.
          ...(depositHoldEnabled && tenant?.security_deposit_enabled
              && tenant?.deposit_charge_enabled !== true && effectiveDepositAmount > 0
            ? { depositHoldAmount: effectiveDepositAmount }
            : {}),
          ...(targetCategories && targetCategories.length > 0
            ? { overrideDescription: `Payment for: ${targetCategories.join(', ')}` }
            : invoiceToSend && Math.abs(amount - (invoiceToSend.total_amount ?? amount)) > 0.01
              ? { overrideDescription: 'Outstanding balance' }
              : {}),
        },
      });
      if (error) throw new Error(error.message || 'Failed to send payment email');
      if (data && !data.success) throw new Error(data.error || 'Failed to send payment email');

      // Store the checkout session ID so the rental detail page can poll for it
      if (checkoutData.sessionId && rentalId) {
        localStorage.setItem(`pending_email_payment_${rentalId}`, checkoutData.sessionId);
      }

      toast({ title: "Payment Link Sent", description: `Payment link emailed to ${customerEmail}. Payment will be recorded automatically when the customer pays.` });
      // 'pending' — Stripe webhook will commit + settle the payment when the
      // customer clicks the link and completes checkout.
      if (onPaymentSuccess) onPaymentSuccess('pending');
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending payment email:", error);
      toast({ title: "Error", description: error.message || "Failed to send payment email.", variant: "destructive" });
    } finally {
      setEmailLoading(false);
      emailInFlight.current = false;
    }
  };

  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');
  const stripeAmount = breakdownTotal || defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isAnyLoading) onOpenChange(v); }}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-[460px] p-0 gap-0 overflow-hidden max-h-[calc(100dvh-16px)] sm:max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Record Payment</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
              {targetCategories && targetCategories.length > 0
                ? `Paying for: ${targetCategories.join(', ')}`
                : 'Record a payment against outstanding charges.'
              }
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Customer/Vehicle selection when not pre-populated */}
        {(!customer_id || !vehicle_id) && (
          <div className="px-4 sm:px-6 pb-4 space-y-3 border-b">
            {!customer_id && (
              <div>
                <Label className="text-sm font-medium">Customer <span className="text-red-500">*</span></Label>
                <Select onValueChange={(val) => form.setValue("customer_id", val)} value={form.watch("customer_id")}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select Customer" /></SelectTrigger>
                  <SelectContent>
                    {customers?.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!vehicle_id && !propRentalId && (
              <div>
                <Label className="text-sm font-medium">
                  Vehicle <span className="text-red-500">*</span>
                </Label>
                <Select onValueChange={(val) => form.setValue("vehicle_id", val)} value={form.watch("vehicle_id")}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select Vehicle" /></SelectTrigger>
                  <SelectContent>
                    {selectedCustomerId ? (
                      customerVehicles?.length > 0 ? (
                        customerVehicles.map((vehicle: { id: string; reg: string; make?: string; model?: string }) => (
                          <SelectItem key={vehicle.id} value={vehicle.id}>
                            {vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model} (${vehicle.reg})` : vehicle.reg}
                          </SelectItem>
                        ))
                      ) : <div className="px-3 py-2 text-sm text-muted-foreground">No Vehicles Found</div>
                    ) : <div className="px-3 py-2 text-sm text-muted-foreground">Select Customer First</div>}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
              {/* Amount */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Amount</FormLabel>
                    {breakdownItems && breakdownItems.length > 0 ? (
                      <>
                        {/* Read-only amount display for breakdown mode */}
                        <div className="flex items-center h-12 px-3 rounded-md border bg-muted/50 text-lg font-semibold">
                          <span className="text-muted-foreground text-sm mr-1">{currencySymbol}</span>
                          {formatCurrency(field.value || 0, tenant?.currency_code || 'USD').replace(/^[^\d]*/, '')}
                        </div>
                        {/* Collapsible breakdown */}
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={() => setShowBreakdown(!showBreakdown)}
                        >
                          <ChevronDown className={cn("h-3 w-3 transition-transform", showBreakdown && "rotate-180")} />
                          {showBreakdown ? 'Hide breakdown' : 'View breakdown'}
                        </button>
                        {showBreakdown && (
                          <div className="rounded-lg border px-3 py-2 space-y-1 text-xs">
                            {breakdownItems.map((item, i) => (
                              <div key={i} className={cn(
                                "flex items-center justify-between",
                                item.type === 'discount' && "text-green-600 dark:text-green-400"
                              )}>
                                <span className="text-muted-foreground">{item.label}</span>
                                <span className="font-medium">
                                  {item.type === 'discount' ? '−' : ''}{formatCurrency(Math.abs(item.amount), tenant?.currency_code || 'USD')}
                                </span>
                              </div>
                            ))}
                            <div className="border-t pt-1 flex items-center justify-between font-semibold text-sm">
                              <span>Total</span>
                              <span>{formatCurrency(
                                breakdownItems.reduce((sum, item) => sum + (item.type === 'discount' ? -Math.abs(item.amount) : item.amount), 0),
                                tenant?.currency_code || 'USD'
                              )}</span>
                            </div>
                          </div>
                        )}
                      </>
                    ) : defaultAmount !== undefined ? (
                      // Read-only amount display when the caller pre-computed the amount
                      // (individual category, collective selection, Bonzah insurance,
                      // extension payments, etc. — amount is derived from outstanding
                      // and must not be edited by hand).
                      <div className="flex items-center h-12 px-3 rounded-md border bg-muted/50 text-lg font-semibold">
                        <span className="text-muted-foreground text-sm mr-1">{currencySymbol}</span>
                        {formatCurrency(field.value || 0, tenant?.currency_code || 'USD').replace(/^[^\d]*/, '')}
                      </div>
                    ) : (
                      <>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">{currencySymbol}</span>
                            <Input
                              type="number" step="0.01" placeholder="0.00"
                              className="pl-7 text-lg font-semibold h-12"
                              {...field}
                              value={typeof field.value === 'number' ? Math.round(field.value * 100) / 100 : ''}
                              onChange={(e) => {
                                if (e.target.value === '') {
                                  field.onChange(undefined);
                                  return;
                                }
                                const parsed = parseFloat(e.target.value);
                                field.onChange(Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : undefined);
                              }}
                            />
                          </div>
                        </FormControl>
                        {outstandingBalance !== undefined && outstandingBalance > 0 && field.value !== Math.round(outstandingBalance * 100) / 100 && (
                          <button type="button" className="text-xs text-primary hover:underline" onClick={() => field.onChange(Math.round(outstandingBalance * 100) / 100)}>
                            Use full outstanding: {formatCurrency(outstandingBalance, tenant?.currency_code || 'USD')}
                          </button>
                        )}
                        {outstandingBalance !== undefined && outstandingBalance === 0 && selectedCustomerId && (
                          <p className="text-xs text-emerald-500">No outstanding balance</p>
                        )}
                      </>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Payment method */}
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Method</FormLabel>
                    <Select
                      value={field.value?.startsWith('Other:') ? 'Other' : (field.value || '')}
                      onValueChange={(val) => {
                        if (val === 'Other') {
                          field.onChange('Other:');
                        } else {
                          field.onChange(val);
                        }
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select payment method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                          <SelectItem key={value} value={value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span>{label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.value?.startsWith('Other:') && (
                      <Input
                        placeholder="Specify payment method"
                        className="h-9 mt-2"
                        value={field.value.replace('Other:', '').trim()}
                        onChange={(e) => field.onChange(`Other: ${e.target.value}`)}
                      />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Date + Reference */}
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="payment_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Date</FormLabel>
                      <Popover modal={true}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button variant="outline" className={cn("w-full pl-3 text-left font-normal h-9", !field.value && "text-muted-foreground")}>
                              {field.value ? formatInTimeZone(field.value, 'America/New_York', "MM/dd/yyyy") : <span>Pick date</span>}
                              <CalendarIcon className="ml-auto h-3.5 w-3.5 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 z-[60]" align="start">
                          <Calendar
                            mode="single" selected={field.value}
                            onSelect={(date) => { if (date) { field.onChange(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)); } }}
                            initialFocus className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Reference</FormLabel>
                      <FormControl>
                        <Input placeholder="Optional" className="h-9" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t bg-muted/30 space-y-2">
              {/* Primary: Record manual payment */}
              <Button type="submit" disabled={isAnyLoading} className="w-full h-11">
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Recording...</>
                ) : (
                  <><DollarSign className="w-4 h-4 mr-2" /> Record Payment</>
                )}
              </Button>


              {/* Deposit-hold opt-out — only when a hold could apply (new-rental
                  flow + configured deposit). Lets the operator skip the hold per
                  guest, e.g. auto-extend guests who don't pay a deposit. */}
              {depositHoldApplicable && (
                <label className="flex items-start gap-2.5 rounded-md border bg-background px-3 py-2.5 cursor-pointer select-none">
                  <Checkbox
                    checked={depositHoldEnabled}
                    onCheckedChange={(v) => setDepositHoldEnabled(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs leading-snug text-muted-foreground">
                    Place a {formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} security deposit hold after the customer pays.
                    {' '}Uncheck for guests who don&apos;t pay a deposit (e.g. auto-extend guests).
                  </span>
                </label>
              )}

              {/* Charge-saved-card button REMOVED from the UI on request.
                  Front end only — every mechanism behind it is intentionally
                  left in place: handleChargeSavedCard, the confirm dialog, the
                  idempotency key derivation, canChargeSavedCard/hasCardOnFile,
                  and the charge-saved-card edge function. Flip this back to
                  `selectedCustomerId && canChargeSavedCard && hasCardOnFile`
                  to restore it; nothing else needs changing.

                  Deliberately NOT deleting the logic: it is the only path that
                  takes money directly, so removing it would be a much larger
                  change than hiding the entry point, and the confirm dialog it
                  opens is still reachable from state if anything else sets
                  chargeCardOpen. */}
              {false && selectedCustomerId && canChargeSavedCard && hasCardOnFile && (
                <div className="space-y-1">
                  <Button
                    type="button"
                    variant="outline"
                    // No amount on screen means no charge. The label only ever
                    // shows a figure the operator typed or watched auto-fill.
                    disabled={isAnyLoading || !!chargeBlockedReason}
                    onClick={() => {
                      setChargeNeedsAuth(false);
                      setChargeDuplicate(null);
                      setOverpayAcknowledged(false);
                      setChargeReason("");
                      // NOTE: no key is minted here. The idempotency key is derived
                      // from the charge intent (see chargeRequestIdFor), so
                      // cancelling and reopening this step after a timeout replays
                      // the same request instead of issuing a second charge.
                      setChargeCardOpen(true);
                    }}
                    className="w-full h-10 gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950"
                  >
                    {chargeLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 shrink-0" />
                    )}
                    <span className="text-sm">
                      Charge saved card{chargeAmount > 0 ? ` — ${formatCurrency(chargeAmount, tenant?.currency_code || 'USD')}` : ''}
                    </span>
                  </Button>
                  {chargeBlockedReason && (
                    <p className="text-[11px] leading-snug text-muted-foreground px-0.5">{chargeBlockedReason}</p>
                  )}
                </div>
              )}

              {/* Stripe options row */}
              {selectedCustomerId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isAnyLoading || stripeAmount <= 0}
                    onClick={() => {
                      if (shouldConfirmMode) {
                        setPendingConfirm({ type: 'stripe' });
                      } else {
                        handleStripePayment();
                      }
                    }}
                    className="w-full h-10 gap-2"
                  >
                    {stripeLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <StripeMark />
                    )}
                    {/* handleStripePayment creates a Checkout session and
                        window.open()s the URL — it opens Stripe in a new tab for
                        the customer standing in front of you. It SENDS nothing,
                        so "Send payment link" was wrong and collided with the
                        "Email Stripe Link" button beside it, which is the one
                        that actually sends. Restored to the original wording at
                        the operator's request. */}
                    <span className="text-sm">Charge via Stripe</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isAnyLoading || !customerEmail || (!latestInvoice && !rentalDetails)}
                    onClick={() => {
                      if (shouldConfirmMode) {
                        setPendingConfirm({ type: 'email' });
                      } else {
                        handleSendInvoiceEmail();
                      }
                    }}
                    className="w-full h-10 gap-2"
                  >
                    {emailLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <StripeMark />
                        <Mail className="w-3.5 h-3.5 shrink-0 -ml-1" />
                      </>
                    )}
                    <span className="text-sm">Email Stripe Link</span>
                  </Button>

                </div>
              )}

              <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 transition-colors" onClick={() => onOpenChange(false)} disabled={isAnyLoading}>
                Cancel
              </button>
            </div>
          </form>
        </Form>
      </DialogContent>

      {/* Mode confirmation popup — only renders when shouldConfirmMode is true
          and the operator has picked a button. Spells out exactly what will
          happen for THIS specific mode (different copy for record vs Stripe).
          Confirming runs the original handler; cancelling just dismisses. */}
      <Dialog open={!!pendingConfirm} onOpenChange={(open) => { if (!open) setPendingConfirm(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          {pendingConfirm?.type === 'record' && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Record Payment — no automatic hold</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      You&apos;re recording <strong>{formatCurrency(stripeAmount, tenant?.currency_code || 'USD')}</strong> as a manual payment (cash, bank transfer, etc.). Stripe is not charged.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-1">
                <p>
                  Because no card is on file, the <strong>{formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} deposit hold</strong> will <strong>not</strong> be placed automatically.
                </p>
                <p>
                  To still secure the deposit, open the rental after recording this payment and use the <em>Place Pre-Auth Hold</em> button — it sends the customer a Stripe link (or opens one in-person) for the hold only.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    const data = pendingConfirm.data;
                    setPendingConfirm(null);
                    skipConfirmRef.current = true;
                    void onSubmit(data);
                  }}
                >
                  Record without hold
                </Button>
              </div>
            </>
          )}

          {pendingConfirm?.type === 'stripe' && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <CreditCard className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Charge via Stripe</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      Opens Stripe Checkout in a new tab for the customer. Nothing is charged until they pay.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-1">
                <p>
                  Customer is charged <strong>{formatCurrency(stripeAmount, tenant?.currency_code || 'USD')}</strong> for rental fees when they complete checkout.
                </p>
                <p>
                  Immediately after the charge captures, a separate <strong>{formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} pre-authorisation hold</strong> (not a charge) is placed on the same card — the customer only enters their card once.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    setPendingConfirm(null);
                    void handleStripePayment();
                  }}
                >
                  Open payment link
                </Button>
              </div>
            </>
          )}

          {pendingConfirm?.type === 'email' && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <Mail className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Email Stripe Link</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      Emails the customer a Stripe payment link they can pay at their convenience.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-1">
                <p>
                  When the customer pays, they&apos;ll be charged <strong>{formatCurrency(stripeAmount, tenant?.currency_code || 'USD')}</strong> for rental fees.
                </p>
                <p>
                  Immediately after the charge captures, a separate <strong>{formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} pre-authorisation hold</strong> (not a charge) is placed on the same card — the customer only enters their card once.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    setPendingConfirm(null);
                    void handleSendInvoiceEmail();
                  }}
                >
                  Send link
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Charge-saved-card confirmation. Deliberately heavier than the other
          confirmations: this is the one action that takes the customer's money
          the instant it is clicked, with the customer nowhere near the screen.
          The reason is mandatory and lands in audit_logs alongside the actor,
          the card and the platform account the charge ran on. */}
      <Dialog
        open={chargeCardOpen}
        onOpenChange={(v) => {
          // Never dismissable mid-request, and never dismissable at all while a
          // charged-but-unrecorded result is on screen: that panel is the only
          // record anyone has that the money moved.
          if (chargeLoading || chargeUnrecorded) return;
          setChargeCardOpen(v);
          if (!v) { setChargeNeedsAuth(false); setChargeDuplicate(null); }
        }}
      >
        <DialogContent
          className={cn("sm:max-w-[460px]", chargeUnrecorded && "[&>button]:hidden")}
          onEscapeKeyDown={(e) => { if (chargeLoading || chargeUnrecorded) e.preventDefault(); }}
          onInteractOutside={(e) => { if (chargeLoading || chargeUnrecorded) e.preventDefault(); }}
        >
          {chargeUnrecorded ? (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base text-red-700 dark:text-red-400">
                      Card WAS charged — not recorded
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      The money left the customer&apos;s card. It is not in the ledger.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  <p className="font-medium">
                    Do NOT retry this charge.
                  </p>
                  <p className="mt-1.5">
                    Stripe took{' '}
                    <strong>{formatCurrency(chargeUnrecorded.amount ?? chargeAmount, tenant?.currency_code || 'USD')}</strong>{' '}
                    but the payment row could not be written, so nothing on this rental reflects it.
                    Charging again would take the money twice.
                  </p>
                  {chargeUnrecorded.paymentIntentId && (
                    <p className="mt-2">
                      Reconcile against this Stripe PaymentIntent, then record the payment manually:
                      <span className="mt-1 block break-all rounded bg-red-100 px-2 py-1 font-mono text-[11px] dark:bg-red-900/50 select-all">
                        {chargeUnrecorded.paymentIntentId}
                      </span>
                    </p>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {chargeUnrecorded.message}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  This event is already in the audit log as <strong>payment_charge_saved_card_unrecorded</strong> with
                  your name, the amount and the card used.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button
                  variant="destructive"
                  onClick={() => {
                    setChargeUnrecorded(null);
                    setChargeCardOpen(false);
                    setChargeReason("");
                  }}
                >
                  I have noted the PaymentIntent
                </Button>
              </div>
            </>
          ) : chargeDuplicate ? (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Possible duplicate charge</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      Nothing has been charged yet.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p>{chargeDuplicate.message}</p>
                  {chargeDuplicate.existing?.paymentDate && (
                    <p className="mt-1.5">
                      Recorded on <strong>{new Date(`${chargeDuplicate.existing.paymentDate}T00:00:00`).toLocaleDateString()}</strong>
                      {chargeDuplicate.existing.method ? ` · ${chargeDuplicate.existing.method}` : ''}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Check the rental&apos;s payments before continuing. If this really is a second, separate
                  charge of {formatCurrency(chargeAmount, tenant?.currency_code || 'USD')}, confirm below.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button
                  variant="outline"
                  disabled={chargeLoading}
                  onClick={() => { setChargeDuplicate(null); setChargeCardOpen(false); }}
                >
                  Cancel — don&apos;t charge
                </Button>
                <Button
                  variant="destructive"
                  disabled={chargeLoading}
                  onClick={() => { setChargeDuplicate(null); void handleChargeSavedCard({ confirmDuplicate: true }); }}
                >
                  {chargeLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Charging...</>
                  ) : (
                    <>Charge anyway</>
                  )}
                </Button>
              </div>
            </>
          ) : chargeNeedsAuth ? (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Card needs authentication</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      Nothing was charged.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-1">
                <p>
                  The bank wants the cardholder to confirm this payment (3-D Secure), which can&apos;t happen
                  while the customer isn&apos;t at the checkout. The card itself is fine — it just can&apos;t
                  be charged without them.
                </p>
                <p>
                  Send them a payment link instead: authenticating once through checkout also refreshes the
                  saved card for future charges.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-end pt-3">
                <Button variant="outline" onClick={() => { setChargeCardOpen(false); setChargeNeedsAuth(false); }}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  disabled={isAnyLoading || !customerEmail || (!latestInvoice && !rentalDetails)}
                  onClick={() => {
                    setChargeCardOpen(false);
                    setChargeNeedsAuth(false);
                    void handleSendInvoiceEmail();
                  }}
                >
                  <Mail className="w-3.5 h-3.5 mr-1.5" /> Email payment link
                </Button>
                <Button
                  disabled={isAnyLoading || stripeAmount <= 0}
                  onClick={() => {
                    setChargeCardOpen(false);
                    setChargeNeedsAuth(false);
                    void handleStripePayment();
                  }}
                >
                  Open payment link
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <CreditCard className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Charge the saved card</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      Takes <strong>{formatCurrency(chargeAmount, tenant?.currency_code || 'USD')}</strong> from
                      the card on file straight away. The customer is not prompted.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                {chargeBlockedReason ? (
                  <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                    {chargeBlockedReason}
                  </p>
                ) : (
                  <p className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                    The card is charged <strong>exactly {formatCurrency(chargeAmount, tenant?.currency_code || 'USD')}</strong> —
                    the amount in the form above. Change it there if this is wrong.
                  </p>
                )}
                {chargeIsOverpayment && (
                  <label className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 cursor-pointer select-none dark:border-amber-900 dark:bg-amber-950/40">
                    <Checkbox
                      checked={overpayAcknowledged}
                      onCheckedChange={(v) => setOverpayAcknowledged(v === true)}
                      className="mt-0.5"
                      disabled={chargeLoading}
                    />
                    <span className="text-xs leading-snug text-amber-900 dark:text-amber-200">
                      This is more than the {formatCurrency(outstandingBalance, tenant?.currency_code || 'USD')} outstanding.
                      The extra {formatCurrency(chargeAmount - outstandingBalance, tenant?.currency_code || 'USD')} will sit
                      on the account as credit. Charge it anyway.
                    </span>
                  </label>
                )}
                <div>
                  <Label className="text-sm font-medium">
                    Reason <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    value={chargeReason}
                    onChange={(e) => setChargeReason(e.target.value)}
                    // Deliberately NOT a damage example. Charging a card on file
                    // to recover damage needs the renter's express permission
                    // obtained AFTER the damage (CA Civ. Code §1939.15(a), NY GBL
                    // §396-z(7)), and the stored-credential mandate that captures
                    // that permission has not shipped yet. A suggested-damage
                    // placeholder would steer operators straight into it.
                    placeholder="e.g. Agreed extension payment for week of 12 Aug, confirmed by phone"
                    className="mt-1.5 min-h-[76px] text-sm"
                    maxLength={500}
                    disabled={chargeLoading}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Written to the audit log with your name, the amount and the card used. Minimum {MIN_CHARGE_REASON_LENGTH} characters.
                  </p>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Use this only for amounts the renter has already agreed to pay. Recovering damage or
                  cleaning costs from a card on file needs the renter&apos;s written permission obtained
                  <em> after</em> the damage — get that first, and keep it on the rental.
                </p>
                {depositHoldApplicable && depositHoldEnabled && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    After the charge captures, a separate{' '}
                    <strong>{formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} pre-authorisation hold</strong>{' '}
                    (not a charge) is placed on the same card.
                  </p>
                )}
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button variant="outline" disabled={chargeLoading} onClick={() => setChargeCardOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={chargeLoading || !canSubmitCharge}
                  onClick={() => { void handleChargeSavedCard(); }}
                >
                  {chargeLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Charging...</>
                  ) : chargeAmount > 0 ? (
                    <>Charge {formatCurrency(chargeAmount, tenant?.currency_code || 'USD')}</>
                  ) : (
                    <>Charge</>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
