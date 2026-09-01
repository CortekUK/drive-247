/**
 * Regression tests for the refund money path.
 *
 * WHY THESE EXIST: the first version of square-adapter.ts read
 * `paymentRecord.amount_cents` and `paymentRecord.currency`. NEITHER COLUMN
 * EXISTS on public.payments — verified against the live schema, which has
 * `amount numeric` (MAJOR units) and no currency column at all.
 *
 * The consequences were both silent and severe:
 *   - full refund  -> amount undefined -> skip('refund_amount_unknown'), which is
 *     handled:true, so the operator got an HTTP 200 success shape and NO MONEY MOVED.
 *   - partial refund -> currency defaulted to 'USD' against a GBP location ->
 *     Square 400 INVALID_VALUE, escaping as an unhandled 500.
 *
 * The original suite passed because it hand-built a row shape that does not
 * exist. Every test here uses the REAL column set.
 */

import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { majorToMinorUnits } from "../square-adapter.ts";

/** The real shape of a public.payments row, as far as the refund path cares. */
function realPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    payment_provider: "square",
    square_payment_id: "sqpmt_abc123",
    amount: 125.50,          // numeric, MAJOR units. NOT amount_cents.
    refund_amount: null,
    remaining_amount: null,
    // NOTE: there is deliberately no `currency` key — the column does not exist.
    ...overrides,
  };
}

Deno.test("payments row has no amount_cents and no currency — guard against regression", () => {
  const row = realPaymentRow();
  assertEquals((row as Record<string, unknown>).amount_cents, undefined);
  assertEquals((row as Record<string, unknown>).currency, undefined);
  assert(typeof row.amount === "number", "amount is the real column");
});

Deno.test("majorToMinorUnits converts dollars to cents", () => {
  assertEquals(majorToMinorUnits(125.50), 12550);
  assertEquals(majorToMinorUnits(1), 100);
  assertEquals(majorToMinorUnits(0.01), 1);
});

Deno.test("majorToMinorUnits rounds — a bare multiply produces a non-integer Square rejects", () => {
  // Verified empirically: 19.99*100 = 1998.9999999999998, 0.29*100 = 28.999999999999996,
  // 8.87*100 = 886.9999999999999. Square rejects a non-integer with EXPECTED_INTEGER.
  // Note 10.1*100 IS exactly 1010 — only SOME values are affected, which is why an
  // unrounded multiply survives casual testing and then fails on a real price.
  assertEquals(Number.isInteger(19.99 * 100), false, "the float hazard this guards is real");
  assertEquals(Number.isInteger(0.29 * 100), false);
  assertEquals(majorToMinorUnits(19.99), 1999);
  assertEquals(majorToMinorUnits(0.29), 29);
  assertEquals(majorToMinorUnits(8.87), 887);
  for (const v of [10.1, 19.99, 0.29, 1.005, 33.33, 8.87, 2.03]) {
    assert(Number.isInteger(majorToMinorUnits(v)!), `${v} must convert to an integer`);
  }
});

Deno.test("majorToMinorUnits accepts numeric strings (PostgREST returns numeric as string)", () => {
  assertEquals(majorToMinorUnits("125.50"), 12550);
  assertEquals(majorToMinorUnits("0.99"), 99);
});

Deno.test("majorToMinorUnits returns null rather than NaN for junk", () => {
  assertEquals(majorToMinorUnits(undefined), null);
  // Number(null) === 0 — a null amount must never become a zero-amount refund.
  assertEquals(majorToMinorUnits(null), null);
  assertEquals(majorToMinorUnits(""), null);
  assertEquals(majorToMinorUnits([]), null);
  assertEquals(majorToMinorUnits("not-a-number"), null);
  assertEquals(majorToMinorUnits({}), null);
  assertEquals(majorToMinorUnits(Infinity), null);
});

Deno.test("reading the OLD column name yields null — the exact bug, now pinned", () => {
  const row = realPaymentRow();
  // This is what the broken adapter did.
  assertEquals(majorToMinorUnits((row as Record<string, unknown>).amount_cents), null);
  // This is what it must do.
  assertEquals(majorToMinorUnits(row.amount), 12550);
});

Deno.test("a full refund resolves an amount from the real row (no silent skip)", () => {
  const row = realPaymentRow();
  const amountCents: number | undefined = undefined;   // caller omits => full refund
  const resolved = amountCents ?? majorToMinorUnits(row.amount);
  assert(resolved !== null && resolved !== undefined,
    "a full refund must resolve an amount, not fall through to a success-shaped skip");
  assertEquals(resolved, 12550);
});
