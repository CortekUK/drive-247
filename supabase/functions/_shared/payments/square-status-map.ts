/**
 * Square status -> Drive247 payment status.
 *
 * Kept in its own file because it is the single place where Square's async
 * settlement model meets our synchronous one, and getting it wrong shows up as
 * money that looks collected but is not.
 *
 * THE ASYMMETRY THAT MATTERS: a Stripe refund is COMPLETED the moment the API
 * returns. A Square refund comes back PENDING and settles later via
 * refund.updated — and it can still land REJECTED or FAILED after we have
 * already told the operator "refunded". So a Square refund must never be written
 * as Completed on the API response; it becomes Completed only on the webhook.
 */

/** Square Payment.status */
export type SquarePaymentStatus = "APPROVED" | "PENDING" | "COMPLETED" | "CANCELED" | "FAILED";
/** Square PaymentRefund.status */
export type SquareRefundStatus = "PENDING" | "COMPLETED" | "REJECTED" | "FAILED";

/** Our internal payment status vocabulary (payments.status). */
export type InternalPaymentStatus = "Pending" | "Completed" | "Failed" | "Cancelled";

export function mapSquarePaymentStatus(s: SquarePaymentStatus | string): InternalPaymentStatus {
  switch (s) {
    case "COMPLETED": return "Completed";
    // APPROVED = authorised but NOT captured. Money has not moved. Treating this
    // as Completed would mark a rental paid on an authorisation we never captured.
    case "APPROVED":
    case "PENDING":   return "Pending";
    case "CANCELED":  return "Cancelled";
    case "FAILED":    return "Failed";
    default:          return "Pending";   // unknown = not money yet
  }
}

export function mapSquareRefundStatus(s: SquareRefundStatus | string): InternalPaymentStatus {
  switch (s) {
    case "COMPLETED": return "Completed";
    case "PENDING":   return "Pending";
    case "REJECTED":
    case "FAILED":    return "Failed";
    default:          return "Pending";
  }
}

/** True when the status is terminal — safe to stop polling / reconciling. */
export function isTerminalSquareStatus(s: string): boolean {
  return s === "COMPLETED" || s === "FAILED" || s === "CANCELED" || s === "REJECTED";
}
