/**
 * SQUARE — the card payment path and the adapter's failure handling.
 * Layer 3 (executable, through the `@fn` alias) plus Layer 1 where the behaviour
 * is structural.
 *
 * Two verified defects are documented here, both in the same shape: an error
 * whose CAUSE is not examined before an irreversible conclusion is drawn about
 * the money. In one, a transient failure permanently kills a live debt. In the
 * other, a successful refund is recorded without its Square handle, so it can
 * never be reconciled.
 *
 * NOT COVERED: refund idempotency and the provider seam (refund-idempotency.test.ts),
 * OAuth and webhook auth (oauth-and-webhook.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { majorToMinorUnits, SQUARE_PAYMENT_NOTE_MAX, buildSquarePaymentNote } from "@fn/_shared/payments/square-adapter.ts";
import { SQUARE_CAPABILITIES } from "@fn/_shared/payments/capabilities.ts";

const root = (p: string) => resolve(__dirname, "../../../", p);
const ADAPTER = readFileSync(root("supabase/functions/_shared/payments/square-adapter.ts"), "utf8");
const SCHEDULED_REFUND = readFileSync(root("supabase/functions/process-scheduled-refund/index.ts"), "utf8");

// @usecase A renter's card is declined, or Square times out, and the operator's
// payment link is silently killed. The debt is real and now unpayable, and
// nothing tells anyone.
describe("square card payment — what happens to the row when the charge fails", () => {
  it("marks the payment row dead before it has looked at why the call failed", () => {
    /**
     * DEFECT, square-adapter.ts:892-895. The catch block runs
     *     if (paymentRowId) await markSquareRowDead(supabase, paymentRowId);
     * FIRST, and only then inspects `err instanceof SquareError` to decide the
     * HTTP response. So the row is killed for every cause without distinction:
     * a card decline (a 400 SquareError), a Square 5xx, and a network timeout all
     * take the same branch.
     *
     * markSquareRowDead (:376-384) writes status 'Reversed' and capture_status
     * 'cancelled'. On an emailed-link debt that is terminal — the renter's link
     * stops working and the money is still owed. A decline is the ONE case where
     * the row must survive, because the renter will simply try another card.
     */
    const catchAt = ADAPTER.indexOf("} catch (err) {", ADAPTER.indexOf("receiptUrl: payment.receipt_url"));
    expect(catchAt, "the card-payment catch block moved").toBeGreaterThan(-1);
    const tail = ADAPTER.slice(catchAt, catchAt + 600);
    const deadAt = tail.indexOf("markSquareRowDead");
    const kindAt = tail.indexOf("err instanceof SquareError");
    expect(deadAt).toBeGreaterThan(-1);
    expect(kindAt).toBeGreaterThan(-1);
    expect(deadAt, "the row is killed before the cause is examined").toBeLessThan(kindAt);
  });

  it("writes Reversed and cancelled, which is terminal for a payable link", () => {
    expect(ADAPTER).toMatch(/status:\s*"Reversed"/);
    expect(ADAPTER).toMatch(/capture_status:\s*"cancelled"/);
  });

  it.fails("should leave the row payable when the failure was a decline or a timeout", () => {
    // Remove the `.fails` marker once the catch inspects the cause before calling
    // markSquareRowDead — only an unambiguous, non-retryable rejection should kill
    // the row. A decline and a timeout must both leave the debt collectable.
    const catchAt = ADAPTER.indexOf("} catch (err) {", ADAPTER.indexOf("receiptUrl: payment.receipt_url"));
    const tail = ADAPTER.slice(catchAt, catchAt + 600);
    expect(tail.indexOf("err instanceof SquareError")).toBeLessThan(tail.indexOf("markSquareRowDead"));
  });
});

// @usecase A refund is issued at Square and recorded here with a NULL handle, so
// the two can never be reconciled — and the payment reads as refunded. Their own
// comment shows this class of bug was already fixed once by another route.
describe("square refunds — the handle the caller stores never arrives", () => {
  it("emits the refund handle under camelCase keys from the adapter", () => {
    // square-adapter.ts:1008-1009 — refundId and squareRefundId.
    expect(ADAPTER).toMatch(/refundId:\s*refund\.id/);
    expect(ADAPTER).toMatch(/squareRefundId:\s*refund\.id/);
  });

  it("reads it back under snake_case keys the adapter never sends", () => {
    /**
     * DEFECT, process-scheduled-refund:83:
     *     const squareRefundId = (body.square_refund_id ?? body.refund_id ?? null)
     * Neither key exists on the adapter's response, so this resolves to null. The
     * update then writes square_refund_id: null alongside a refund_processed_at
     * timestamp — the payment reads as refunded with no Square handle to
     * reconcile against.
     *
     * The comment directly above it (:71-73) records that a PREVIOUS version
     * "wrote refund_processed_at and a NULL square_refund_id, then returned
     * success:true — marking the payment refunded when nothing had been sent to
     * Square." That path was fixed by throwing on skip. This one reaches the same
     * end state by a different route and is still open.
     */
    expect(SCHEDULED_REFUND).toContain("body.square_refund_id ?? body.refund_id");
    expect(ADAPTER).not.toMatch(/square_refund_id:\s*refund\.id/);
  });

  it("still stamps refund_processed_at even when the handle came back null", () => {
    expect(SCHEDULED_REFUND).toMatch(/square_refund_id:\s*squareRefundId/);
    expect(SCHEDULED_REFUND).toMatch(/refund_processed_at:\s*new Date\(\)\.toISOString\(\)/);
  });

  it.fails("should read the handle under the key the adapter actually emits", () => {
    // Remove the `.fails` marker once the caller reads body.squareRefundId (or the
    // adapter also emits snake_case). Either side fixes it; agreeing on one is the
    // point.
    expect(SCHEDULED_REFUND).toMatch(/body\.squareRefundId/);
  });

  it("knows a refund is not settled when Square first accepts it", () => {
    // The correct half of the same area, pinned so it is not lost: Square refunds
    // land PENDING and can still be REJECTED, so nothing may write Completed off
    // the submission response.
    expect(ADAPTER).toContain("Never write Completed off this response");
    expect(SQUARE_CAPABILITIES.refundsSettleAsynchronously).toBe(true);
  });
});

// @usecase Every amount crossing to Square is integer minor units. A rounding
// artifact is a cent wrong on every transaction; a null silently coerced to zero
// charges nothing while reporting success.
describe("square money conversion, executed", () => {
  it("converts whole and fractional major units to integer minor units", () => {
    expect(majorToMinorUnits(89)).toBe(8900);      // 89.00 -> 8900
    expect(majorToMinorUnits(267)).toBe(26700);    // the 3-day rental of 01-pricing-maths
    expect(majorToMinorUnits(80.85)).toBe(8085);   // Bonzah CDW x3
  });

  it("does not lose a cent on values floating point cannot represent exactly", () => {
    // 10.07 * 100 is 1006.9999999999999 in float; a bare multiply would floor to 1006.
    expect(majorToMinorUnits(10.07)).toBe(1007);
    expect(majorToMinorUnits(19.99)).toBe(1999);
    expect(majorToMinorUnits(953.895)).toBe(95390); // the 02-invoice grand total, half a cent up
  });

  it("returns null rather than zero for anything it cannot convert", () => {
    // Zero would be indistinguishable from a legitimate zero-amount charge.
    for (const bad of [null, undefined, "", "abc", NaN, {}]) {
      expect(majorToMinorUnits(bad as unknown)).toBeNull();
    }
  });
});

// @usecase The reference note is how an operator ties a Square payment in their
// own Square dashboard back to a rental here. Truncation past Square's limit
// would break that link silently.
describe("square payment note, executed", () => {
  it("carries the Drive247 reference so a payment can be traced from Square's side", () => {
    expect(buildSquarePaymentNote("RENT-1234")).toContain("RENT-1234");
  });

  it("never exceeds Square's documented note length", () => {
    const long = buildSquarePaymentNote("R".repeat(1000));
    expect(long.length).toBeLessThanOrEqual(SQUARE_PAYMENT_NOTE_MAX);
  });
});
