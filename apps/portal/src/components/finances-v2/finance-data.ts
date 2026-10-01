/**
 * Finances → Invoices: the data behind invoice → charges → payments → receipt.
 *
 * WHERE EACH LEVEL COMES FROM
 *  - Invoice — `invoices`, one per rental. Only its number, dates and parties
 *    are used: its flat amount columns (`rental_fee`, `insurance_premium`, …)
 *    are a snapshot taken at booking and never see an extension.
 *  - Charges — `ledger_entries` with type 'Charge' on the invoice's RENTAL.
 *    These are the real line items, extensions included, each carrying what is
 *    still owed (`remaining_amount`). The invoice's Total / Paid / Owes are
 *    summed from them, so the invoice is always current. Owed money is shown as
 *    Remaining.
 *  - Payments under a charge — `payment_applications` (payment → charge, how
 *    much). A payment split across charges appears under each, with its share,
 *    and all of those open the SAME receipt.
 *  - Receipt — one per payment; it lists everything that payment paid.
 *
 * Every read is filtered by `tenant_id` (V2_PLAN §5: RLS is off on all four
 * tables) and paged past PostgREST's 1,000-row cap.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { parseLocalDate } from "@/lib/date-utils";
import type { ListTone } from "@/components/shared/list-table-v2";

/** The fields Finances reads off an invoice. The Invoices tab's own `Invoice` satisfies it. */
export interface FinanceInvoice {
  id: string;
  rental_id: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  invoice_number: string;
  /** 'rental' | 'standalone' | 'third_party' (see the add_invoice_type migration). */
  invoice_type?: string | null;
  invoice_date: string;
  due_date: string | null;
  /** 'pending' | 'paid' | 'cancelled'. Only 'cancelled' is read: it overrides both statuses. */
  status?: string | null;
  notes?: string | null;
  created_at?: string | null;
  /** What the invoice is FOR — see Entity below. */
  entity?: Entity | null;
  /** Which one: the rental ("R-1041", "R-1041 · Ext 2"), the fine ("PCN-88213"), or for Customer the account ("C-0042"). */
  entity_ref?: string | null;
  /** What happened, in words: "Toll violation", "Rear bumper scuff"… */
  event?: string | null;
  /** Fine / Customer: the rental it happened during, for context. Not part of that rental's billing. */
  related_rental?: string | null;
  total_amount: number;
  customers: { name: string } | null;
  vehicles: { reg: string; make: string; model: string } | null;
}

export interface Charge {
  id: string;
  rental_id: string;
  category: string | null;
  amount: number;
  remaining_amount: number | null;
  entry_date: string | null;
  due_date: string | null;
  /** The invoice this charge is a line of. Set in the ideal model; absent on today's data. */
  invoice_id?: string | null;
}

/**
 * CREDIT NOTE — "you owe us LESS": part of a line forgiven or corrected down
 * (a day not used, a waived fee, overcharged). A minus in the ledger.
 * If the line was already paid, what it frees is either kept ON ACCOUNT for the
 * customer or REFUNDED (`settled`).
 */
export interface CreditNote {
  id: string;
  /** CN-1041-001 */
  number?: string;
  charge_id: string;
  amount: number;
  reason: string;
  date: string;
  /** Money the note freed that had already been paid — and what happened to it. */
  overpaid?: number;
  settled?: "account" | "refund";
}

/**
 * DEBIT NOTE — "you owe us MORE": a line corrected up after its invoice was
 * issued (undercharged, an upgrade). A plus in the ledger. The line itself is
 * never edited; the note sits under it with its reason.
 */
export interface DebitNote {
  id: string;
  /** DN-1041-001 */
  number: string;
  charge_id: string;
  amount: number;
  reason: string;
  date: string;
}

export interface Allocation {
  id: string;
  payment_id: string;
  charge_entry_id: string;
  amount_applied: number;
}

export interface FinancePayment {
  id: string;
  amount: number;
  payment_date: string | null;
  paid_at: string | null;
  method: string | null;
  status: string | null;
  refund_amount: number | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  square_payment_id: string | null;
  square_payment_link_id: string | null;
  /** 'website' = taken on the booking site at checkout; 'admin' = started from the portal. */
  booking_source: string | null;
  payment_provider: string | null;
  refund_status: string | null;
  refund_processed_at: string | null;
  refund_scheduled_date: string | null;
  stripe_refund_id: string | null;
  square_refund_id: string | null;
  /** Which charges the refund gave money back on. Absent → split pro rata (today's data). */
  refund_lines?: { charge_entry_id: string; amount: number }[];
}

export const financesQueryKey = (tenantId: string | undefined) => ["finances-invoice-payments", tenantId];

const PAGE = 1000;

/** Every row of a tenant-scoped read, past PostgREST's per-request cap. */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export type FinanceIndex = ReturnType<typeof buildIndex>;

export function buildIndex(
  charges: Charge[],
  allocations: Allocation[],
  payments: FinancePayment[],
  credits: CreditNote[] = [],
  debits: DebitNote[] = [],
) {
  const chargesByRental = new Map<string, Charge[]>();
  const chargesByInvoice = new Map<string, Charge[]>();
  const chargeById = new Map<string, Charge>();
  for (const c of charges) {
    chargeById.set(c.id, c);
    const [map, key] = c.invoice_id ? [chargesByInvoice, c.invoice_id] : [chargesByRental, c.rental_id];
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }
  const creditsByCharge = new Map<string, CreditNote[]>();
  for (const cn of credits) {
    const list = creditsByCharge.get(cn.charge_id);
    if (list) list.push(cn);
    else creditsByCharge.set(cn.charge_id, [cn]);
  }
  const debitsByCharge = new Map<string, DebitNote[]>();
  for (const dn of debits) {
    const list = debitsByCharge.get(dn.charge_id);
    if (list) list.push(dn);
    else debitsByCharge.set(dn.charge_id, [dn]);
  }
  const allocsByCharge = new Map<string, Allocation[]>();
  const allocsByPayment = new Map<string, Allocation[]>();
  for (const a of allocations) {
    for (const [map, key] of [
      [allocsByCharge, a.charge_entry_id],
      [allocsByPayment, a.payment_id],
    ] as const) {
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
  }
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  return {
    chargesByRental,
    chargesByInvoice,
    chargeById,
    allocsByCharge,
    allocsByPayment,
    paymentById,
    creditsByCharge,
    debitsByCharge,
  };
}

/** Charges, allocations and payments for the tenant: three reads, joined once. */
export function useFinanceIndex(tenantId: string | undefined) {
  const { data } = useQuery({
    queryKey: financesQueryKey(tenantId),
    queryFn: async () => {
      if (!tenantId) return { charges: [], allocations: [], payments: [] };
      const [charges, allocations, payments] = await Promise.all([
        readAll<Charge>((a, b) =>
          supabase
            .from("ledger_entries")
            .select("id, rental_id, category, amount, remaining_amount, entry_date, due_date")
            .eq("tenant_id", tenantId)
            .eq("type", "Charge")
            .not("rental_id", "is", null)
            .order("entry_date", { ascending: true })
            .order("id")
            .range(a, b),
        ),
        readAll<Allocation>((a, b) =>
          supabaseUntyped
            .from("payment_applications")
            .select("id, payment_id, charge_entry_id, amount_applied")
            .eq("tenant_id", tenantId)
            .order("id")
            .range(a, b),
        ),
        readAll<FinancePayment>((a, b) =>
          supabase
            .from("payments")
            .select(
              "id, amount, payment_date, paid_at, method, status, refund_amount, stripe_checkout_session_id, stripe_payment_intent_id, square_payment_id, square_payment_link_id, booking_source, payment_provider, refund_status, refund_processed_at, refund_scheduled_date, stripe_refund_id, square_refund_id",
            )
            .eq("tenant_id", tenantId)
            .order("id")
            .range(a, b),
        ),
      ]);
      return { charges, allocations, payments };
    },
    enabled: !!tenantId,
  });

  return useMemo(
    () => buildIndex(data?.charges ?? [], data?.allocations ?? [], data?.payments ?? []),
    [data],
  );
}

/** Half a cent: anything owed below this is paid. */
export const EPS = 0.005;

/** What a charge has had paid against it, straight from the ledger. */
export const paidOf = (c: Charge) => Number(c.amount || 0) - Number(c.remaining_amount ?? c.amount ?? 0);

/** An invoice's figures, summed from its charges. */
/** Forgiven on a charge by credit notes. */
export const creditedOf = (c: Charge, index: FinanceIndex) =>
  (index.creditsByCharge.get(c.id) ?? []).reduce((s, cn) => s + Number(cn.amount || 0), 0);

/** Added to a charge by debit notes. */
export const debitedOf = (c: Charge, index: FinanceIndex) =>
  (index.debitsByCharge.get(c.id) ?? []).reduce((s, dn) => s + Number(dn.amount || 0), 0);

/** What a line is billed at now: its original amount plus any debit notes. */
export const billedOf = (c: Charge, index: FinanceIndex) => Number(c.amount || 0) + debitedOf(c, index);

/**
 * An invoice's figures. The charges are its own lines when it has them (the
 * ideal model: one invoice per event), else the rental's charges (today).
 *
 *   total − paid − credited = owes
 *
 * `paid` is money actually kept (net of refunds), `credited` is what was
 * forgiven by credit notes, `owes` is what the charges still have remaining.
 * `settled` = paid + credited: everything that is no longer owed.
 */
export function invoiceTotals(invoice: FinanceInvoice, index: FinanceIndex) {
  const charges =
    index.chargesByInvoice.get(invoice.id) ?? ((invoice.rental_id && index.chargesByRental.get(invoice.rental_id)) || []);
  // No charges at all means nothing to sum: fall back to the invoice's own total.
  // Billed = each line's original amount plus its debit notes.
  const total = charges.length
    ? charges.reduce((s, c) => s + billedOf(c, index), 0)
    : Number(invoice.total_amount || 0);
  const owes = charges.length ? Math.max(0, charges.reduce((s, c) => s + Number(c.remaining_amount ?? c.amount ?? 0), 0)) : total;
  const credited = charges.reduce((s, c) => s + creditedOf(c, index), 0);
  const settled = Math.max(0, total - owes);
  return { charges, total, paid: Math.max(0, settled - credited), credited, settled, owes };
}

/** Statuses where the money actually landed — the only payments with a receipt. */
// "Refunded" is here too: the money DID land — it was paid, then given back — so
// the payment still shows (as +) with its receipt, and the refund beside it (as −).
const LANDED = new Set(["Applied", "Completed", "Partial", "Credit", "Partial Refund", "Refunded"]);
export const isLanded = (p: Pick<FinancePayment, "status">) => LANDED.has(p.status ?? "");

export const PAYMENT_TONE: Record<string, ListTone> = {
  Applied: "success",
  Completed: "success",
  Partial: "success",
  Credit: "info",
  "Partial Refund": "warning",
  Pending: "warning",
  Reversed: "danger",
  Refunded: "muted",
};

export type State = { label: string; tone: ListTone };

export function chargeState(amount: number, paid: number): State {
  if (amount - paid <= EPS) return { label: "Paid", tone: "success" };
  if (paid > EPS) return { label: "Part paid", tone: "warning" };
  return { label: "Unpaid", tone: "muted" };
}

/* ─── The two statuses ────────────────────────────────────────────────────
 *
 *  PAYMENT (amount): how much is paid.      Unpaid · Part paid · Paid
 *  DUE     (time):   is what's owed late?   Upcoming · Due on receipt · Due today · Overdue · No due date
 *
 *  - Cancelled overrides both: the payment status reads "Cancelled", no due status.
 *  - The due status exists only while something is owed. A paid invoice has none
 *    ("—"), or every paid invoice from months ago would read Overdue.
 *  - The due date is the EARLIEST due date among the charges still owed, not the
 *    invoice's own: an extension added later carries its own due date, which the
 *    invoice's single date knows nothing about. Security deposits are left out —
 *    a hold is released, it is never "late". With no charges to read, the
 *    invoice's own due date is used.
 *  - Owed with no due date at all reads "No due date": never overdue, never chased.
 */

export function paymentState(total: number, paid: number, cancelled = false, draft = false): State {
  if (cancelled) return { label: "Cancelled", tone: "danger" };
  if (draft) return { label: "Draft", tone: "muted" };
  if (total > 0 && total - paid <= EPS) return { label: "Paid", tone: "success" };
  if (paid > EPS) return { label: "Part paid", tone: "warning" };
  return { label: "Unpaid", tone: "muted" };
}

/** Charge types that are holds, not debts: never overdue. */
const NOT_DUE = new Set(["Security Deposit"]);

/** The date the owed money falls due: the earliest among charges still owed. */
export function dueDateOf(invoice: FinanceInvoice, charges: readonly Charge[]): string | null {
  if (charges.length === 0) return invoice.due_date ?? null;
  let earliest: string | null = null;
  for (const c of charges) {
    if (NOT_DUE.has(c.category ?? "")) continue;
    if (Number(c.remaining_amount ?? c.amount ?? 0) <= EPS) continue;
    const due = c.due_date ?? null;
    if (due && (!earliest || due < earliest)) earliest = due;
  }
  return earliest;
}

const DAY = 86_400_000;

/** Whole calendar days from today to `date` (negative = in the past). */
function daysFromToday(date: string, today: Date): number {
  const d = parseLocalDate(date.slice(0, 10));
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / DAY);
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Null when there is no due status to show ("—"): paid, cancelled, or nothing owed. */
export function dueState(
  invoice: FinanceInvoice,
  charges: readonly Charge[],
  owes: number,
  today = new Date(),
): State | null {
  // A draft is not sent yet, so it cannot be late.
  if (invoice.status === "cancelled" || invoice.status === "draft" || owes <= EPS) return null;
  const due = dueDateOf(invoice, charges);
  if (!due) return { label: "No due date", tone: "muted" };
  const diff = daysFromToday(due, today);
  if (diff < 0) return { label: `Overdue · ${days(-diff)}`, tone: "danger" };
  if (diff === 0) {
    return invoice.invoice_date && due.slice(0, 10) === invoice.invoice_date.slice(0, 10)
      ? { label: "Due on receipt", tone: "warning" }
      : { label: "Due today", tone: "warning" };
  }
  return { label: `Upcoming · ${days(diff)}`, tone: "info" };
}

export const receiptNumber = (paymentId: string) => `RCPT-${paymentId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/** The chip text for an invoice's type. Anything unknown reads as a rental invoice. */
export const INVOICE_TYPE_LABEL: Record<string, string> = {
  rental: "Rental",
  standalone: "Standalone",
  third_party: "Third-party",
};
export const invoiceTypeLabel = (t: string | null | undefined) => INVOICE_TYPE_LABEL[t ?? "rental"] ?? "Rental";

/* ─── How a payment was taken ─────────────────────────────────────────────
 *
 *  Online (through Stripe or Square — same rules for both):
 *    Link emailed   staff sent a payment link and the customer paid it
 *                   (a Stripe Checkout session / Square payment link, started
 *                   from the portal)
 *    At booking     the customer paid on the booking site at checkout
 *                   (`booking_source = 'website'`)
 *    Auto-charge    the system charged a saved card — no checkout behind it
 *  Manual:
 *    Cash, Bank transfer, Zelle…  money that moved outside the system, which
 *                   staff recorded; labelled by its method
 *
 *  Online vs manual is read from the PROVIDER IDS, never from `method` (free
 *  text: 73 rows are blank, and Stripe link payments were typed in by hand as
 *  "Other: Stripelink") nor from `payment_provider` alone (it defaults to
 *  'stripe', even for cash). `payment_provider = 'square'` does count: that
 *  value is only ever written by the Square flows.
 */
export type PaymentProvider = "stripe" | "square" | "manual";
export type PaymentChannel = "Link emailed" | "At booking" | "Auto-charge" | "Manual";

export function paymentProvider(p: FinancePayment): PaymentProvider {
  if (p.square_payment_id || p.square_payment_link_id || p.payment_provider === "square") return "square";
  if (p.stripe_checkout_session_id || p.stripe_payment_intent_id) return "stripe";
  return "manual";
}

export function paymentChannel(p: FinancePayment): PaymentChannel {
  if (paymentProvider(p) === "manual") return "Manual";
  if (p.booking_source === "website") return "At booking";
  if (p.stripe_checkout_session_id || p.square_payment_link_id) return "Link emailed";
  return "Auto-charge";
}

/**
 * What a manual payment was, in plain words. The common methods get one name
 * each however they were typed ("Bank Transfer", "wire" → "Bank transfer";
 * "Personal check" → "Cheque"); a payment app keeps its own name ("Zelle",
 * "Other: Cashapp" → "Cashapp"). Null when nothing useful was typed.
 */
export function manualMethod(p: FinancePayment): string | null {
  const raw = (p.method ?? "").replace(/^other:\s*/i, "").trim();
  const m = raw.toLowerCase();
  if (!raw || m === "other") return null;
  if (/cash(?!\s*app)/.test(m) && !/cashapp/.test(m)) return "Cash";
  if (/bank|transfer|wire|\bach\b/.test(m)) return "Bank transfer";
  if (/che(que|ck)/.test(m)) return "Cheque";
  if (/card|debit|credit/.test(m)) return "Card";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** The label a payment row shows beside its icon. */
export function paymentLabel(p: FinancePayment): string {
  const channel = paymentChannel(p);
  if (channel !== "Manual") return channel;
  // "Manual" first, like "Stripe" is declared by its logo: then what it was.
  const method = manualMethod(p);
  return method ? `Manual · ${method}` : "Manual";
}

/* ─── Refunds ─────────────────────────────────────────────────────────────
 *
 *  A refund is recorded ON the payment it gave back (`refund_amount`, plus a
 *  Stripe / Square refund id when it went back online). It is not tied to a
 *  charge, and it does NOT reopen one: after a refund the charge's
 *  `remaining_amount` stays where it was (refunds here are deposits handed back
 *  and cancelled rentals, not re-billing). So a refund is shown as money OUT
 *  under the payment it reversed, and never changes what a charge still owes.
 *
 *  Online vs manual, as for payments: a Stripe or Square refund id → given back
 *  to the card through that provider; neither → handed back by staff.
 */
export type Refund = {
  amount: number;
  provider: PaymentProvider;
  date: string | null;
  /** Not settled yet ("processing", "scheduled"): shown, flagged, still counted. */
  pending: boolean;
};

export function refundOf(p: FinancePayment): Refund | null {
  const raw = Number(p.refund_amount || 0);
  if (raw <= EPS) return null;
  return {
    // Never more than the payment itself: one production row records a refund
    // of twice its payment, which would read as money out of nowhere.
    amount: Math.min(raw, Number(p.amount || 0) || raw),
    provider: p.stripe_refund_id ? "stripe" : p.square_refund_id ? "square" : "manual",
    date: p.refund_processed_at ?? p.refund_scheduled_date ?? null,
    pending: ["processing", "scheduled", "pending"].includes((p.refund_status ?? "").toLowerCase()),
  };
}

/**
 * This allocation's share of its payment's refund. A payment split across
 * charges had its refund split the same way — pro rata to what it paid each —
 * because the refund itself names no charge.
 */
export function refundShare(p: FinancePayment, applied: number, chargeId?: string): number {
  if (p.refund_lines && chargeId) {
    return p.refund_lines.filter((l) => l.charge_entry_id === chargeId).reduce((s, l) => s + l.amount, 0);
  }
  const r = refundOf(p);
  const whole = Number(p.amount || 0);
  if (!r || whole <= EPS) return 0;
  return Math.round(((r.amount * applied) / whole) * 100) / 100;
}

/* ─── Entity: what an invoice is for ──────────────────────────────────────
 *
 *   Rental      a rental's bills — its first bill, and one per extension
 *               (an extension is a REASON for a rental invoice, not an entity)
 *                                                    ref: R-1041, R-1041 · Ext 2
 *   Fine        a fine passed on to the customer — a toll, parking or speeding
 *               notice from an outside authority. Its own reference, its own
 *               due date, its own lifecycle (liable? charge / pay / appeal /
 *               waive). Only invoiced when the CUSTOMER is liable; a fine the
 *               business pays itself is an expense, not an invoice.
 *                                                    ref: the citation  PCN-88213
 *   Customer    anything else billed to the customer's account on its own —
 *               damage, an adjustment                 ref: the customer  C-0042
 *
 * The entity names what the invoice is ATTACHED TO, and its ref points at that
 * thing: a rental, a fine (its notice number), or — for Customer — the account.
 *
 *   Fine and Customer invoices may carry the rental they happened during ("related
 *   rental"), for context only — never part of that rental's billing.
 *
 * Every invoice has one or more LINE ITEMS (Rental, Insurance, Tax, Fine…),
 * whatever its entity.
 */
export type Entity = "rental" | "fine" | "customer";

export const ENTITY_LABEL: Record<Entity, string> = {
  rental: "Rental",
  fine: "Fine",
  customer: "Customer",
};

/** The entity's label; an invoice from before entities existed reads by its type. */
export function entityLabel(invoice: Pick<FinanceInvoice, "entity" | "invoice_type">): string {
  if (invoice.entity) return ENTITY_LABEL[invoice.entity];
  return invoice.invoice_type === "standalone" ? "Customer" : "Rental";
}
