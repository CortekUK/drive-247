/**
 * Single source of truth for "did we actually receive this money?".
 *
 * WHY THIS EXISTS
 * ---------------
 * `payments` rows are created at INTENT time, not at settlement time: a Stripe
 * checkout link, a pre-authorisation hold and an installment link all insert a
 * row with a real `amount` and a same-day `payment_date` long before any money
 * moves. Voiding or reversing a payment sets `status` and zeroes
 * `remaining_amount` but deliberately LEAVES `amount` at full face value
 * (void-payment-link, reverse-payment) — so any total that sums `amount`
 * without a status predicate counts money that was never received.
 *
 * That is exactly how the Payments page reported $1,101.25 for a month in which
 * $751.25 was collected (a $350 voided payment inflating the card), and
 * $9,920.91 for a month that really took $5,902.25 (voids + uncaptured holds).
 *
 * The correct predicate had been hand-written inline in several per-rental
 * views and never once applied to a roll-up. Import from here instead of
 * copying it a fifth time.
 */

/**
 * Statuses that mean money has actually landed (subject to the capture check).
 *
 * 'Partial Refund' IS included: the operator kept part of that money, so
 * dropping the row entirely understates revenue by the kept portion — the
 * opposite error to the one being fixed. Its refunded slice is netted off in
 * receivedAmount() below, so it contributes `amount - refund_amount`.
 */
export const RECEIVED_PAYMENT_STATUSES = [
  'Applied',
  'Credit',
  'Partial',
  'Completed',
  'Partial Refund',
] as const;

/**
 * Statuses explicitly NOT money in hand:
 *   Pending   — checkout link / pre-auth hold created, never paid
 *   Reversed  — voided or reversed (the `amount` column is left intact!)
 *   Refunded  — returned in full, so net received is zero by definition
 *   Cancelled — written by reject-rental / cancel-rental-refund
 */

export interface PaymentLike {
  status?: string | null;
  capture_status?: string | null;
  amount?: number | string | null;
  refund_amount?: number | string | null;
}

/**
 * True when this row represents money actually received.
 *
 * The capture check matters: an uncaptured pre-authorisation can carry
 * status='Applied' while capture_status='requires_capture'. That is authorised,
 * not captured — it is not revenue. Mirrors isCaptured() in use-payment-links.ts
 * and the guard in use-customer-balance.ts.
 */
export function isMoneyReceived(payment: PaymentLike | null | undefined): boolean {
  if (!payment?.status) return false;
  if (!(RECEIVED_PAYMENT_STATUSES as readonly string[]).includes(payment.status)) return false;
  if (payment.capture_status === 'requires_capture') return false;
  return true;
}

/**
 * How much of this row was actually kept, net of any refund.
 * Returns 0 for anything that is not money received.
 */
export function receivedAmount(payment: PaymentLike | null | undefined): number {
  if (!isMoneyReceived(payment)) return 0;
  const gross = Number(payment?.amount || 0);
  const refunded = Number(payment?.refund_amount || 0);
  const net = gross - refunded;
  return net > 0 ? net : 0;
}

/** Sum only the money actually received, net of refunds. */
export function sumReceived(payments: Array<PaymentLike> | null | undefined): number {
  return (payments || []).reduce((total, p) => total + receivedAmount(p), 0);
}

/** Columns a query must select for these helpers to work. */
export const RECEIVED_PAYMENT_COLUMNS = 'amount, status, capture_status, refund_amount';
