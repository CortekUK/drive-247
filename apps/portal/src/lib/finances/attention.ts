/**
 * Needs attention (design §4). Pure. Each rule, exactly:
 *
 *   card_declined       a plan occurrence with status `failed`
 *   needs_customer      a plan occurrence with status `requires_action`
 *   awaiting_review     a payment with verification_status 'pending' that the
 *                       Payments tab would still let you Approve/Reject (not
 *                       reversed, capture not cancelled) — receipt status
 *                       `pending_review`
 *   possible_duplicate  ≥ 2 captured payments (money actually received) on the
 *                       same rental, same amount, same payment_date
 *   unapplied_credit    a captured payment with status Credit or Partial and
 *                       remaining_amount > 0
 *
 * Sorted by money at stake, largest first: an occurrence's remaining amount, a
 * payment's amount, the unapplied remainder, and for a duplicate the copies
 * beyond the first (amount × (n − 1)).
 *
 * Decline reasons go through `customerSafeReason`: a lost/stolen/fraud code is
 * never put into words, for the operator either (they would repeat it).
 */

import { customerSafeReason } from "@/lib/payment-plans/classify";
import { formatDay, formatMoney } from "@/lib/payment-plans-ui/format";
import { rentalRefOf, UNKNOWN_CUSTOMER, type FinanceLookups } from "./lookups";
import { instantDay } from "./period";
import { occurrenceRemainingCents } from "./upcoming";
import type { AttentionItem, AttentionKind, FinanceContext, FinanceRawData, RawAttempt, RawPlan, ReceiptRow } from "./types";

const KIND_ORDER: Record<AttentionKind, number> = {
  card_declined: 0,
  needs_customer: 1,
  awaiting_review: 2,
  possible_duplicate: 3,
  unapplied_credit: 4,
};

function lastAttemptByOccurrence(attempts: RawAttempt[]): Map<string, RawAttempt> {
  const out = new Map<string, RawAttempt>();
  for (const a of attempts) {
    const prev = out.get(a.occurrence_id);
    if (!prev || a.attempt_no > prev.attempt_no) out.set(a.occurrence_id, a);
  }
  return out;
}

export function buildAttention(
  raw: FinanceRawData,
  lk: FinanceLookups,
  receipts: ReceiptRow[],
  labels: Map<string, string>,
  ctx: FinanceContext,
): AttentionItem[] {
  const $ = (c: number) => formatMoney(c, ctx.currency);
  const items: AttentionItem[] = [];
  const planById = new Map<string, RawPlan>(raw.plans.map((p) => [p.id, p] as const));
  const lastAttempt = lastAttemptByOccurrence(raw.attempts);
  const nameOf = (id: string | null | undefined) => (id && lk.customerNameById.get(id)) || UNKNOWN_CUSTOMER;

  // ── plan occurrences ──────────────────────────────────────────────────────
  for (const o of raw.occurrences) {
    if (o.status !== "failed" && o.status !== "requires_action") continue;
    const plan = planById.get(o.plan_id) ?? null;
    const rental = lk.rentalById.get(o.rental_id) ?? null;
    const customerId = plan?.customer_id ?? rental?.customer_id ?? null;
    const name = nameOf(customerId);
    const ref = rentalRefOf(rental, o.rental_id);
    const label = labels.get(o.id) ?? `Payment #${o.seq}`;
    const left = occurrenceRemainingCents(o);
    const where = `${label} on ${ref}, due ${formatDay(String(o.due_date).slice(0, 10))}`;

    if (o.status === "failed") {
      const a = lastAttempt.get(o.id) ?? null;
      const reason = customerSafeReason(a?.decline_code ?? null, a?.error_code ?? null);
      const retryOn = o.next_attempt_at ? instantDay(o.next_attempt_at, plan?.timezone ?? ctx.timeZone) : null;
      items.push({
        key: `card_declined:${o.id}`,
        kind: "card_declined",
        title: `Card declined — ${name}`,
        detail: `${where}: “${reason}” ${retryOn ? `It will be tried again on ${formatDay(retryOn)}.` : "No retry is scheduled."} ${$(left)} is outstanding.`,
        amountCents: left,
        rentalId: o.rental_id,
        customerId,
        paymentIds: [],
        occurrenceId: o.id,
      });
    } else {
      items.push({
        key: `needs_customer:${o.id}`,
        kind: "needs_customer",
        title: `Waiting for ${name} to confirm`,
        detail: `${where}: the bank asked the customer to confirm this payment. ${$(left)} is outstanding until they do.`,
        amountCents: left,
        rentalId: o.rental_id,
        customerId,
        paymentIds: [],
        occurrenceId: o.id,
      });
    }
  }

  // ── payments ──────────────────────────────────────────────────────────────
  const dupes = new Map<string, ReceiptRow[]>();
  for (const r of receipts) {
    if (r.status === "pending_review") {
      items.push({
        key: `awaiting_review:${r.paymentId}`,
        kind: "awaiting_review",
        title: `Payment to review — ${r.customerName}`,
        detail: `${$(r.amountCents)}${r.method ? ` by ${r.method}` : ""} on ${formatDay(r.date)}${r.rentalRef ? ` for ${r.rentalRef}` : ""} is waiting for approval.`,
        amountCents: r.amountCents,
        rentalId: r.rentalId,
        customerId: r.customerId || null,
        paymentIds: [r.paymentId],
        occurrenceId: r.occurrenceId,
      });
    }

    if (r.countsAsReceived && r.rentalId) {
      const k = `${r.rentalId}|${r.amountCents}|${r.date}`;
      const list = dupes.get(k);
      if (list) list.push(r);
      else dupes.set(k, [r]);
    }

    if ((r.rawStatus === "Credit" || r.rawStatus === "Partial") && r.unappliedCents > 0) {
      items.push({
        key: `unapplied_credit:${r.paymentId}`,
        kind: "unapplied_credit",
        title: `Unapplied credit — ${r.customerName}`,
        detail: `${$(r.unappliedCents)} of the ${$(r.amountCents)} paid on ${formatDay(r.date)} hasn't been applied to any charge.`,
        amountCents: r.unappliedCents,
        rentalId: r.rentalId,
        customerId: r.customerId || null,
        paymentIds: [r.paymentId],
        occurrenceId: r.occurrenceId,
      });
    }
  }

  dupes.forEach((list) => {
    if (list.length < 2) return;
    const first = list[0];
    const ids = list.map((r) => r.paymentId).sort();
    items.push({
      key: `possible_duplicate:${ids.join(",")}`,
      kind: "possible_duplicate",
      title: `Possible duplicate — ${first.customerName}`,
      detail: `${list.length} payments of ${$(first.amountCents)} on ${formatDay(first.date)} for ${first.rentalRef ?? "the same rental"}.`,
      amountCents: first.amountCents * (list.length - 1),
      rentalId: first.rentalId,
      customerId: first.customerId || null,
      paymentIds: ids,
      occurrenceId: null,
    });
  });

  return items.sort((a, b) => {
    if (a.amountCents !== b.amountCents) return b.amountCents - a.amountCents;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
