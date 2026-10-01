/**
 * Finances — PREVIEW DATA for the ideal model. Not read from the database.
 *
 * ── THE MENTAL MODEL ──────────────────────────────────────────────────────
 *
 *   Every customer has an ACCOUNT with you.
 *   Every time something billable happens, you send them an INVOICE:
 *     booking a car, extending it, a fine, damage.   (one invoice per event)
 *   An invoice is a list of CHARGES: Rental, Insurance, Tax, Delivery…
 *   Money comes in as PAYMENTS, and each is put against specific charges.
 *   If you let them off something, that's a CREDIT NOTE ("you owe less").
 *   If you hand money back, that's a REFUND (tied to the payment it returns).
 *   Behind all of it, one LEDGER per customer records every line in order;
 *   the invoices are how you read it.
 *
 *   The operator only ever asks three things, and the screen answers them:
 *     Who owes me?      → the invoice list, with what's left and what's late
 *     For what?         → open an invoice: its charges
 *     Where did the money go?  → open a charge: its payments, refunds, credits
 *
 * ENTITY says what an invoice is for, ENTITY REF says which one:
 *   Rental       R-1041            a rental's first bill
 *                R-1041 · Ext 2    …and each extension: its own invoice, on the
 *                                  same rental (an extension is a reason, not
 *                                  an entity)
 *   Fine         PCN-88213         a fine passed on to the customer, referenced
 *                                  by the authority's notice number, with the
 *                                  rental it happened during noted for context
 *                                  ("Fined Nina $55 for a toll violation during
 *                                  R-1041")
 *   Customer     C-0042            anything else billed to the customer's
 *                                  account on its own — damage, an adjustment
 * Every invoice has one or more LINE ITEMS, whatever its entity.
 * Numbering follows it: a rental's invoices share its number (INV-1041-01
 * first bill, -02 Extension 1, -03 Extension 2); Fines are INV-F-…, and Customer
 * invoices INV-C-….
 *
 * "Today" for these stories is Sep 28, 2026.
 */

import { useSyncExternalStore } from "react";
import {
  buildIndex,
  type Allocation,
  type Charge,
  type CreditNote,
  type DebitNote,
  type Entity,
  type FinanceIndex,
  type FinanceInvoice,
  type FinancePayment,
} from "./finance-data";

/** Show this preview instead of the database. One switch; flip to false to go back. */
export const FINANCES_PREVIEW = true;

type Provider = "stripe" | "square" | "manual";
type Channel = "link" | "booking" | "auto" | "manual";

type LineSpec = { type: string; amount: number };
type PaySpec = {
  date: string;
  amount: number;
  provider: Provider;
  channel: Channel;
  method: string;
  /** Which lines it paid, by position on the invoice, and how much. */
  to: [line: number, amount: number][];
  refund?: { date: string; provider: Provider; to: [line: number, amount: number][] };
};
type InvoiceSpec = {
  number: string;
  entity: Entity;
  /** Extension number, for its ref ("R-1041 · Ext 2"). */
  ext?: number;
  /** What happened, in words, for a Fine or Customer invoice ("Toll violation"). */
  event?: string;
  /** Fine: the authority's citation number — its Entity ref. */
  citation?: string;
  /** Fine / Customer: the rental it happened during, if any. */
  related?: string;
  rental?: string;
  customer: Customer;
  vehicle?: [reg: string, make: string, model: string];
  issued: string;
  due: string | null;
  cancelled?: boolean;
  notes?: string;
  lines: LineSpec[];
  payments?: PaySpec[];
  credits?: { line: number; amount: number; reason: string; date: string }[];
};

// ── The stories ────────────────────────────────────────────────────────────

/** A customer, with the account number a Customer invoice is referenced by. */
export type Customer = { id: string; account: string; name: string };
const NINA: Customer = { id: "c-nina", account: "C-0041", name: "Nina Kowalski" };
const MARCUS: Customer = { id: "c-marcus", account: "C-0042", name: "Marcus Bellweather" };
const PRIYA: Customer = { id: "c-priya", account: "C-0043", name: "Priya Raman" };
const DIEGO: Customer = { id: "c-diego", account: "C-0044", name: "Diego Santoro" };
const THEO: Customer = { id: "c-theo", account: "C-0045", name: "Theo Okafor" };
const CAMILLE: Customer = { id: "c-camille", account: "C-0046", name: "Camille Duval" };

const EXPLORER: [string, string, string] = ["NWD-4526", "Ford", "Explorer"];
const CIVIC: [string, string, string] = ["NWD-2087", "Honda", "Civic"];
const MODEL3: [string, string, string] = ["NWD-3311", "Tesla", "Model 3"];
const TELLURIDE: [string, string, string] = ["NWD-7408", "Kia", "Telluride"];
const VERSA: [string, string, string] = ["NWD-5190", "Nissan", "Versa"];

const SPECS: InvoiceSpec[] = [
  // Nina — one rental, four invoices: booked, extended twice, then a toll fine.
  {
    number: "INV-1041-01", entity: "rental", rental: "R-1041", customer: NINA, vehicle: EXPLORER,
    issued: "2026-09-01", due: "2026-09-01",
    lines: [
      { type: "Rental", amount: 420 }, { type: "Insurance", amount: 70 }, { type: "Delivery Fee", amount: 35 },
      { type: "Service Fee", amount: 21 }, { type: "Tax", amount: 38.08 },
    ],
    payments: [
      { date: "2026-09-01", amount: 584.08, provider: "stripe", channel: "booking", method: "Card",
        to: [[0, 420], [1, 70], [2, 35], [3, 21], [4, 38.08]] },
    ],
  },
  {
    number: "INV-1041-02", entity: "rental", ext: 1, rental: "R-1041", customer: NINA, vehicle: EXPLORER,
    issued: "2026-09-08", due: "2026-09-08",
    lines: [{ type: "Rental", amount: 180 }, { type: "Insurance", amount: 30 }, { type: "Tax", amount: 16.8 }],
    payments: [
      { date: "2026-09-08", amount: 100, provider: "manual", channel: "manual", method: "Cash", to: [[0, 100]] },
      { date: "2026-09-10", amount: 126.8, provider: "stripe", channel: "link", method: "Card",
        to: [[0, 80], [1, 30], [2, 16.8]] },
    ],
  },
  {
    number: "INV-1041-03", entity: "rental", ext: 2, rental: "R-1041", customer: NINA, vehicle: EXPLORER,
    issued: "2026-09-11", due: "2026-09-11",
    lines: [{ type: "Rental", amount: 300 }, { type: "Insurance", amount: 50 }, { type: "Tax", amount: 28 }],
    payments: [
      // The $20 paid for Extension 2's insurance, and nothing else.
      { date: "2026-09-12", amount: 20, provider: "manual", channel: "manual", method: "Cash", to: [[1, 20]] },
      { date: "2026-09-15", amount: 150, provider: "stripe", channel: "auto", method: "Card", to: [[0, 150]] },
    ],
  },
  {
    // A fine that happened DURING the rental: a Fine, referenced by the
    // authority's notice number, with the rental it happened during for context.
    number: "INV-F-0012", entity: "fine", citation: "TOLL-55190", event: "Toll violation", related: "R-1041", customer: NINA, vehicle: EXPLORER,
    issued: "2026-09-20", due: "2026-10-04",
    notes: "Toll violation, I-25 northbound, Sep 9",
    lines: [{ type: "Fine", amount: 45 }, { type: "Admin Fee", amount: 10 }],
  },

  // Marcus — returned a day early: that day and the deposit were credited, then refunded.
  {
    number: "INV-1042-01", entity: "rental", rental: "R-1042", customer: MARCUS, vehicle: CIVIC,
    issued: "2026-08-20", due: "2026-08-20",
    lines: [
      { type: "Rental", amount: 250 }, { type: "Security Deposit", amount: 300 },
      { type: "Service Fee", amount: 12.5 }, { type: "Tax", amount: 21 },
    ],
    payments: [
      { date: "2026-08-19", amount: 583.5, provider: "stripe", channel: "link", method: "Card",
        to: [[0, 250], [1, 300], [2, 12.5], [3, 21]],
        refund: { date: "2026-08-27", provider: "stripe", to: [[0, 50], [1, 300]] } },
    ],
    credits: [
      { line: 0, amount: 50, reason: "1 day not used", date: "2026-08-26" },
      { line: 1, amount: 300, reason: "Deposit returned", date: "2026-08-26" },
    ],
  },
  // …and a parking fine that arrived after the rental closed: a Fine, overdue.
  {
    // A parking fine that arrived after Marcus's rental had closed.
    number: "INV-F-0011", entity: "fine", citation: "PCN-88213", event: "Parking violation", related: "R-1042", customer: MARCUS,
    issued: "2026-08-02", due: "2026-08-16", notes: "Parking citation #88213, Denver",
    lines: [{ type: "Fine", amount: 65 }, { type: "Admin Fee", amount: 15 }],
  },

  // Priya — booked for next week, nothing paid yet, not due yet.
  {
    number: "INV-1043-01", entity: "rental", rental: "R-1043", customer: PRIYA, vehicle: MODEL3,
    issued: "2026-09-26", due: "2026-10-03",
    lines: [
      { type: "Rental", amount: 600 }, { type: "Insurance", amount: 90 }, { type: "Extras", amount: 25 },
      { type: "Service Fee", amount: 30 }, { type: "Tax", amount: 55.6 },
    ],
  },

  // Diego — paid part at booking through Square, the rest is two weeks late.
  {
    number: "INV-1044-01", entity: "rental", rental: "R-1044", customer: DIEGO, vehicle: TELLURIDE,
    issued: "2026-09-14", due: "2026-09-14",
    lines: [
      { type: "Rental", amount: 490 }, { type: "Delivery Fee", amount: 35 },
      { type: "Service Fee", amount: 24.5 }, { type: "Tax", amount: 43.12 },
    ],
    payments: [
      { date: "2026-09-14", amount: 300, provider: "square", channel: "booking", method: "Card", to: [[0, 300]] },
    ],
  },

  // Theo — cancelled before pickup: the invoice stays on record, nothing collected.
  {
    number: "INV-1045-01", entity: "rental", rental: "R-1045", customer: THEO, vehicle: VERSA,
    issued: "2026-09-03", due: "2026-09-03", cancelled: true,
    lines: [{ type: "Rental", amount: 350 }, { type: "Service Fee", amount: 17.5 }, { type: "Tax", amount: 29.4 }],
  },

  // Camille — a clean, fully paid booking by Zelle…
  {
    number: "INV-1046-01", entity: "rental", rental: "R-1046", customer: CAMILLE, vehicle: VERSA,
    issued: "2026-09-05", due: "2026-09-05",
    lines: [{ type: "Rental", amount: 280 }, { type: "Service Fee", amount: 14 }, { type: "Tax", amount: 23.52 }],
    payments: [
      { date: "2026-09-05", amount: 317.52, provider: "manual", channel: "manual", method: "Zelle",
        to: [[0, 280], [1, 14], [2, 23.52]] },
    ],
  },
  // …and damage found after return, billed on its own and half paid by bank transfer.
  {
    number: "INV-C-0007", entity: "customer", event: "Damage", customer: CAMILLE, vehicle: VERSA,
    issued: "2026-09-18", due: "2026-10-18", notes: "Rear bumper scuff, found at return inspection",
    lines: [{ type: "Damage", amount: 420 }],
    payments: [
      { date: "2026-09-22", amount: 200, provider: "manual", channel: "manual", method: "Bank Transfer", to: [[0, 200]] },
    ],
  },
];

// ── The builder: turns each story into the model's rows ───────────────────

const TODAY_ISO = "2026-09-28T09:00:00.000Z";

function buildPreview() {
  const invoices: FinanceInvoice[] = [];
  const charges: Charge[] = [];
  const allocations: Allocation[] = [];
  const payments: FinancePayment[] = [];
  const credits: CreditNote[] = [];

  SPECS.forEach((spec) => {
    const invoiceId = `mock-${spec.number}`;
    const lineIds = spec.lines.map((_, i) => `${invoiceId}-L${i + 1}`);
    const paidOn = new Map<string, number>();
    const creditedOn = new Map<string, number>();
    const refundedOn = new Map<string, number>();

    (spec.payments ?? []).forEach((pay, pi) => {
      const paymentId = `${invoiceId}-P${pi + 1}`;
      pay.to.forEach(([line, amount], ai) => {
        allocations.push({ id: `${paymentId}-A${ai + 1}`, payment_id: paymentId, charge_entry_id: lineIds[line], amount_applied: amount });
        paidOn.set(lineIds[line], (paidOn.get(lineIds[line]) ?? 0) + amount);
      });
      const refundLines = pay.refund?.to.map(([line, amount]) => ({ charge_entry_id: lineIds[line], amount })) ?? [];
      refundLines.forEach((l) => refundedOn.set(l.charge_entry_id, (refundedOn.get(l.charge_entry_id) ?? 0) + l.amount));
      const refunded = refundLines.reduce((s, l) => s + l.amount, 0);
      const online = pay.provider !== "manual";
      payments.push({
        id: paymentId,
        amount: pay.amount,
        payment_date: pay.date,
        paid_at: `${pay.date}T15:00:00.000Z`,
        method: pay.method,
        status: refunded > 0 ? (refunded >= pay.amount ? "Refunded" : "Partial Refund") : "Applied",
        refund_amount: refunded || null,
        stripe_checkout_session_id: pay.provider === "stripe" && pay.channel !== "auto" ? `cs_mock_${paymentId}` : null,
        stripe_payment_intent_id: pay.provider === "stripe" ? `pi_mock_${paymentId}` : null,
        square_payment_id: pay.provider === "square" ? `sq_mock_${paymentId}` : null,
        square_payment_link_id: pay.provider === "square" && pay.channel === "link" ? `sql_mock_${paymentId}` : null,
        booking_source: online ? (pay.channel === "booking" ? "website" : "admin") : "admin",
        payment_provider: pay.provider === "square" ? "square" : "stripe",
        refund_status: refunded > 0 ? "completed" : null,
        refund_processed_at: pay.refund ? `${pay.refund.date}T12:00:00.000Z` : null,
        refund_scheduled_date: null,
        stripe_refund_id: pay.refund?.provider === "stripe" ? `re_mock_${paymentId}` : null,
        square_refund_id: pay.refund?.provider === "square" ? `sqr_mock_${paymentId}` : null,
        refund_lines: refundLines.length ? refundLines : undefined,
      });
    });

    (spec.credits ?? []).forEach((cn, ci) => {
      credits.push({
        id: `${invoiceId}-CN${ci + 1}`,
        number: `CN-${noteBase(spec.number)}-${String(ci + 1).padStart(3, "0")}`,
        charge_id: lineIds[cn.line],
        amount: cn.amount,
        reason: cn.reason,
        date: cn.date,
      });
      creditedOn.set(lineIds[cn.line], (creditedOn.get(lineIds[cn.line]) ?? 0) + cn.amount);
    });

    spec.lines.forEach((line, i) => {
      const id = lineIds[i];
      // What is still owed: the charge, less what was paid and kept, less what was forgiven.
      const remaining =
        line.amount - (paidOn.get(id) ?? 0) + (refundedOn.get(id) ?? 0) - (creditedOn.get(id) ?? 0);
      charges.push({
        id,
        invoice_id: invoiceId,
        rental_id: spec.rental ?? "",
        category: line.type,
        amount: line.amount,
        remaining_amount: spec.cancelled ? 0 : Math.max(0, Math.round(remaining * 100) / 100),
        entry_date: spec.issued,
        due_date: spec.due,
      });
    });

    const total = spec.lines.reduce((s, l) => s + l.amount, 0);
    invoices.push({
      id: invoiceId,
      rental_id: spec.rental ?? null,
      customer_id: spec.customer.id,
      vehicle_id: spec.vehicle ? `v-${spec.vehicle[0]}` : null,
      invoice_number: spec.number,
      invoice_type: spec.entity === "fine" || spec.entity === "customer" ? "standalone" : "rental",
      entity: spec.entity,
      entity_ref:
        spec.entity === "fine"
          ? spec.citation ?? null
          : spec.entity === "customer"
          ? spec.customer.account
          : spec.ext
            ? `${spec.rental} · Ext ${spec.ext}`
            : spec.rental ?? null,
      event: spec.event ?? (spec.ext ? `Extension ${spec.ext}` : null),
      related_rental: spec.related ?? null,
      invoice_date: spec.issued,
      due_date: spec.due as string,
      status: spec.cancelled ? "cancelled" : "pending",
      notes: spec.notes ?? null,
      created_at: `${spec.issued}T10:00:00.000Z`,
      total_amount: Math.round(total * 100) / 100,
      customers: { name: spec.customer.name },
      vehicles: spec.vehicle ? { reg: spec.vehicle[0], make: spec.vehicle[1], model: spec.vehicle[2] } : null,
    });
  });

  // Newest first, as the list shows them.
  invoices.sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || b.invoice_number.localeCompare(a.invoice_number));
  return { invoices, charges, allocations, payments, credits };
}

/** "INV-1041-02" → "1041", "INV-F-0012" → "F-0012": what a note's number is built on. */
function noteBase(invoiceNumber: string) {
  return invoiceNumber.replace(/^INV-/, "").replace(/-\d{2}$/, "");
}

// ── The live store ─────────────────────────────────────────────────────────
//
// The preview is a small in-memory store so that what the operator does on it
// — change a line's amount, create an invoice, issue a draft — shows up in the
// list and the sheet straight away. It lives in the browser tab only: a reload
// starts again from the stories above, and nothing ever reaches the database.

const seed = buildPreview();
const state = {
  invoices: seed.invoices,
  charges: seed.charges,
  allocations: seed.allocations,
  payments: seed.payments,
  credits: seed.credits,
  debits: [] as DebitNote[],
};

type Snapshot = { invoices: FinanceInvoice[]; index: FinanceIndex };
let snapshot: Snapshot = makeSnapshot();
const listeners = new Set<() => void>();

function makeSnapshot(): Snapshot {
  return {
    invoices: [...state.invoices],
    index: buildIndex(state.charges, state.allocations, state.payments, state.credits, state.debits),
  };
}
function commit() {
  snapshot = makeSnapshot();
  listeners.forEach((l) => l());
}

/** The preview's invoices and index, re-rendering whenever an action changes them. */
export function usePreviewFinance(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

const TODAY = TODAY_ISO.slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;

function invoiceOfCharge(chargeId: string) {
  const charge = state.charges.find((c) => c.id === chargeId);
  const invoice = charge && state.invoices.find((i) => i.id === charge.invoice_id);
  return { charge, invoice };
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Change a line's amount.
 *  - DRAFT invoice: the line is simply edited.
 *  - ISSUED invoice: the line is never touched; a DEBIT NOTE (up) or CREDIT
 *    NOTE (down) is added for the difference, with its reason. A credit note
 *    on a line that was already paid frees money: it is kept ON ACCOUNT or
 *    REFUNDED to the payment it came from.
 */
export function changeLineAmount(
  chargeId: string,
  newAmount: number,
  reason: string,
  settle: "account" | "refund" = "account",
) {
  const { charge, invoice } = invoiceOfCharge(chargeId);
  if (!charge || !invoice) return;
  const billed = charge.amount + state.debits.filter((d) => d.charge_id === chargeId).reduce((s, d) => s + d.amount, 0)
    - state.credits.filter((c) => c.charge_id === chargeId).reduce((s, c) => s + c.amount, 0);
  const delta = round(newAmount - billed);
  if (Math.abs(delta) < 0.005) return;

  if (invoice.status === "draft") {
    charge.amount = round(charge.amount + delta);
    charge.remaining_amount = round(Number(charge.remaining_amount ?? 0) + delta);
    invoice.total_amount = round(Number(invoice.total_amount) + delta);
    return commit();
  }

  const base = noteBase(invoice.invoice_number);
  if (delta > 0) {
    const n = state.debits.filter((d) => d.number.startsWith(`DN-${base}-`)).length + 1;
    state.debits.push({
      id: `dn-${Date.now()}`,
      number: `DN-${base}-${String(n).padStart(3, "0")}`,
      charge_id: chargeId,
      amount: delta,
      reason,
      date: TODAY,
    });
    charge.remaining_amount = round(Number(charge.remaining_amount ?? 0) + delta);
    return commit();
  }

  const credit = -delta;
  const owed = Number(charge.remaining_amount ?? 0);
  const overpaid = round(Math.max(0, credit - owed));
  const n = state.credits.filter((c) => (c.number ?? "").startsWith(`CN-${base}-`)).length + 1;
  state.credits.push({
    id: `cn-${Date.now()}`,
    number: `CN-${base}-${String(n).padStart(3, "0")}`,
    charge_id: chargeId,
    amount: credit,
    reason,
    date: TODAY,
    overpaid: overpaid || undefined,
    settled: overpaid ? settle : undefined,
  });
  charge.remaining_amount = round(Math.max(0, owed - credit));

  if (overpaid && settle === "refund") {
    // Refund the freed money to the latest payment that paid this line.
    const alloc = [...state.allocations].reverse().find((a) => a.charge_entry_id === chargeId);
    const payment = alloc && state.payments.find((p) => p.id === alloc.payment_id);
    if (payment) {
      payment.refund_lines = [...(payment.refund_lines ?? []), { charge_entry_id: chargeId, amount: overpaid }];
      const refunded = payment.refund_lines.reduce((s, l) => s + l.amount, 0);
      payment.refund_amount = round(refunded);
      payment.status = refunded >= payment.amount - 0.005 ? "Refunded" : "Partial Refund";
      payment.refund_status = "completed";
      payment.refund_processed_at = `${TODAY}T12:00:00.000Z`;
      if (payment.stripe_payment_intent_id) payment.stripe_refund_id = `re_mock_${payment.id}`;
      else if (payment.square_payment_id) payment.square_refund_id = `sqr_mock_${payment.id}`;
    }
  }
  commit();
}

/** Issue a draft: it gets its due status and can be paid; its lines lock. */
export function issueInvoice(invoiceId: string) {
  const invoice = state.invoices.find((i) => i.id === invoiceId);
  if (!invoice || invoice.status !== "draft") return;
  invoice.status = "pending";
  commit();
}

// ── What "New invoice" searches ────────────────────────────────────────────

export type PreviewRental = {
  ref: string;
  customer: Customer;
  vehicle: string;
  period: string;
  /** How many extensions it has had — each can be billed against. */
  extensions: number;
};
export const PREVIEW_RENTALS: PreviewRental[] = [
  { ref: "R-1041", customer: NINA, vehicle: "NWD-4526 · Ford Explorer", period: "Sep 1 – Sep 20", extensions: 2 },
  { ref: "R-1042", customer: MARCUS, vehicle: "NWD-2087 · Honda Civic", period: "Aug 20 – Aug 25", extensions: 0 },
  { ref: "R-1043", customer: PRIYA, vehicle: "NWD-3311 · Tesla Model 3", period: "Oct 3 – Oct 13", extensions: 0 },
  { ref: "R-1044", customer: DIEGO, vehicle: "NWD-7408 · Kia Telluride", period: "Sep 14 – Sep 21", extensions: 0 },
  { ref: "R-1045", customer: THEO, vehicle: "NWD-5190 · Nissan Versa", period: "Cancelled", extensions: 0 },
  { ref: "R-1046", customer: CAMILLE, vehicle: "NWD-5190 · Nissan Versa", period: "Sep 5 – Sep 9", extensions: 0 },
];

export type PreviewFine = {
  ref: string;
  kind: string;
  amount: number;
  customer: Customer;
  rental: string | null;
  date: string;
};
/** Fines received and not yet invoiced — the only ones New invoice offers. */
export const PREVIEW_FINES: PreviewFine[] = [
  { ref: "SPD-20931", kind: "Speeding", amount: 120, customer: DIEGO, rental: "R-1044", date: "2026-09-17" },
  { ref: "PCN-77120", kind: "Parking violation", amount: 60, customer: CAMILLE, rental: "R-1046", date: "2026-09-07" },
  { ref: "TOLL-60214", kind: "Toll violation", amount: 18.5, customer: PRIYA, rental: null, date: "2026-09-24" },
];

export const PREVIEW_CUSTOMERS: Customer[] = [NINA, MARCUS, PRIYA, DIEGO, THEO, CAMILLE];

/** The line types an invoice line can be. */
export const LINE_TYPES = [
  "Rental", "Insurance", "Extras", "Delivery Fee", "Collection Fee", "Cleaning", "Late Return", "Excess Mileage",
  "Fuel", "Fine", "Admin Fee", "Damage", "Service Fee", "Tax", "Adjustment",
];

export type NewInvoiceDraft = {
  entity: Entity;
  rental?: PreviewRental;
  /** Which extension of the rental it belongs to, if any. */
  ext?: number;
  fine?: PreviewFine;
  customer: Customer;
  lines: { type: string; description?: string; amount: number }[];
  issued: string;
  due: string | null;
  notes?: string;
  issue: boolean;
};

/**
 * The number and ref an invoice WOULD get — used by createInvoice, and by the
 * New invoice preview so the operator sees the real number before issuing.
 */
export function nextInvoiceIdentity(draft: {
  entity: Entity;
  rental?: PreviewRental | null;
  ext?: number;
  fine?: PreviewFine | null;
  customer?: Customer | null;
}): { number: string; ref: string | null } {
  const next = (prefix: string) => state.invoices.filter((i) => i.invoice_number.startsWith(prefix)).length + 1;
  if (draft.entity === "rental") {
    if (!draft.rental) return { number: "INV-····-··", ref: null };
    const num = draft.rental.ref.replace("R-", "");
    return {
      number: `INV-${num}-${String(next(`INV-${num}-`)).padStart(2, "0")}`,
      ref: draft.ext ? `${draft.rental.ref} · Ext ${draft.ext}` : draft.rental.ref,
    };
  }
  if (draft.entity === "fine") {
    return {
      number: `INV-F-${String(12 + next("INV-F-")).padStart(4, "0")}`,
      ref: draft.fine?.ref ?? null,
    };
  }
  return {
    number: `INV-C-${String(7 + next("INV-C-")).padStart(4, "0")}`,
    ref: draft.customer?.account ?? null,
  };
}

/** Create an invoice from the New invoice flow. Returns its id. */
export function createInvoice(draft: NewInvoiceDraft): string {
  const identity = nextInvoiceIdentity(draft);
  const number = identity.number;
  const ref = identity.ref ?? draft.customer.account;
  const id = `mock-${number}`;
  draft.lines.forEach((line, i) => {
    state.charges.push({
      id: `${id}-L${i + 1}`,
      invoice_id: id,
      rental_id: draft.rental?.ref ?? "",
      category: line.description ? `${line.type} · ${line.description}` : line.type,
      amount: round(line.amount),
      remaining_amount: round(line.amount),
      entry_date: draft.issued,
      due_date: draft.due,
    });
  });
  const total = round(draft.lines.reduce((s, l) => s + l.amount, 0));
  state.invoices.unshift({
    id,
    rental_id: draft.entity === "rental" ? draft.rental?.ref ?? null : null,
    customer_id: draft.customer.id,
    vehicle_id: null,
    invoice_number: number,
    invoice_type: draft.entity === "rental" ? "rental" : "standalone",
    entity: draft.entity,
    entity_ref: ref,
    event: draft.entity === "fine" ? draft.fine?.kind ?? null : draft.ext ? `Extension ${draft.ext}` : null,
    related_rental: draft.entity === "fine" ? draft.fine?.rental ?? null : null,
    invoice_date: draft.issued,
    due_date: draft.due as string,
    status: draft.issue ? "pending" : "draft",
    notes: draft.notes || null,
    created_at: new Date().toISOString(),
    total_amount: total,
    customers: { name: draft.customer.name },
    vehicles: null,
  });
  if (draft.fine) {
    const i = PREVIEW_FINES.indexOf(draft.fine);
    if (i >= 0) PREVIEW_FINES.splice(i, 1); // invoiced: no longer offered
  }
  commit();
  return id;
}


// ── Paying ─────────────────────────────────────────────────────────────────

/** Cards customers have saved (for "Charge card on file"). No card → that option is off. */
export const SAVED_CARDS: Record<string, { brand: string; last4: string; provider: "stripe" | "square" } | undefined> = {
  "c-nina": { brand: "Visa", last4: "4242", provider: "stripe" },
  "c-marcus": { brand: "Mastercard", last4: "5555", provider: "stripe" },
  "c-priya": { brand: "Visa", last4: "1881", provider: "stripe" },
  "c-diego": { brand: "Visa", last4: "0077", provider: "square" },
};

/** Where a payment link is sent. */
export const CUSTOMER_CONTACT: Record<string, { email: string; phone: string }> = {
  "c-nina": { email: "nina.kowalski@example.com", phone: "+1 (720) 555-0141" },
  "c-marcus": { email: "marcus.b@example.com", phone: "+1 (303) 555-0142" },
  "c-priya": { email: "priya.raman@example.com", phone: "+1 (720) 555-0143" },
  "c-diego": { email: "diego.santoro@example.com", phone: "+1 (303) 555-0144" },
  "c-theo": { email: "theo.okafor@example.com", phone: "+1 (720) 555-0145" },
  "c-camille": { email: "camille.duval@example.com", phone: "+1 (303) 555-0146" },
};

export type PayMethod =
  | { kind: "card" }
  | { kind: "link"; via: ("email" | "sms")[] }
  | { kind: "manual"; method: string; date: string; reference?: string };

/**
 * Pay the chosen lines of an invoice, each for the amount given.
 *
 *   card    charged now to the saved card — an auto-charge. Lands at once.
 *   manual  money staff took by hand (cash, transfer…). Lands at once.
 *   link    a payment link for exactly these lines. The payment is PENDING —
 *           its allocations are held against the lines but nothing is paid
 *           until the customer pays the link (see markLinkPaid).
 *
 * Every line becomes an allocation to that exact line, never more than it has
 * remaining.
 */
export function payLines(invoiceId: string, lines: { chargeId: string; amount: number }[], how: PayMethod) {
  const invoice = state.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return;
  const valid = lines
    .map((l) => {
      const c = state.charges.find((ch) => ch.id === l.chargeId);
      return c ? { charge: c, amount: round(Math.min(l.amount, Number(c.remaining_amount ?? 0))) } : null;
    })
    .filter((l): l is { charge: Charge; amount: number } => !!l && l.amount > 0);
  if (!valid.length) return;

  const total = round(valid.reduce((s, l) => s + l.amount, 0));
  const id = `pay-${Date.now()}`;
  const card = SAVED_CARDS[invoice.customer_id ?? ""];
  const now = new Date().toISOString();
  const landed = how.kind !== "link";

  state.payments.push({
    id,
    amount: total,
    payment_date: how.kind === "manual" ? how.date : TODAY,
    paid_at: landed ? (how.kind === "manual" ? `${how.date}T12:00:00.000Z` : now) : null,
    method: how.kind === "manual" ? how.method : "Card",
    status: landed ? "Applied" : "Pending",
    refund_amount: null,
    stripe_checkout_session_id: how.kind === "link" ? `cs_mock_${id}` : null,
    stripe_payment_intent_id: how.kind === "card" && card?.provider !== "square" ? `pi_mock_${id}` : null,
    square_payment_id: how.kind === "card" && card?.provider === "square" ? `sq_mock_${id}` : null,
    square_payment_link_id: null,
    booking_source: "admin",
    payment_provider: how.kind === "card" && card?.provider === "square" ? "square" : "stripe",
    refund_status: null,
    refund_processed_at: null,
    refund_scheduled_date: null,
    stripe_refund_id: null,
    square_refund_id: null,
  });
  valid.forEach((l, i) => {
    state.allocations.push({ id: `${id}-A${i + 1}`, payment_id: id, charge_entry_id: l.charge.id, amount_applied: l.amount });
    if (landed) l.charge.remaining_amount = round(Number(l.charge.remaining_amount ?? 0) - l.amount);
  });
  commit();
  return { id, total };
}

/** Preview only: the customer pays the link — the pending payment lands on its lines. */
export function markLinkPaid(paymentId: string) {
  const payment = state.payments.find((p) => p.id === paymentId);
  if (!payment || payment.status !== "Pending") return;
  payment.status = "Applied";
  payment.paid_at = new Date().toISOString();
  payment.stripe_payment_intent_id = `pi_mock_${payment.id}`;
  state.allocations
    .filter((a) => a.payment_id === paymentId)
    .forEach((a) => {
      const c = state.charges.find((ch) => ch.id === a.charge_entry_id);
      if (c) c.remaining_amount = round(Math.max(0, Number(c.remaining_amount ?? 0) - a.amount_applied));
    });
  commit();
}
