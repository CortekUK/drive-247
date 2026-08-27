/**
 * Pure refund arithmetic for Square.
 *
 * Lives here rather than inside square-webhook/index.ts so it can be unit
 * tested — importing the webhook module would execute Deno.serve and start a
 * listener during the test run.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ------------------------------
 * The webhook used to compute the refunded total incrementally
 * (`existing + this`) and decide "already counted?" by comparing against a
 * single `square_refund_id` stored on the payments row. Square permits 20
 * refunds per payment, so with two refunds that one slot flips between them and
 * every redelivery of the *other* refund reads as new and is added again.
 *
 * Observed in production sandbox on payment 7bR3JDwdPvNx…: two genuine £10
 * refunds produced created(A)=10, updated(B)=20, updated(A)=30, updated(B)=40,
 * updated(A)=50 — recording £50 of refunds against a £25 payment when only £20
 * had left the account. Square guarantees NO ordering and redelivers freely, so
 * the error compounds without bound.
 *
 * The reducer below is idempotent, order-independent and duplicate-immune:
 * replaying the same events in any order, any number of times, yields the same
 * total.
 */

export interface RefundEventLike {
  id?: string | null;
  payment_id?: string | null;
  status?: string | null;
  amount_money?: { amount?: number | null } | null;
}

/** Square refund statuses that mean no money moved. */
const NON_MOVING = new Set(["REJECTED", "FAILED"]);

/**
 * Reduce a set of refund events to the true refunded total, in MINOR units.
 *
 * @param events  every refund event seen for one payment, NEWEST FIRST
 * @param paymentId  only events for this Square payment are counted
 * @returns total in minor units, or null when nothing countable was found
 *          (callers must then leave the stored value alone rather than write a guess)
 */
export function reduceRefundedMinor(
  events: RefundEventLike[],
  paymentId: string,
): number | null {
  // Latest state wins per DISTINCT refund id. Input is newest-first, so the
  // first sighting of an id is its current state.
  const latest = new Map<string, { minor: number; status: string }>();

  for (const r of events) {
    if (!r || r.payment_id !== paymentId) continue;
    const id = r.id;
    if (!id || latest.has(id)) continue;
    // Number(null) === 0 and Number(undefined) === NaN. A refund whose amount we
    // do not know must be SKIPPED, not banked as a £0 refund — recording it as
    // zero would silently under-count the payment's true refunded total.
    const raw = r.amount_money?.amount;
    if (raw === null || raw === undefined) continue;
    const minor = Number(raw);
    if (!Number.isFinite(minor)) continue;
    latest.set(id, { minor, status: String(r.status ?? "").toUpperCase() });
  }

  if (latest.size === 0) return null;

  let total = 0;
  for (const { minor, status } of latest.values()) {
    if (NON_MOVING.has(status)) continue;
    total += minor;
  }
  return total;
}

/** Minor units -> major, rounded to 2dp. Square reports minor; payments.amount is major. */
export function minorToMajor2dp(minor: number): number {
  return Math.round((minor / 100) * 100) / 100;
}

/**
 * Derive payment status from the corrected total.
 * Kept beside the reducer so status and amount can never disagree.
 */
export function refundStatusFor(
  originalMajor: number,
  refundedMajor: number,
): "Refunded" | "Partial Refund" {
  return originalMajor > 0 && refundedMajor >= originalMajor ? "Refunded" : "Partial Refund";
}

/** remaining = original - refunded, never negative. */
export function remainingAfterRefund(originalMajor: number, refundedMajor: number): number {
  return Math.round(Math.max(0, originalMajor - refundedMajor) * 100) / 100;
}
