/**
 * Finances — which action a row offers, and the sums the footer writes out.
 *
 * Every action is an EXISTING money path (design safety rule); these rules
 * only decide when the Finances screen OFFERS one, and each mirrors the screen
 * that offered it before:
 *
 *   approve / reject   the Payments tab: a payment still awaiting review
 *   refund             the rental's Payments stage: money that landed, on a
 *                      rental, with something left to refund
 *   remove link        the Payments tab: an unpaid Stripe checkout link
 *   reverse            the Payments tab: a payment recorded by hand, never
 *                      one a processor took (that is a refund)
 *
 * Each edge function / RPC re-checks its own rule server-side; these gates are
 * what the operator is shown, not the enforcement. Pure, so a test pins them.
 */
import type { BillRow, FinanceCard, ReceiptRow, UpcomingRow } from "@/lib/finances/types";

type R = Pick<
  ReceiptRow,
  | "status"
  | "rawStatus"
  | "countsAsReceived"
  | "rentalId"
  | "amountCents"
  | "refundedCents"
  | "provider"
  | "checkoutSessionId"
  | "paymentType"
  | "verificationStatus"
>;

const reversed = (r: Pick<ReceiptRow, "rawStatus">) => r.rawStatus === "Reversed";

export function canReview(r: R): boolean {
  return r.status === "pending_review" && !reversed(r);
}

export function canRefund(r: R): boolean {
  return (
    r.countsAsReceived &&
    !!r.rentalId &&
    r.amountCents - r.refundedCents > 0 &&
    r.status !== "rejected" &&
    !reversed(r)
  );
}

/** An unpaid Stripe checkout link: safe to cancel, the rental untouched. */
export function canRemoveLink(r: R): boolean {
  return (
    !r.countsAsReceived &&
    !!r.checkoutSessionId &&
    r.paymentType !== "InitialFee" &&
    r.verificationStatus === "pending" &&
    !reversed(r)
  );
}

/** Money recorded by hand, never refunded or rejected: its allocations can be undone. */
export function canReverse(r: R): boolean {
  return (
    r.provider === "manual" &&
    !reversed(r) &&
    r.refundedCents === 0 &&
    r.verificationStatus !== "rejected" &&
    r.status !== "rejected" &&
    !canRemoveLink(r)
  );
}

/**
 * `RefundDialog` refunds ONE category. The payment's largest allocation is the
 * honest default — where most of the money went — exactly as the rental's
 * Payments stage chooses it. "Rental" when it was applied to nothing.
 */
export function refundCategoryOf(r: Pick<ReceiptRow, "appliedTo">): string {
  const by = new Map<string, number>();
  for (const a of r.appliedTo) by.set(a.category, (by.get(a.category) ?? 0) + a.amountCents);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? "Rental";
}

/**
 * A bill the operator can take money against from here, through the portal's
 * own payment window (`AddPaymentDialog`: record it, email a link, or charge
 * the saved card).
 *
 * Not a cancelled or rejected rental (nothing there is owed), and not one
 * billed day by day: those settle against the day's bill, which only the
 * rental's own Payments stage aims at — the row sends the operator there.
 */
export function canCollectOnBill(
  b: Pick<BillRow, "onRental" | "rentalId" | "balanceCents" | "isPayg" | "excludedReason">,
): boolean {
  return b.onRental && !!b.rentalId && b.balanceCents > 0 && !b.isPayg && !b.excludedReason;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * The figure the footer adds up for the rows on screen, and what it is called.
 *
 * With a card filtering, it is that card's own measure — so the sum under the
 * table is the card's number rebuilt from the rows (design: every number on
 * screen explainable from rows on screen). Without one, it is the plain total
 * of the column the view is about.
 */
export function listSum(
  view: "billed" | "received" | "upcoming",
  card: FinanceCard | null,
  rows: { bills?: BillRow[]; receipts?: ReceiptRow[]; upcoming?: UpcomingRow[] },
): { label: string; cents: number } {
  if (view === "billed") {
    const bills = rows.bills ?? [];
    if (card === "outstanding") return { label: "Outstanding on these bills", cents: sum(bills.map((b) => b.outstandingCents)) };
    if (card === "overdue") return { label: "Overdue on these bills", cents: sum(bills.map((b) => b.overdueCents)) };
    return { label: "Balance across these bills", cents: sum(bills.map((b) => b.balanceCents)) };
  }
  if (view === "received") {
    const receipts = rows.receipts ?? [];
    if (card === "collected") {
      return { label: "Collected in these payments", cents: sum(receipts.filter((r) => r.countsAsReceived).map((r) => r.netCents)) };
    }
    return { label: "Received in these payments, less refunds", cents: sum(receipts.filter((r) => r.countsAsReceived).map((r) => r.netCents)) };
  }
  const upcoming = rows.upcoming ?? [];
  return { label: card === "upcoming" ? "Due in the next 7 days" : "Due on these payments", cents: sum(upcoming.map((u) => u.amountCents)) };
}

/* ── where a row's links lead ────────────────────────────────────────────── */

/**
 * The customer and vehicle records a row names — the same destinations the
 * Payments tab's row linked its customer and vehicle cells to
 * (`/customers/<id>`, `/vehicles/<id>`). Null when the row has none, so the
 * link is simply not offered.
 */
export function customerHref(customerId: string | null | undefined): string | null {
  return customerId ? `/customers/${customerId}` : null;
}

export function vehicleHref(vehicleId: string | null | undefined): string | null {
  return vehicleId ? `/vehicles/${vehicleId}` : null;
}
