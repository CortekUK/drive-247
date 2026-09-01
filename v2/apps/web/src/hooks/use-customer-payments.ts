'use client';

/**
 * The money side of the signed-in customer's account.
 *
 * ── THE ISOLATION BOUNDARY IS THIS FILE ─────────────────────────────────────
 * Same rule as `use-customer-rentals.ts`, and for the same reason: these tables
 * answer the public anon key. Every query below carries BOTH
 * `.eq('customer_id', …)` and `.eq('tenant_id', …)`, and both ids come from the
 * auth store — never from a prop, a route param or a query string. There is
 * deliberately no `customerId` argument on any hook here.
 *
 * `invoices.customer_id` / `invoices.tenant_id` and `ledger_entries.customer_id`
 * / `ledger_entries.tenant_id` are all NULLABLE in the schema. A NULL on either
 * side means the row simply does not match and is dropped, which is the safe
 * direction for a leak but the unsafe direction for a balance: a charge we
 * cannot attribute is a charge we do not show. Verified on staging that every
 * ledger and invoice row for this tenant carries both — if that ever stops
 * being true the fix is at the write site, not by loosening a filter here.
 *
 * ── WHERE EACH NUMBER COMES FROM ────────────────────────────────────────────
 * Three different tables answer three different questions, and mixing them is
 * how a portal ends up showing two contradictory totals on one screen:
 *
 *   ledger_entries  → WHAT YOU OWE. `remaining_amount` on a `Charge` row is the
 *                     platform's own live balance; it is what the allocation
 *                     trigger and the Stripe webhooks settle against, and it is
 *                     per-charge, so it is immune to the "which invoice does
 *                     this payment belong to" question below. PAYG daily
 *                     accruals also land here, so a pay-as-you-go rental's
 *                     running balance is included without a second engine.
 *   invoices        → THE DOCUMENTS. What was billed, itemised. An invoice
 *                     status is a snapshot the operator writes; it is not the
 *                     balance and is not treated as one.
 *   payments        → WHAT YOU PAID. Receipts, including the ones still in
 *                     flight.
 *
 * The headline balance is taken from the ledger ONLY. The invoice list shows a
 * per-invoice state but no competing aggregate.
 *
 * ── CANCELLED BOOKINGS OWE NOTHING ──────────────────────────────────────────
 * A cancelled rental's ledger charges are left behind un-zeroed by the cancel
 * path (confirmed on staging: five cancelled rentals still carrying full
 * `remaining_amount`). Billing a customer on screen for a booking that no
 * longer exists is the fastest way to lose their trust, so charges and invoices
 * belonging to a cancelled rental are excluded from the balance and marked
 * "Cancelled" in the list rather than silently dropped. This mirrors the rule
 * `summariseRentals` already applies to the overview nudge.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant, type Tenant } from '@/contexts/TenantContext';
import { useCustomer } from '@/hooks/use-customer';
import {
  useCustomerRentals,
  type CustomerRental,
} from '@/hooks/use-customer-rentals';
import { todayDateString } from '@/lib/domain';
import type { Database } from '@/integrations/supabase/types';

/* ────────────────────────────── row shapes ─────────────────────────────── */

type InvoiceRow = Database['public']['Tables']['invoices']['Row'];
type PaymentRow = Database['public']['Tables']['payments']['Row'];
type LedgerRow = Database['public']['Tables']['ledger_entries']['Row'];
type PlanRow = Database['public']['Tables']['installment_plans']['Row'];
type InstallmentRow = Database['public']['Tables']['scheduled_installments']['Row'];

/**
 * `notes` is deliberately absent, exactly as in `use-customer-rental.ts`: it is
 * the operator's free-text field and carries no contract with the customer
 * about what may be written in it.
 */
type InvoiceQueryRow = Pick<
  InvoiceRow,
  | 'id'
  | 'invoice_number'
  | 'invoice_date'
  | 'due_date'
  | 'rental_id'
  | 'rental_fee'
  | 'protection_fee'
  | 'insurance_premium'
  | 'delivery_fee'
  | 'extras_total'
  | 'service_fee'
  | 'security_deposit'
  | 'tax_amount'
  | 'subtotal'
  | 'total_amount'
  | 'status'
  | 'created_at'
>;

/**
 * The payment columns a customer may read.
 *
 * Absent on purpose: `platform_account`, `payment_provider`, every
 * `stripe_*` / `square_*` id, `verified_by`, `rejection_reason` and
 * `is_manual_mode`. They describe how the operator's payment stack is wired,
 * not what the customer was charged.
 */
type PaymentQueryRow = Pick<
  PaymentRow,
  | 'id'
  | 'amount'
  | 'payment_date'
  | 'paid_at'
  | 'method'
  | 'status'
  | 'payment_type'
  | 'capture_status'
  | 'preauth_expires_at'
  | 'refund_amount'
  | 'refund_status'
  | 'rental_id'
  | 'created_at'
>;

type LedgerQueryRow = Pick<
  LedgerRow,
  | 'id'
  | 'rental_id'
  | 'type'
  | 'category'
  | 'amount'
  | 'remaining_amount'
  | 'entry_date'
  | 'due_date'
>;

type InstallmentQueryRow = Pick<
  InstallmentRow,
  | 'id'
  | 'installment_plan_id'
  | 'installment_number'
  | 'amount'
  | 'due_date'
  | 'status'
  | 'paid_at'
  | 'failure_count'
  | 'last_failure_reason'
>;

type PlanQueryRow = Pick<
  PlanRow,
  | 'id'
  | 'rental_id'
  | 'plan_type'
  | 'status'
  | 'total_installable_amount'
  | 'installment_amount'
  | 'number_of_installments'
  | 'paid_installments'
  | 'total_paid'
  | 'next_due_date'
  | 'upfront_amount'
  | 'upfront_paid'
  | 'created_at'
> & {
  scheduled_installments: InstallmentQueryRow[];
};

/* ───────────────────────────── select strings ──────────────────────────── */

const INVOICE_COLUMNS = [
  'id',
  'invoice_number',
  'invoice_date',
  'due_date',
  'rental_id',
  'rental_fee',
  'protection_fee',
  'insurance_premium',
  'delivery_fee',
  'extras_total',
  'service_fee',
  'security_deposit',
  'tax_amount',
  'subtotal',
  'total_amount',
  'status',
  'created_at',
].join(', ');

const PAYMENT_COLUMNS = [
  'id',
  'amount',
  'payment_date',
  'paid_at',
  'method',
  'status',
  'payment_type',
  'capture_status',
  'preauth_expires_at',
  'refund_amount',
  'refund_status',
  'rental_id',
  'created_at',
].join(', ');

const LEDGER_COLUMNS = [
  'id',
  'rental_id',
  'type',
  'category',
  'amount',
  'remaining_amount',
  'entry_date',
  'due_date',
].join(', ');

/**
 * `scheduled_installments` is a DIRECT child of `installment_plans`, so this
 * embed is one level deep and legal. It is still sorted client-side rather than
 * with `.order(…, { referencedTable: 'scheduled_installments' })` — the ordering
 * is cheap in memory and one less thing that can 400 the whole page. See the
 * PGRST108 note in `use-customer-rentals.ts` for what that failure looks like.
 */
const PLAN_SELECT = `${[
  'id',
  'rental_id',
  'plan_type',
  'status',
  'total_installable_amount',
  'installment_amount',
  'number_of_installments',
  'paid_installments',
  'total_paid',
  'next_due_date',
  'upfront_amount',
  'upfront_paid',
  'created_at',
].join(', ')}, scheduled_installments ( ${[
  'id',
  'installment_plan_id',
  'installment_number',
  'amount',
  'due_date',
  'status',
  'paid_at',
  'failure_count',
  'last_failure_reason',
].join(', ')} )`;

/* ───────────────────────────── view model ──────────────────────────────── */

/** One row of an invoice breakdown. Zero-value lines are dropped by the builder. */
export interface InvoiceLine {
  key: string;
  label: string;
  amount: number;
}

/**
 * How an invoice reads on screen.
 *
 * `cancelled` is not an invoice status the operator writes — it is derived from
 * the booking. See the file header.
 */
export type InvoiceState = 'paid' | 'part_paid' | 'due' | 'overdue' | 'cancelled';

export interface CustomerInvoice {
  id: string;
  /** `invoice_number`, or a short id for a row raised before the trigger existed. */
  number: string;
  /** DATE-only 'YYYY-MM-DD'. Never feed this to `new Date()`. */
  invoiceDate: string;
  dueDate: string | null;
  rentalId: string;
  /** Raw DB value, kept so support can be quoted the operator's own word. */
  statusRaw: string | null;
  state: InvoiceState;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  /** Payments on this booking allocated to this invoice. See `allocateInvoices`. */
  paid: number;
  /** `total - paid`, floored at 0. Always 0 for a cancelled booking. */
  outstanding: number;
  /** The booking this invoice bills, when it is still one of the customer's. */
  rental: CustomerRental | null;
}

/** What happened to one payment. */
export type PaymentState =
  | 'received'
  | 'pending'
  | 'hold'
  | 'refunded'
  | 'reversed';

export interface CustomerPayment {
  id: string;
  /** The gross amount on the row, before any refund. */
  amount: number;
  /** Money actually retained by the operator: gross, less any refund. */
  net: number;
  refunded: number;
  /** DATE-only 'YYYY-MM-DD'. */
  date: string;
  method: string | null;
  /** 'Payment' / 'InitialFee' → "Payment" / "Booking fee". */
  typeLabel: string;
  statusRaw: string | null;
  state: PaymentState;
  /** A card hold, not a charge — the money has not moved. */
  isHold: boolean;
  holdExpiresAt: string | null;
  rentalId: string | null;
  rental: CustomerRental | null;
}

/** One line of the outstanding balance, grouped by what it is for. */
export interface BalanceCategory {
  label: string;
  amount: number;
}

export interface CustomerBalance {
  /** Σ `remaining_amount` over open `Charge` rows, cancelled bookings excluded. */
  outstanding: number;
  /** The part of `outstanding` whose due date has already passed. */
  overdue: number;
  /** Net money received across every payment on the account, refunds deducted. */
  paidToDate: number;
  /** Outstanding split by ledger category, largest first. */
  categories: BalanceCategory[];
  /** Soonest due date among the open charges, or null. DATE-only. */
  nextDueDate: string | null;
  /** Charges excluded because their booking was cancelled — shown as a footnote. */
  cancelledCharges: number;
}

export type InstallmentState =
  | 'paid'
  | 'failed'
  | 'overdue'
  | 'due_today'
  | 'scheduled';

export interface CustomerInstallment {
  id: string;
  number: number;
  amount: number;
  /** DATE-only 'YYYY-MM-DD'. */
  dueDate: string;
  statusRaw: string;
  state: InstallmentState;
  paidAt: string | null;
  failureCount: number;
  failureReason: string | null;
}

export interface CustomerInstallmentPlan {
  id: string;
  rentalId: string;
  rental: CustomerRental | null;
  /** "Weekly" / "Twice weekly" / "Monthly". */
  planTypeLabel: string;
  statusRaw: string;
  isActive: boolean;
  isComplete: boolean;
  /** The operator has set the plan up but the upfront payment has not landed. */
  isPending: boolean;
  /** The instalment portion only — the upfront amount is separate. */
  total: number;
  instalmentAmount: number;
  count: number;
  paidCount: number;
  paid: number;
  remaining: number;
  /** 0–1, by instalment count. */
  progress: number;
  upfrontAmount: number;
  upfrontPaid: boolean;
  nextDueDate: string | null;
  installments: CustomerInstallment[];
}

/* ──────────────────────────── normalisation ────────────────────────────── */

/** Money is float8 in Postgres; summing it needs rounding at every boundary. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function positive(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function key(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Statuses on `payments` where the money never actually arrived.
 *
 * The full vocabulary is fixed by `payments_status_check`: Applied, Credit,
 * Partial, Reversed, Pending, Completed, Refunded, Partial Refund. Everything
 * outside this set represents money the operator holds (or held, for the two
 * refund states — those are received first and given back after, which is why
 * they count toward `amount` and are then netted off by `refund_amount`).
 *
 * Denying by exception rather than allowing by list is deliberate here: a new
 * settled status added to the constraint should show up as money received, not
 * silently vanish from the customer's running total.
 */
const NOT_RECEIVED_STATUSES = new Set(['pending', 'reversed']);

/** A pre-auth that has not been taken is a hold on the card, not a payment. */
function isCaptured(capture: string | null): boolean {
  return capture === null || capture === 'captured';
}

function paymentState(row: PaymentQueryRow): PaymentState {
  const status = key(row.status);
  if (status === 'reversed') return 'reversed';
  if (!isCaptured(row.capture_status)) {
    // 'cancelled' / 'expired' holds are dead: the card was never charged and
    // never will be on this row.
    return row.capture_status === 'requires_capture' ? 'hold' : 'reversed';
  }
  if (NOT_RECEIVED_STATUSES.has(status)) return 'pending';
  if (positive(row.refund_amount) > 0) return 'refunded';
  return 'received';
}

/** Gross received, refunds deducted. 0 for anything that never landed. */
function paymentNet(row: PaymentQueryRow): number {
  const state = paymentState(row);
  if (state === 'pending' || state === 'hold' || state === 'reversed') return 0;
  return round2(row.amount - positive(row.refund_amount));
}

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  payment: 'Payment',
  initialfee: 'Booking fee',
};

function normalizePayment(
  row: PaymentQueryRow,
  rentalsById: ReadonlyMap<string, CustomerRental>,
): CustomerPayment {
  const state = paymentState(row);
  return {
    id: row.id,
    amount: row.amount,
    net: paymentNet(row),
    refunded: round2(positive(row.refund_amount)),
    date: row.payment_date,
    method: row.method,
    typeLabel: PAYMENT_TYPE_LABEL[key(row.payment_type)] ?? 'Payment',
    statusRaw: row.status,
    state,
    isHold: state === 'hold',
    holdExpiresAt: row.preauth_expires_at,
    rentalId: row.rental_id,
    rental: row.rental_id ? (rentalsById.get(row.rental_id) ?? null) : null,
  };
}

/** The invoice line-items, zero-value rows dropped. */
function invoiceLines(row: InvoiceQueryRow, tenant: Tenant | null): InvoiceLine[] {
  const candidates: ReadonlyArray<readonly [string, string, number]> = [
    ['rental', 'Rental', positive(row.rental_fee)],
    ['protection', 'Protection', positive(row.protection_fee)],
    ['insurance', 'Insurance', positive(row.insurance_premium)],
    ['delivery', 'Delivery', positive(row.delivery_fee)],
    ['extras', 'Extras', positive(row.extras_total)],
    ['service', 'Service fee', positive(row.service_fee)],
    [
      'deposit',
      // A tenant on the older flow places a hold instead of billing a deposit,
      // and calling that "Security deposit" tells the customer money left their
      // account when it did not.
      tenant?.deposit_charge_enabled ? 'Security deposit' : 'Pre-authorisation',
      positive(row.security_deposit),
    ],
  ];

  return candidates
    .filter(([, , amount]) => amount > 0)
    .map(([lineKey, label, amount]) => ({ key: lineKey, label, amount }));
}

/**
 * Split each booking's received payments across that booking's invoices,
 * oldest invoice first.
 *
 * v1 does NOT do this: it sums a rental's payments and compares the whole sum
 * against every invoice on that rental independently. A booking with a $500
 * original invoice and a $200 extension invoice, paid $500, comes out of v1
 * with BOTH marked paid — the customer is told they owe nothing while $200 is
 * outstanding. Understating a balance is the worst direction to be wrong in, so
 * the sum is allocated here instead: oldest debt settled first, which is both
 * the ordinary accounting convention and the only ordering that cannot mark a
 * later invoice paid out of an earlier one's money.
 *
 * Ordering is by `created_at`, falling back to `invoice_date` (a DATE, so it
 * ties for everything raised the same day) and then the id, so the result is
 * stable across renders.
 */
function allocateInvoices(
  rows: readonly InvoiceQueryRow[],
  netByRental: ReadonlyMap<string, number>,
): Map<string, number> {
  const byRental = new Map<string, InvoiceQueryRow[]>();
  for (const row of rows) {
    const bucket = byRental.get(row.rental_id);
    if (bucket) bucket.push(row);
    else byRental.set(row.rental_id, [row]);
  }

  const paidByInvoice = new Map<string, number>();

  for (const [rentalId, invoices] of byRental) {
    let pool = netByRental.get(rentalId) ?? 0;

    const ordered = [...invoices].sort((a, b) => {
      const aStamp = a.created_at ?? '';
      const bStamp = b.created_at ?? '';
      if (aStamp !== bStamp) return aStamp < bStamp ? -1 : 1;
      if (a.invoice_date !== b.invoice_date) {
        return a.invoice_date < b.invoice_date ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    });

    for (const invoice of ordered) {
      const applied = Math.min(Math.max(pool, 0), invoice.total_amount);
      paidByInvoice.set(invoice.id, round2(applied));
      pool = round2(pool - applied);
    }
  }

  return paidByInvoice;
}

function invoiceState(
  total: number,
  paid: number,
  dueDate: string | null,
  cancelled: boolean,
  today: string,
): InvoiceState {
  if (cancelled) return 'cancelled';
  // A hair of float slop must not leave a fully-paid invoice reading "Due 0.00".
  if (paid + 0.005 >= total) return 'paid';
  if (paid > 0) return 'part_paid';
  if (dueDate !== null && dueDate < today) return 'overdue';
  return 'due';
}

function normalizeInvoice(
  row: InvoiceQueryRow,
  paid: number,
  rentalsById: ReadonlyMap<string, CustomerRental>,
  tenant: Tenant | null,
  today: string,
): CustomerInvoice {
  const rental = rentalsById.get(row.rental_id) ?? null;
  const cancelled = rental?.lifecycle === 'cancelled';
  const state = invoiceState(row.total_amount, paid, row.due_date, cancelled, today);

  return {
    id: row.id,
    number: row.invoice_number || `#${row.id.slice(0, 8)}`,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    rentalId: row.rental_id,
    statusRaw: row.status,
    state,
    lines: invoiceLines(row, tenant),
    subtotal: row.subtotal,
    tax: round2(positive(row.tax_amount)),
    total: row.total_amount,
    paid: round2(paid),
    outstanding:
      state === 'cancelled' ? 0 : round2(Math.max(0, row.total_amount - paid)),
    rental,
  };
}

const PLAN_TYPE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  semiweekly: 'Twice weekly',
  biweekly: 'Fortnightly',
  monthly: 'Monthly',
  daily: 'Daily',
};

function installmentState(
  row: InstallmentQueryRow,
  today: string,
): InstallmentState {
  const status = key(row.status);
  if (status === 'paid') return 'paid';
  if (status === 'failed') return 'failed';
  if (row.due_date < today) return 'overdue';
  if (row.due_date === today) return 'due_today';
  return 'scheduled';
}

function normalizePlan(
  row: PlanQueryRow,
  rentalsById: ReadonlyMap<string, CustomerRental>,
  today: string,
): CustomerInstallmentPlan {
  const installments = [...(row.scheduled_installments ?? [])]
    .sort((a, b) => a.installment_number - b.installment_number)
    .map<CustomerInstallment>((inst) => ({
      id: inst.id,
      number: inst.installment_number,
      amount: inst.amount,
      dueDate: inst.due_date,
      statusRaw: inst.status,
      state: installmentState(inst, today),
      paidAt: inst.paid_at,
      failureCount: inst.failure_count ?? 0,
      failureReason: inst.last_failure_reason,
    }));

  const status = key(row.status);
  const paid = round2(positive(row.total_paid));

  return {
    id: row.id,
    rentalId: row.rental_id,
    rental: rentalsById.get(row.rental_id) ?? null,
    planTypeLabel:
      PLAN_TYPE_LABEL[key(row.plan_type)] ??
      // Unknown plan types are shown as the operator spelled them rather than
      // hidden — an unlabelled schedule is worse than an unfamiliar word.
      (row.plan_type || 'Instalment'),
    statusRaw: row.status,
    isActive: status === 'active' || status === 'overdue',
    isComplete: status === 'completed',
    isPending: status === 'pending',
    total: row.total_installable_amount,
    instalmentAmount: row.installment_amount,
    count: row.number_of_installments,
    paidCount: row.paid_installments ?? 0,
    paid,
    remaining: round2(Math.max(0, row.total_installable_amount - paid)),
    progress:
      row.number_of_installments > 0
        ? Math.min(1, (row.paid_installments ?? 0) / row.number_of_installments)
        : 0,
    upfrontAmount: row.upfront_amount,
    upfrontPaid: row.upfront_paid === true,
    nextDueDate: row.next_due_date,
    installments,
  };
}

/**
 * Ledger categories, as the customer sees them.
 *
 * `ledger_entries_category_check` already fixes the vocabulary to readable
 * title-case English — 'Rental', 'Excess Mileage', 'Delivery Fee', 'Security
 * Deposit' and eighteen more — so the values pass through VERBATIM. Only
 * 'InitialFee' is unreadable as written, and only it is rewritten. A blanket
 * relabelling map was the first version of this and it was a liability: it
 * silently sentence-cased four categories, and any category added to the
 * constraint later would have rendered in a different case from its siblings.
 */
const LEDGER_CATEGORY_LABEL: Record<string, string> = {
  initialfee: 'Initial fees',
};

/* ───────────────────────────── the raw queries ─────────────────────────── */

interface Scope {
  customerId: string | null;
  tenantId: string | null;
}

function useScope(): Scope & { isLoading: boolean } {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { customerId, isLoading: authLoading } = useCustomer();
  return {
    customerId,
    tenantId: tenant?.id ?? null,
    isLoading: tenantLoading || authLoading,
  };
}

function useInvoiceRows({ customerId, tenantId }: Scope) {
  return useQuery({
    queryKey: ['customer-invoices', tenantId, customerId],
    queryFn: async (): Promise<InvoiceQueryRow[]> => {
      if (!customerId || !tenantId) return [];
      const { data, error } = await supabase
        .from('invoices')
        .select(INVOICE_COLUMNS)
        // Read the file header before touching either of these.
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .order('invoice_date', { ascending: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .overrideTypes<InvoiceQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerPayments] Failed to load invoices', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your invoices');
      }
      return data ?? [];
    },
    enabled: !!customerId && !!tenantId,
  });
}

function usePaymentRows({ customerId, tenantId }: Scope) {
  return useQuery({
    queryKey: ['customer-payment-history', tenantId, customerId],
    queryFn: async (): Promise<PaymentQueryRow[]> => {
      if (!customerId || !tenantId) return [];
      const { data, error } = await supabase
        .from('payments')
        .select(PAYMENT_COLUMNS)
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false })
        .overrideTypes<PaymentQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerPayments] Failed to load payments', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your payments');
      }
      return data ?? [];
    },
    enabled: !!customerId && !!tenantId,
  });
}

function useLedgerRows({ customerId, tenantId }: Scope) {
  return useQuery({
    queryKey: ['customer-ledger', tenantId, customerId],
    queryFn: async (): Promise<LedgerQueryRow[]> => {
      if (!customerId || !tenantId) return [];
      const { data, error } = await supabase
        .from('ledger_entries')
        .select(LEDGER_COLUMNS)
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        // Charges only. A `Payment` / `Credit` row is the other half of the
        // double entry and is already reflected in `remaining_amount`; summing
        // both sides would double-count every settlement.
        .eq('type', 'Charge')
        .gt('remaining_amount', 0)
        .order('due_date', { ascending: true, nullsFirst: false })
        .overrideTypes<LedgerQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerPayments] Failed to load balance', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your balance');
      }
      return data ?? [];
    },
    enabled: !!customerId && !!tenantId,
  });
}

function usePlanRows({ customerId, tenantId }: Scope) {
  return useQuery({
    queryKey: ['customer-installment-plans', tenantId, customerId],
    queryFn: async (): Promise<PlanQueryRow[]> => {
      if (!customerId || !tenantId) return [];
      const { data, error } = await supabase
        .from('installment_plans')
        .select(PLAN_SELECT)
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false, nullsFirst: false })
        .overrideTypes<PlanQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerPayments] Failed to load instalment plans', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your instalment plans');
      }
      return data ?? [];
    },
    enabled: !!customerId && !!tenantId,
  });
}

/* ─────────────────────────────── the hook ──────────────────────────────── */

export interface UseCustomerPaymentsResult {
  balance: CustomerBalance;
  invoices: CustomerInvoice[];
  payments: CustomerPayment[];
  plans: CustomerInstallmentPlan[];
  /** Plans still collecting money, newest first. */
  activePlans: CustomerInstallmentPlan[];
  /** The soonest unpaid instalment across every active plan, or null. */
  nextInstallment: {
    plan: CustomerInstallmentPlan;
    installment: CustomerInstallment;
  } | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const EMPTY_BALANCE: CustomerBalance = {
  outstanding: 0,
  overdue: 0,
  paidToDate: 0,
  categories: [],
  nextDueDate: null,
  cancelledCharges: 0,
};

/**
 * Everything the payments page renders, from four queries and the rentals cache.
 *
 * `useCustomerRentals()` is reused rather than re-fetched — it is the same
 * React Query cache entry the bookings pages already populate, so this costs
 * nothing on a warm cache and guarantees that a booking's lifecycle reads the
 * same here as it does on /portal/bookings.
 */
export function useCustomerPayments(): UseCustomerPaymentsResult {
  const scope = useScope();
  const { tenant } = useTenant();
  const {
    rentals,
    isLoading: rentalsLoading,
    isError: rentalsError,
    error: rentalsErrorValue,
    refetch: refetchRentals,
  } = useCustomerRentals();

  const invoiceQuery = useInvoiceRows(scope);
  const paymentQuery = usePaymentRows(scope);
  const ledgerQuery = useLedgerRows(scope);
  const planQuery = usePlanRows(scope);

  const rentalsById = useMemo(() => {
    const map = new Map<string, CustomerRental>();
    for (const rental of rentals) map.set(rental.id, rental);
    return map;
  }, [rentals]);

  const payments = useMemo<CustomerPayment[]>(
    () => (paymentQuery.data ?? []).map((row) => normalizePayment(row, rentalsById)),
    [paymentQuery.data, rentalsById],
  );

  const invoices = useMemo<CustomerInvoice[]>(() => {
    const rows = invoiceQuery.data ?? [];
    if (rows.length === 0) return [];

    // Net received per booking, from the payment rows we already have — one
    // fewer round trip than v1, and it cannot disagree with the history list
    // below because it is the same data.
    const netByRental = new Map<string, number>();
    for (const payment of payments) {
      if (!payment.rentalId || payment.net === 0) continue;
      netByRental.set(
        payment.rentalId,
        round2((netByRental.get(payment.rentalId) ?? 0) + payment.net),
      );
    }

    const paidByInvoice = allocateInvoices(rows, netByRental);
    const today = todayDateString();
    return rows.map((row) =>
      normalizeInvoice(row, paidByInvoice.get(row.id) ?? 0, rentalsById, tenant, today),
    );
  }, [invoiceQuery.data, payments, rentalsById, tenant]);

  const plans = useMemo<CustomerInstallmentPlan[]>(() => {
    const today = todayDateString();
    return (planQuery.data ?? []).map((row) => normalizePlan(row, rentalsById, today));
  }, [planQuery.data, rentalsById]);

  const balance = useMemo<CustomerBalance>(() => {
    const rows = ledgerQuery.data;
    const paidToDate = round2(
      payments.reduce((sum, payment) => sum + payment.net, 0),
    );

    if (!rows || rows.length === 0) {
      return { ...EMPTY_BALANCE, paidToDate };
    }

    const today = todayDateString();
    let outstanding = 0;
    let overdue = 0;
    let cancelledCharges = 0;
    let nextDueDate: string | null = null;
    const byCategory = new Map<string, number>();

    for (const row of rows) {
      const amount = positive(row.remaining_amount);
      if (amount === 0) continue;

      // A charge whose booking is gone is not chased on screen. Charges with no
      // `rental_id` are account-level and always counted.
      const rental = row.rental_id ? rentalsById.get(row.rental_id) : undefined;
      if (rental?.lifecycle === 'cancelled') {
        cancelledCharges = round2(cancelledCharges + amount);
        continue;
      }

      outstanding = round2(outstanding + amount);

      if (row.due_date !== null && row.due_date < today) {
        overdue = round2(overdue + amount);
      } else if (
        row.due_date !== null &&
        (nextDueDate === null || row.due_date < nextDueDate)
      ) {
        nextDueDate = row.due_date;
      }

      const label =
        LEDGER_CATEGORY_LABEL[key(row.category)] ?? (row.category || 'Other');
      byCategory.set(label, round2((byCategory.get(label) ?? 0) + amount));
    }

    const categories = [...byCategory.entries()]
      .map<BalanceCategory>(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

    return {
      outstanding,
      overdue,
      paidToDate,
      categories,
      nextDueDate,
      cancelledCharges,
    };
  }, [ledgerQuery.data, payments, rentalsById]);

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.isActive || plan.isPending),
    [plans],
  );

  const nextInstallment = useMemo(() => {
    let best: {
      plan: CustomerInstallmentPlan;
      installment: CustomerInstallment;
    } | null = null;

    for (const plan of plans) {
      if (!plan.isActive) continue;
      for (const installment of plan.installments) {
        if (installment.state === 'paid') continue;
        if (best === null || installment.dueDate < best.installment.dueDate) {
          best = { plan, installment };
        }
      }
    }
    return best;
  }, [plans]);

  const queries = [invoiceQuery, paymentQuery, ledgerQuery, planQuery];

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchRentals(),
      invoiceQuery.refetch(),
      paymentQuery.refetch(),
      ledgerQuery.refetch(),
      planQuery.refetch(),
    ]);
  }, [refetchRentals, invoiceQuery, paymentQuery, ledgerQuery, planQuery]);

  const scopeReady = !!scope.customerId && !!scope.tenantId;

  return {
    balance,
    invoices,
    payments,
    plans,
    activePlans,
    nextInstallment,
    // The tenant and auth round-trips are part of this hook's load from the
    // caller's point of view: until both land `enabled` is false and React
    // Query reports idle, so reading `isPending` alone flashes an empty account
    // at a customer who has invoices.
    isLoading:
      scope.isLoading ||
      rentalsLoading ||
      (scopeReady &&
        queries.some((q) => q.isPending && q.fetchStatus !== 'idle')),
    isError: rentalsError || queries.some((q) => q.isError),
    error:
      rentalsErrorValue ??
      queries.find((q) => q.error !== null)?.error ??
      null,
    refetch,
  };
}
