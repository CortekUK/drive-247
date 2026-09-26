/**
 * The shared filter bar and the four cards. Pure.
 *
 * Two layers, applied in this order:
 *
 *  1. NARROW — search, statuses, methods. Each applies only to the row kinds it
 *     means something for: a status filter narrows a kind only when it names
 *     at least one of that kind's statuses (`BILL_STATUSES`, `RECEIPT_STATUSES`,
 *     `UPCOMING_STATUSES`); `methods` narrows receipts by `payments.method`
 *     (case-insensitive) or provider, and upcoming rows by collection method.
 *     The stats are computed from narrowed rows, so the math strip always
 *     describes what the filter bar is showing.
 *
 *  2. WINDOW — each card has its own time window, and the card filter returns
 *     EXACTLY the rows its number is summed from:
 *       outstanding  bills with a non-zero `outstandingCents` (as of today — the period does not apply)
 *       overdue      bills with a non-zero `overdueCents` (as of today)
 *       collected    receipts that are collected (payment_type 'Payment', money
 *                    received) with `date` in the period
 *       upcoming     open occurrences of active plans (scheduled / due /
 *                    partially paid / failed with a retry) whose `effectiveOn`
 *                    is in the next 7 days
 *     With no card, the period narrows each list: bills by `issuedOn` and
 *     receipts by `date` (a "7 days" period looks back), upcoming rows by
 *     `effectiveOn` (a "7 days" period looks ahead).
 *
 *  Needs attention is never filtered: it is what needs the operator, whatever
 *  the filter bar is showing. (It is still narrowed by the hook's scope.)
 */

import { computeStats } from "./stats";
import { collectedSeries, outstandingAgeing, upcomingSeries } from "./series";
import { inRange, periodRange, upcomingWindow } from "./period";
import { isUpcomingCardCandidate, OPEN_OCCURRENCE_STATUSES } from "./upcoming";
import type {
  BillRow,
  BillStatus,
  FinanceCard,
  FinanceFilters,
  FinanceModel,
  FinanceSeries,
  FinanceStats,
  FinanceView,
  ReceiptRow,
  ReceiptStatus,
  UpcomingMethod,
  UpcomingRow,
} from "./types";

export const BILL_STATUSES: readonly BillStatus[] = ["paid", "open", "overdue", "credit"];
export const RECEIPT_STATUSES: readonly ReceiptStatus[] = [
  "approved",
  "pending_review",
  "rejected",
  "refunded",
  "partially_refunded",
  "pending",
];
export const UPCOMING_STATUSES: readonly string[] = OPEN_OCCURRENCE_STATUSES;

/**
 * Not a receipt status: a KIND of receipt. As a status filter it keeps exactly
 * the payment links and charges the operator sent (`ReceiptRow.isPaymentRequest`)
 * — the rows the old Invoices tab's "Payment Requests" list showed — in any
 * status. It narrows receipts only; bills and upcoming rows ignore it.
 */
export const PAYMENT_REQUEST_STATUS = "payment_request";
export const UPCOMING_METHODS: readonly UpcomingMethod[] = ["auto_charge", "checkout_link", "manual"];

/** The view a card's rows live in. */
export const CARD_VIEW: Record<FinanceCard, FinanceView> = {
  outstanding: "billed",
  overdue: "billed",
  collected: "received",
  upcoming: "upcoming",
};

const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim().toLowerCase();

const hit = (q: string, ...fields: unknown[]) => fields.some((f) => norm(f).includes(q));

export function searchTerm(filters: Pick<FinanceFilters, "search">): string {
  return norm(filters.search);
}

export function billMatchesSearch(b: BillRow, q: string): boolean {
  if (!q) return true;
  return hit(q, b.customerName, b.rentalRef, b.vehicleReg, b.invoiceNumber, b.label);
}

/** Customer, rental, vehicle, method, and every Stripe/Square reference on the row. */
export function receiptMatchesSearch(r: ReceiptRow, q: string): boolean {
  if (!q) return true;
  return hit(q, r.customerName, r.rentalRef, r.vehicleReg, r.method, r.providerRef, r.paymentId, ...r.references);
}

export function upcomingMatchesSearch(u: UpcomingRow, q: string): boolean {
  if (!q) return true;
  return hit(q, u.customerName, u.rentalRef, u.seqLabel);
}

/** The subset of `wanted` that belongs to `vocabulary`, or null when none does (→ no narrowing). */
function applicable(wanted: string[] | undefined, vocabulary: readonly string[]): Set<string> | null {
  if (!wanted || wanted.length === 0) return null;
  const set = new Set(wanted.filter((w) => vocabulary.includes(w)));
  return set.size > 0 ? set : null;
}

export function narrowBills(bills: BillRow[], filters: FinanceFilters): BillRow[] {
  const q = searchTerm(filters);
  const statuses = applicable(filters.statuses, BILL_STATUSES);
  return bills.filter((b) => billMatchesSearch(b, q) && (!statuses || statuses.has(b.status)));
}

export function narrowReceipts(receipts: ReceiptRow[], filters: FinanceFilters): ReceiptRow[] {
  const q = searchTerm(filters);
  const statuses = applicable(filters.statuses, RECEIPT_STATUSES);
  // Upcoming's collection methods are not payment methods; any other value is.
  const methods = (filters.methods ?? []).filter((m) => !(UPCOMING_METHODS as readonly string[]).includes(m)).map(norm);
  const requestsOnly = (filters.statuses ?? []).includes(PAYMENT_REQUEST_STATUS);
  return receipts.filter(
    (r) =>
      receiptMatchesSearch(r, q) &&
      (!statuses || statuses.has(r.status)) &&
      (!requestsOnly || r.isPaymentRequest === true) &&
      (methods.length === 0 || methods.includes(norm(r.method)) || methods.includes(r.provider)),
  );
}

export function narrowUpcoming(upcoming: UpcomingRow[], filters: FinanceFilters): UpcomingRow[] {
  const q = searchTerm(filters);
  const statuses = applicable(filters.statuses, UPCOMING_STATUSES);
  const methods = applicable(filters.methods, UPCOMING_METHODS);
  return upcoming.filter(
    (u) => upcomingMatchesSearch(u, q) && (!statuses || statuses.has(u.status)) && (!methods || methods.has(u.method)),
  );
}

/* ── the cards ───────────────────────────────────────────────────────────── */

export const isOutstandingRow = (b: Pick<BillRow, "outstandingCents">) => b.outstandingCents !== 0;
export const isOverdueRow = (b: Pick<BillRow, "overdueCents">) => b.overdueCents !== 0;
/** Design §3 Collected: payment_type 'Payment', a received status, not requires_capture. */
export const isCollectedRow = (r: Pick<ReceiptRow, "paymentType" | "countsAsReceived">) =>
  r.paymentType === "Payment" && r.countsAsReceived;

export interface CardRows {
  outstanding: BillRow[];
  overdue: BillRow[];
  collected: ReceiptRow[];
  upcoming: UpcomingRow[];
}

/** Exactly the rows behind each card's number, after the filter bar's narrowing. */
export function cardRows(model: Pick<FinanceModel, "bills" | "receipts" | "upcoming">, filters: FinanceFilters, today: string): CardRows {
  const bills = narrowBills(model.bills, filters);
  const receipts = narrowReceipts(model.receipts, filters);
  const upcoming = narrowUpcoming(model.upcoming, filters);
  const period = periodRange(filters.period, today, "past");
  const window = upcomingWindow(today);
  return {
    outstanding: bills.filter(isOutstandingRow),
    overdue: bills.filter(isOverdueRow),
    collected: receipts.filter((r) => isCollectedRow(r) && inRange(r.date, period)),
    upcoming: upcoming.filter((u) => isUpcomingCardCandidate(u) && inRange(u.effectiveOn, window)),
  };
}

export interface FinanceSelection {
  stats: FinanceStats;
  /** The charts, each from the same rows as its number (./series). */
  series: FinanceSeries;
  bills: BillRow[];
  receipts: ReceiptRow[];
  upcoming: UpcomingRow[];
}

/**
 * The lists and the stats for one filter state. With a card set, that card's
 * view holds exactly the card's rows; the other views keep their normal filter.
 */
export function selectFinances(model: Pick<FinanceModel, "bills" | "receipts" | "upcoming">, filters: FinanceFilters, today: string): FinanceSelection {
  const cards = cardRows(model, filters, today);
  const stats = computeStats(cards);
  const series: FinanceSeries = {
    collected: collectedSeries(cards.collected, filters.period, today),
    ageing: outstandingAgeing([...cards.outstanding, ...cards.overdue], today),
    upcoming: upcomingSeries(cards.upcoming, today),
  };

  const past = periodRange(filters.period, today, "past");
  const future = periodRange(filters.period, today, "future");
  let bills = narrowBills(model.bills, filters).filter((b) => inRange(b.issuedOn, past));
  let receipts = narrowReceipts(model.receipts, filters).filter((r) => inRange(r.date, past));
  let upcoming = narrowUpcoming(model.upcoming, filters).filter((u) => inRange(u.effectiveOn, future));

  switch (filters.card ?? null) {
    case "outstanding":
      bills = cards.outstanding;
      break;
    case "overdue":
      bills = cards.overdue;
      break;
    case "collected":
      receipts = cards.collected;
      break;
    case "upcoming":
      upcoming = cards.upcoming;
      break;
  }
  return { stats, series, bills, receipts, upcoming };
}

/** The distinct payment methods on the receipts, as typed, for the method dropdown. */
export function receiptMethodOptions(receipts: ReceiptRow[]): string[] {
  const seen = new Map<string, string>();
  for (const r of receipts) {
    const m = (r.method ?? "").trim();
    if (m && !seen.has(m.toLowerCase())) seen.set(m.toLowerCase(), m);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
