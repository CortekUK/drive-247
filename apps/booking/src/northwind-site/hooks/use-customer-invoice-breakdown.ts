'use client';

/**
 * One invoice, broken down the way the OPERATOR sees it — so the customer and
 * the operator are looking at the same numbers when they talk about a payment.
 *
 * The operator's invoice sheet (apps/portal components/finances-v2:
 * `invoice-detail-sheet.tsx` + `finance-data.ts`) reads:
 *
 *   Charges   `ledger_entries` type 'Charge' on the invoice's RENTAL — the real
 *             line items, extensions included, each with what is still owed
 *             (`remaining_amount`). Total / Paid / Remaining are summed from
 *             them, never from the invoice row's booking-time snapshot.
 *   Payments  `payment_applications` (payment → charge, how much), joined to
 *             `payments`. A payment split across charges sits under each.
 *   Refunds   recorded ON the payment; a split payment's refund is shared
 *             pro rata to what it paid each charge.
 *
 * The pure maths below is a COPY of the operator's (`invoiceTotals`,
 * `chargeState`, `paymentState`, `dueState`, `refundOf`, `refundShare`), kept
 * line-for-line equivalent on purpose: if the two drift, the customer and the
 * operator see different figures for the same invoice. Change both or neither.
 *
 * ── ISOLATION ───────────────────────────────────────────────────────────────
 * RLS is OFF on all three tables. Same rule as `use-customer-payments.ts`: the
 * customer id and tenant id come from the auth store, never from an argument.
 *   - ledger_entries     .eq('customer_id').eq('tenant_id').eq('rental_id')
 *   - payment_applications has no customer_id: filtered by tenant AND by
 *                        `charge_entry_id IN (the charge ids above)`, which are
 *                        already this customer's.
 *   - payments           .eq('customer_id').eq('tenant_id').in('id', …)
 * The rental id passed in is only ever a FILTER on top of those; a wrong one
 * returns nothing, never someone else's rows.
 *
 * Not read, on purpose: every stripe_* / square_* id, `payment_provider`,
 * `booking_source`, `platform_account`, `verified_by`, refund ids and reasons,
 * and the invoice's `notes`. How a payment was taken is told from `method` only.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase, supabaseUntyped } from '@nw/integrations/supabase/client';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { parseDateOnly } from '@nw/lib/domain';
import type { CustomerInvoice } from '@nw/hooks/use-customer-payments';

/* ─────────────────────────────── row shapes ─────────────────────────────── */

interface ChargeRow {
  id: string;
  category: string | null;
  amount: number | string | null;
  remaining_amount: number | string | null;
  entry_date: string | null;
  due_date: string | null;
}

interface AllocationRow {
  id: string;
  payment_id: string;
  charge_entry_id: string;
  amount_applied: number | string | null;
}

/** The payment columns a customer may read — no provider ids, no internals. */
interface PaymentRow {
  id: string;
  amount: number | string | null;
  payment_date: string | null;
  paid_at: string | null;
  method: string | null;
  status: string | null;
  refund_amount: number | string | null;
  refund_status: string | null;
  refund_processed_at: string | null;
  refund_scheduled_date: string | null;
}

const CHARGE_COLUMNS = 'id, category, amount, remaining_amount, entry_date, due_date';
const ALLOCATION_COLUMNS = 'id, payment_id, charge_entry_id, amount_applied';
const PAYMENT_COLUMNS =
  'id, amount, payment_date, paid_at, method, status, refund_amount, refund_status, refund_processed_at, refund_scheduled_date';

/* ───────────────────────── the operator's maths (copy) ───────────────────── */

/** Half a cent: anything owed below this is paid. */
export const EPS = 0.005;

/** The operator list's tones. `muted` is the operator's grey. */
export type BreakdownTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';
export type BreakdownState = { label: string; tone: BreakdownTone };

const num = (v: number | string | null | undefined) => Number(v || 0);
const remainingOf = (c: ChargeRow) => Number(c.remaining_amount ?? c.amount ?? 0);

export function chargeState(amount: number, paid: number): BreakdownState {
  if (amount - paid <= EPS) return { label: 'Paid', tone: 'success' };
  if (paid > EPS) return { label: 'Part paid', tone: 'warning' };
  return { label: 'Unpaid', tone: 'muted' };
}

export function paymentState(total: number, paid: number, cancelled = false): BreakdownState {
  if (cancelled) return { label: 'Cancelled', tone: 'danger' };
  if (total > 0 && total - paid <= EPS) return { label: 'Paid', tone: 'success' };
  if (paid > EPS) return { label: 'Part paid', tone: 'warning' };
  return { label: 'Unpaid', tone: 'muted' };
}

/** Holds, not debts: never overdue. */
const NOT_DUE = new Set(['Security Deposit']);

/** The date the owed money falls due: the earliest among charges still owed. */
export function dueDateOf(invoiceDueDate: string | null, charges: readonly ChargeRow[]): string | null {
  if (charges.length === 0) return invoiceDueDate ?? null;
  let earliest: string | null = null;
  for (const c of charges) {
    if (NOT_DUE.has(c.category ?? '')) continue;
    if (remainingOf(c) <= EPS) continue;
    const due = c.due_date ?? null;
    if (due && (!earliest || due < earliest)) earliest = due;
  }
  return earliest;
}

const DAY = 86_400_000;
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export function dueState(
  invoice: { invoiceDate: string | null; dueDate: string | null },
  charges: readonly ChargeRow[],
  owes: number,
  cancelled: boolean,
  today = new Date(),
): BreakdownState | null {
  if (cancelled || owes <= EPS) return null;
  const due = dueDateOf(invoice.dueDate, charges);
  if (!due) return { label: 'No due date', tone: 'muted' };
  const d = parseDateOnly(due.slice(0, 10));
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d.getTime() - t.getTime()) / DAY);
  if (diff < 0) return { label: `Overdue · ${days(-diff)}`, tone: 'danger' };
  if (diff === 0) {
    return invoice.invoiceDate && due.slice(0, 10) === invoice.invoiceDate.slice(0, 10)
      ? { label: 'Due on receipt', tone: 'warning' }
      : { label: 'Due today', tone: 'warning' };
  }
  return { label: `Upcoming · ${days(diff)}`, tone: 'info' };
}

/** Statuses where the money actually landed (the operator's `isLanded`). */
const LANDED = new Set(['Applied', 'Completed', 'Partial', 'Credit', 'Partial Refund', 'Refunded']);

/** A refund recorded on a payment, capped at the payment itself (operator `refundOf`). */
function refundOf(p: PaymentRow) {
  const raw = num(p.refund_amount);
  if (raw <= EPS) return null;
  return {
    amount: Math.min(raw, num(p.amount) || raw),
    date: p.refund_processed_at ?? p.refund_scheduled_date ?? null,
    pending: ['processing', 'scheduled', 'pending'].includes((p.refund_status ?? '').toLowerCase()),
  };
}

/** This allocation's share of its payment's refund, pro rata (operator `refundShare`). */
function refundShare(p: PaymentRow, applied: number): number {
  const r = refundOf(p);
  const whole = num(p.amount);
  if (!r || whole <= EPS) return 0;
  return Math.round(((r.amount * applied) / whole) * 100) / 100;
}

/**
 * How a payment was made, in the customer's words, from `method` alone
 * (the operator's `manualMethod`, without its provider channel — "Link
 * emailed" / "Auto-charge" describe the operator's tooling, not the customer's
 * payment). Nothing useful typed → "Payment".
 */
export function paymentMethodLabel(method: string | null): string {
  const raw = (method ?? '').replace(/^other:\s*/i, '').trim();
  const m = raw.toLowerCase();
  if (!raw || m === 'other') return 'Payment';
  if (/cash(?!\s*app)/.test(m) && !/cashapp/.test(m)) return 'Cash';
  if (/bank|transfer|wire|\bach\b/.test(m)) return 'Bank transfer';
  if (/che(que|ck)/.test(m)) return 'Cheque';
  if (/card|debit|credit|stripe|square/.test(m)) return 'Card';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** A not-landed payment's word, in the customer portal's vocabulary. */
const STATUS_WORD: Record<string, string> = {
  Pending: 'Processing',
  Reversed: 'Cancelled',
};

/* ─────────────────────────────── view model ─────────────────────────────── */

export interface BreakdownRefund {
  /** This charge's share of the refund. */
  amount: number;
  /** The whole refund on the payment (differs from `amount` when the payment was split). */
  whole: number;
  /** A timestamp or a date-only string; may be null. */
  date: string | null;
  pending: boolean;
  /** Went back to a card (the payment was by card). */
  toCard: boolean;
}

export interface BreakdownPayment {
  /** The allocation row's id — unique per (payment, charge). */
  key: string;
  /** "Card", "Cash", "Bank transfer", … */
  label: string;
  /** `paid_at` (timestamp) when known, else `payment_date` (date-only). */
  paidAt: string | null;
  paymentDate: string | null;
  /** What this payment put on THIS charge. */
  applied: number;
  /** The whole payment. */
  whole: number;
  /** The payment was split across several charges. */
  split: boolean;
  /** Money actually landed. False → `statusWord` explains (Processing, Cancelled). */
  landed: boolean;
  statusWord: string | null;
  refund: BreakdownRefund | null;
}

export interface BreakdownCharge {
  id: string;
  /** The ledger category, verbatim ("Rental", "Service Fee", …). */
  label: string;
  /** DATE-only. */
  entryDate: string | null;
  amount: number;
  /** Paid and kept on this charge (amount − remaining). */
  paid: number;
  remaining: number;
  /** Money given back on this charge's payments. */
  refunded: number;
  state: BreakdownState;
  payments: BreakdownPayment[];
}

export interface InvoiceBreakdown {
  charges: BreakdownCharge[];
  /** total − paid = remaining (operator `invoiceTotals`; no credit notes in live data). */
  total: number;
  paid: number;
  remaining: number;
  cancelled: boolean;
  /** Paid · Part paid · Unpaid · Cancelled — from the figures above. */
  status: BreakdownState;
  /** Overdue · 3 days, Upcoming · 5 days, … — null when nothing is owed. */
  due: BreakdownState | null;
  /** The earliest due date among charges still owed (DATE-only), or null. */
  dueDate: string | null;
}

type InvoiceInput = Pick<
  CustomerInvoice,
  'id' | 'rentalId' | 'invoiceDate' | 'dueDate' | 'total' | 'statusRaw' | 'state'
>;

interface RawBreakdown {
  charges: ChargeRow[];
  allocations: AllocationRow[];
  payments: PaymentRow[];
}

/** Pure: the raw rows → what the dialog shows. Exported for tests. */
export function buildInvoiceBreakdown(
  invoice: InvoiceInput,
  raw: RawBreakdown,
  today = new Date(),
): InvoiceBreakdown {
  const paymentById = new Map(raw.payments.map((p) => [p.id, p]));
  const allocsByCharge = new Map<string, AllocationRow[]>();
  for (const a of raw.allocations) {
    const list = allocsByCharge.get(a.charge_entry_id);
    if (list) list.push(a);
    else allocsByCharge.set(a.charge_entry_id, [a]);
  }

  const charges: BreakdownCharge[] = raw.charges.map((c) => {
    const amount = num(c.amount);
    const remaining = Math.max(0, Number(c.remaining_amount ?? amount));
    const paid = Math.max(0, amount - remaining);
    const payments: BreakdownPayment[] = [];
    let refunded = 0;
    for (const a of allocsByCharge.get(c.id) ?? []) {
      const p = paymentById.get(a.payment_id);
      // A payment row we cannot read (not this customer's, or gone) is not shown.
      if (!p) continue;
      const applied = num(a.amount_applied);
      const whole = num(p.amount);
      const landed = LANDED.has(p.status ?? '');
      const r = refundOf(p);
      const share = refundShare(p, applied);
      refunded += share;
      const label = paymentMethodLabel(p.method);
      payments.push({
        key: a.id,
        label,
        paidAt: p.paid_at,
        paymentDate: p.payment_date,
        applied,
        whole,
        split: Math.abs(whole - applied) > EPS,
        landed,
        statusWord: !landed && p.status ? (STATUS_WORD[p.status] ?? p.status) : null,
        refund:
          r && share > EPS
            ? { amount: share, whole: r.amount, date: r.date, pending: r.pending, toCard: label === 'Card' }
            : null,
      });
    }
    return {
      id: c.id,
      label: c.category ?? 'Charge',
      entryDate: c.entry_date,
      amount,
      paid,
      remaining,
      refunded,
      state: chargeState(amount, paid),
      payments,
    };
  });

  // invoiceTotals: summed from the charges; no charges → the invoice's own total.
  const total = charges.length ? charges.reduce((s, c) => s + c.amount, 0) : Number(invoice.total || 0);
  const remaining = charges.length
    ? Math.max(0, raw.charges.reduce((s, c) => s + remainingOf(c), 0))
    : total;
  const paid = Math.max(0, total - remaining);
  // The operator's rule (invoice-payments-table.tsx / invoice-detail-sheet.tsx):
  // an invoice is cancelled when ITS status says so — not when its booking
  // closed. The table and this sheet must call the same invoices cancelled.
  const cancelled = invoice.statusRaw === 'cancelled';

  return {
    charges,
    total,
    paid,
    remaining,
    cancelled,
    status: paymentState(total, paid, cancelled),
    due: dueState(invoice, raw.charges, remaining, cancelled, today),
    dueDate: dueDateOf(invoice.dueDate, raw.charges),
  };
}

/* ───────────────────────────────── the hook ─────────────────────────────── */

export interface UseCustomerInvoiceBreakdownResult {
  breakdown: InvoiceBreakdown | null;
  isLoading: boolean;
  error: Error | null;
}

export const customerInvoiceBreakdownKey = (
  tenantId: string | null,
  customerId: string | null,
  rentalId: string | null,
) => ['customer-invoice-breakdown', tenantId, customerId, rentalId];

/**
 * The signed-in customer's invoice, itemised from the ledger. Pass the invoice
 * from `useCustomerPayments()` (or null while nothing is open).
 */
export function useCustomerInvoiceBreakdown(
  invoice: InvoiceInput | null,
): UseCustomerInvoiceBreakdownResult {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;
  const rentalId = invoice?.rentalId ?? null;

  const query = useQuery({
    queryKey: customerInvoiceBreakdownKey(tenantId, customerId, rentalId),
    enabled: !!tenantId && !!customerId && !!rentalId,
    queryFn: async (): Promise<RawBreakdown> => {
      if (!tenantId || !customerId || !rentalId) return { charges: [], allocations: [], payments: [] };

      const { data: charges, error: chargeError } = await supabaseUntyped
        .from('ledger_entries')
        .select(CHARGE_COLUMNS)
        // Read the file header before touching either of these.
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .eq('rental_id', rentalId)
        .eq('type', 'Charge')
        .order('entry_date', { ascending: true })
        .order('id');
      if (chargeError) throw new Error(chargeError.message || 'Failed to load this invoice');
      const chargeRows = (charges ?? []) as ChargeRow[];
      if (chargeRows.length === 0) return { charges: [], allocations: [], payments: [] };

      const { data: allocations, error: allocError } = await supabaseUntyped
        .from('payment_applications')
        .select(ALLOCATION_COLUMNS)
        .eq('tenant_id', tenantId)
        // No customer_id on this table: the charge ids ARE the scope.
        .in(
          'charge_entry_id',
          chargeRows.map((c) => c.id),
        )
        .order('id');
      if (allocError) throw new Error(allocError.message || 'Failed to load this invoice');
      const allocationRows = (allocations ?? []) as AllocationRow[];

      const paymentIds = [...new Set(allocationRows.map((a) => a.payment_id))];
      let paymentRows: PaymentRow[] = [];
      if (paymentIds.length > 0) {
        const { data: payments, error: paymentError } = await supabase
          .from('payments')
          .select(PAYMENT_COLUMNS)
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .in('id', paymentIds)
          .overrideTypes<PaymentRow[], { merge: false }>();
        if (paymentError) throw new Error(paymentError.message || 'Failed to load this invoice');
        paymentRows = payments ?? [];
      }

      // An allocation whose payment is not this customer's is dropped with it.
      const own = new Set(paymentRows.map((p) => p.id));
      return {
        charges: chargeRows,
        allocations: allocationRows.filter((a) => own.has(a.payment_id)),
        payments: paymentRows,
      };
    },
  });

  return {
    breakdown: invoice && query.data ? buildInvoiceBreakdown(invoice, query.data) : null,
    isLoading: !!rentalId && (query.isLoading || query.isPending) && !query.data,
    error: (query.error as Error | null) ?? null,
  };
}

/* ─────────────────────────── the list's figures ──────────────────────────── */

/**
 * Every invoice's row in the Finances table, figured exactly as the operator's
 * table figures it (invoice-payments-table.tsx, with `invoiceTotals`,
 * `paymentState`, `dueState`, `dueDateOf` and `entityLabel` from
 * finance-data.ts):
 *
 *   Total − Paid = Remaining, summed from the RENTAL's charges (extensions
 *   included), never from the invoice row's booking-time snapshot. No charges
 *   → the invoice's own total, owed in full.
 *
 * Same isolation as the breakdown above: every read carries the customer id and
 * tenant id from the auth store; `payment_applications` is scoped by the charge
 * ids those reads returned.
 */

export interface InvoiceRowFigures {
  /** "Rental" | "Customer": the operator's `entityLabel` for a live invoice. */
  entity: string;
  total: number;
  /** Paid and kept (no credit notes in live data, so equal to `settled`). */
  paid: number;
  settled: number;
  owes: number;
  cancelled: boolean;
  /** Paid · Part paid · Unpaid · Cancelled. */
  status: BreakdownState;
  /** Overdue · 3 days, Upcoming · 5 days … null when nothing is owed. */
  due: BreakdownState | null;
  /** The date the row shows: the earliest unpaid charge's while money is owed, else the invoice's. */
  dueDate: string | null;
  chargeCount: number;
  /** Separate payments (money landed) toward these charges. */
  paymentCount: number;
}

interface FigureChargeRow extends ChargeRow {
  rental_id: string;
}

interface FiguresRaw {
  types: { id: string; invoice_type: string | null }[];
  charges: FigureChargeRow[];
  allocations: Pick<AllocationRow, 'payment_id' | 'charge_entry_id'>[];
  payments: { id: string; status: string | null }[];
}

/** The operator's `entityLabel` for an invoice without an explicit entity (every live row). */
export const entityLabelOf = (invoiceType: string | null | undefined) =>
  invoiceType === 'standalone' ? 'Customer' : 'Rental';

type FigureInput = Pick<CustomerInvoice, 'id' | 'rentalId' | 'invoiceDate' | 'dueDate' | 'total' | 'statusRaw'>;

/** Pure: the raw rows → one row of figures per invoice. Exported for tests. */
export function buildInvoiceFigures(
  invoices: readonly FigureInput[],
  raw: FiguresRaw,
  today = new Date(),
): Map<string, InvoiceRowFigures> {
  const typeById = new Map(raw.types.map((t) => [t.id, t.invoice_type]));
  const chargesByRental = new Map<string, FigureChargeRow[]>();
  for (const c of raw.charges) {
    const list = chargesByRental.get(c.rental_id);
    if (list) list.push(c);
    else chargesByRental.set(c.rental_id, [c]);
  }
  const landed = new Set(raw.payments.filter((p) => LANDED.has(p.status ?? '')).map((p) => p.id));
  const paymentsByCharge = new Map<string, string[]>();
  for (const a of raw.allocations) {
    const list = paymentsByCharge.get(a.charge_entry_id);
    if (list) list.push(a.payment_id);
    else paymentsByCharge.set(a.charge_entry_id, [a.payment_id]);
  }

  const out = new Map<string, InvoiceRowFigures>();
  for (const invoice of invoices) {
    const charges = (invoice.rentalId && chargesByRental.get(invoice.rentalId)) || [];
    const total = charges.length ? charges.reduce((s, c) => s + num(c.amount), 0) : Number(invoice.total || 0);
    const owes = charges.length ? Math.max(0, charges.reduce((s, c) => s + remainingOf(c), 0)) : total;
    const settled = Math.max(0, total - owes);
    const cancelled = invoice.statusRaw === 'cancelled';
    const paidBy = new Set<string>();
    for (const c of charges) {
      for (const pid of paymentsByCharge.get(c.id) ?? []) if (landed.has(pid)) paidBy.add(pid);
    }
    out.set(invoice.id, {
      entity: entityLabelOf(typeById.get(invoice.id)),
      total,
      paid: settled,
      settled,
      owes,
      cancelled,
      status: paymentState(total, settled, cancelled),
      due: dueState(invoice, charges, owes, cancelled, today),
      dueDate: owes > EPS && !cancelled ? dueDateOf(invoice.dueDate, charges) : invoice.dueDate,
      chargeCount: charges.length,
      paymentCount: paidBy.size,
    });
  }
  return out;
}

/** Ids per request for an `.in()` filter, so the list never outgrows a URL. */
const IN_CHUNK = 150;

export function useCustomerInvoiceFigures(invoices: readonly FigureInput[]): {
  figures: Map<string, InvoiceRowFigures>;
  isLoading: boolean;
  error: Error | null;
} {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  const query = useQuery({
    queryKey: ['customer-invoice-figures', tenantId, customerId],
    enabled: !!tenantId && !!customerId,
    queryFn: async (): Promise<FiguresRaw> => {
      if (!tenantId || !customerId) return { types: [], charges: [], allocations: [], payments: [] };

      const [typesRes, chargesRes] = await Promise.all([
        supabaseUntyped
          .from('invoices')
          .select('id, invoice_type')
          // Read the file header before touching either of these.
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId),
        supabaseUntyped
          .from('ledger_entries')
          .select(`rental_id, ${CHARGE_COLUMNS}`)
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .eq('type', 'Charge')
          .not('rental_id', 'is', null)
          .order('entry_date', { ascending: true })
          .order('id'),
      ]);
      if (typesRes.error) throw new Error(typesRes.error.message || 'Failed to load your invoices');
      if (chargesRes.error) throw new Error(chargesRes.error.message || 'Failed to load your invoices');
      const charges = (chargesRes.data ?? []) as FigureChargeRow[];

      // No customer_id on this table: the charge ids ARE the scope.
      const allocations: FiguresRaw['allocations'] = [];
      const chargeIds = charges.map((c) => c.id);
      for (let i = 0; i < chargeIds.length; i += IN_CHUNK) {
        const { data, error } = await supabaseUntyped
          .from('payment_applications')
          .select('payment_id, charge_entry_id')
          .eq('tenant_id', tenantId)
          .in('charge_entry_id', chargeIds.slice(i, i + IN_CHUNK));
        if (error) throw new Error(error.message || 'Failed to load your invoices');
        allocations.push(...((data ?? []) as FiguresRaw['allocations']));
      }

      const paymentIds = [...new Set(allocations.map((a) => a.payment_id))];
      const payments: FiguresRaw['payments'] = [];
      for (let i = 0; i < paymentIds.length; i += IN_CHUNK) {
        const { data, error } = await supabaseUntyped
          .from('payments')
          .select('id, status')
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .in('id', paymentIds.slice(i, i + IN_CHUNK));
        if (error) throw new Error(error.message || 'Failed to load your invoices');
        payments.push(...((data ?? []) as FiguresRaw['payments']));
      }

      return { types: (typesRes.data ?? []) as FiguresRaw['types'], charges, allocations, payments };
    },
  });

  const figures = useMemo(
    () => (query.data ? buildInvoiceFigures(invoices, query.data) : new Map<string, InvoiceRowFigures>()),
    [invoices, query.data],
  );

  return {
    figures,
    isLoading: !!tenantId && !!customerId && !query.data && !query.error,
    error: (query.error as Error | null) ?? null,
  };
}
