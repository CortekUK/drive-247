/**
 * Payment-plan occurrences → the Upcoming view, and the "Payment N of M"
 * labels receipts and attention items carry. Pure.
 *
 * Numbering follows the plan card (components/payment-plans/payment-plan-card.tsx):
 * the plan's LIVE occurrences — everything but `superseded` — in schedule order
 * (due date, then seq). `seq` itself is not the number shown: a plan change
 * supersedes rows and adds new ones with new seqs, so "seq 7" can be the 3rd
 * live payment.
 */

import { toCents } from "./balance";
import { rentalRefOf, UNKNOWN_CUSTOMER, type FinanceLookups } from "./lookups";
import { instantDay } from "./period";
import type { FinanceContext, FinanceRawData, RawOccurrence, RawPlan, UpcomingMethod, UpcomingRow } from "./types";

/** Money is still to be collected on these (lib/payment-plans-ui/plan-math.ts OPEN_STATUSES). */
export const OPEN_OCCURRENCE_STATUSES = ["scheduled", "due", "processing", "requires_action", "partially_paid", "failed"] as const;

/**
 * The Upcoming card counts these (design §3): scheduled, due, partially paid,
 * and failed-with-a-retry. `processing` is mid-charge and `requires_action`
 * waits on the customer — both are in Needs attention or in flight, not upcoming.
 */
export const UPCOMING_CARD_STATUSES = ["scheduled", "due", "partially_paid"] as const;

const bySchedule = (a: RawOccurrence, b: RawOccurrence) =>
  a.due_date === b.due_date ? a.seq - b.seq : a.due_date < b.due_date ? -1 : 1;

/** occurrence id → "Payment 2 of 5" (live rows) or "Replaced payment #3" (superseded rows). */
export function planSeqLabels(occurrences: RawOccurrence[]): Map<string, string> {
  const byPlan = new Map<string, RawOccurrence[]>();
  for (const o of occurrences) {
    const list = byPlan.get(o.plan_id);
    if (list) list.push(o);
    else byPlan.set(o.plan_id, [o]);
  }
  const out = new Map<string, string>();
  byPlan.forEach((list) => {
    const live = list.filter((o) => o.status !== "superseded").sort(bySchedule);
    live.forEach((o, i) => out.set(o.id, `Payment ${i + 1} of ${live.length}`));
    for (const o of list) if (o.status === "superseded") out.set(o.id, `Replaced payment #${o.seq}`);
  });
  return out;
}

export function occurrenceRemainingCents(o: Pick<RawOccurrence, "amount" | "amount_paid">): number {
  return Math.max(0, toCents(o.amount) - toCents(o.amount_paid));
}

export function buildUpcoming(
  raw: FinanceRawData,
  lk: FinanceLookups,
  labels: Map<string, string>,
  ctx: FinanceContext,
): UpcomingRow[] {
  const planById = new Map<string, RawPlan>(raw.plans.map((p) => [p.id, p] as const));
  const rows: UpcomingRow[] = [];
  for (const o of raw.occurrences) {
    if (!(OPEN_OCCURRENCE_STATUSES as readonly string[]).includes(o.status)) continue;
    const plan = planById.get(o.plan_id);
    // A finished plan collects nothing more; its leftover rows are history.
    if (!plan || (plan.status !== "active" && plan.status !== "paused")) continue;
    const rental = lk.rentalById.get(o.rental_id) ?? null;
    const customerId = plan.customer_id ?? rental?.customer_id ?? "";
    const nextAttemptOn = o.status === "failed" ? instantDay(o.next_attempt_at, plan.timezone ?? ctx.timeZone) : null;
    const dueDate = String(o.due_date).slice(0, 10);
    rows.push({
      occurrenceId: o.id,
      planId: o.plan_id,
      rentalId: o.rental_id,
      rentalRef: rentalRefOf(rental, o.rental_id) ?? "",
      customerId,
      customerName: (customerId && lk.customerNameById.get(customerId)) || UNKNOWN_CUSTOMER,
      dueDate,
      seqLabel: labels.get(o.id) ?? `Payment #${o.seq}`,
      amountCents: occurrenceRemainingCents(o),
      method: (o.collection_method as UpcomingMethod) ?? "manual",
      status: o.status,
      effectiveOn: nextAttemptOn ?? dueDate,
      nextAttemptOn,
      planStatus: plan.status,
    });
  }
  return rows.sort((a, b) =>
    a.effectiveOn !== b.effectiveOn ? (a.effectiveOn < b.effectiveOn ? -1 : 1) : a.seqLabel < b.seqLabel ? -1 : 1,
  );
}

/** A row the Upcoming card counts, before the 7-day window is applied. */
export function isUpcomingCardCandidate(u: Pick<UpcomingRow, "planStatus" | "status" | "nextAttemptOn">): boolean {
  if (u.planStatus !== "active") return false;
  if ((UPCOMING_CARD_STATUSES as readonly string[]).includes(u.status)) return true;
  return u.status === "failed" && !!u.nextAttemptOn;
}
