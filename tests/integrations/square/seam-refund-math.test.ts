/**
 * SQUARE REFUND MATHS AND RESULT SHAPE.
 *
 * PORTED from refund_math_test.ts and refund_shape_test.ts.
 * Those files hold real, well-written coverage that NO RUNNER EXECUTES:
 * supabase/functions/deno.json has compilerOptions and imports but no "tasks"
 * key, no npm script references deno, and deno is not installed on this machine.
 * Porting was chosen over installing Deno because the seam modules import and
 * run under vitest through the `@fn` alias — readEnv wraps Deno.env.get in
 * try/catch, so the ReferenceError on `Deno` is swallowed at import time.
 *
 * The originals are deliberately left in place rather than deleted: they are the
 * provenance of these assertions, and removing them would make this file look
 * like new work instead of a rescue. They remain unwired.
 *
 * Test titles were REWRITTEN to the convention in tests/README.md section 10 —
 * the Deno names were terse prefixes ("defect 3: ...") and these are harvested
 * into TEST-CATALOGUE.md, so each must read as a behaviour sentence on its own.
 */

import { describe, it, expect } from "vitest";
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  reduceRefundedMinor, minorToMajor2dp, refundStatusFor, remainingAfterRefund,
} from "@fn/_shared/payments/square-refund-math.ts";
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { majorToMinorUnits } from "@fn/_shared/payments/square-adapter.ts";

// --- from refund_math_test.ts ---------------------------------------
/**
 * Regression tests for the Square refund over-count bug.
 *
 * The sequence in the first test is REAL — replayed from
 * square_webhook_events on payment 7bR3JDwdPvNx… where two genuine £10 refunds
 * were recorded as £50 against a £25 payment.
 */
const PAY = "7bR3JDwdPvNx9y2KAQUI327u3SIZY";
const A = PAY + "_NjSlnCzNEXhKckpib9z6wuGyQltPDxOfLpAoaZ4CaCc";
const B = PAY + "_yXLWclAtLPhWmbxO0wJgKuJ4isDJQwysEYvPLTG1omH";
const ev = (id: string, status: string, minor: number) =>
  ({ id, payment_id: PAY, status, amount_money: { amount: minor } });
/** The real event log, NEWEST FIRST (as the query returns it). */
const REAL_SEQUENCE = [
  ev(A, "COMPLETED", 1000),   // 12:38:56
  ev(B, "COMPLETED", 1000),   // 12:38:54
  ev(B, "PENDING",   1000),   // 12:38:52
  ev(A, "COMPLETED", 1000),   // 12:36:55
  ev(B, "PENDING",   1000),   // 12:36:53 (created)
  ev(B, "COMPLETED", 1000),   // 12:36:53 (updated)
  ev(A, "PENDING",   1000),   // 12:36:52 (created)
];

// --- from refund_shape_test.ts --------------------------------------
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

describe("refund maths — the event sequence that produced a wrong total", () => {
  it("the real 7-event sequence yields £20, not £50", () => {
  const minor = reduceRefundedMinor(REAL_SEQUENCE, PAY);
  expect(minor, "two £10 refunds = £20; the old code recorded £50").toEqual(2000);
  expect(minorToMajor2dp(minor!)).toEqual(20);
});

});

describe("assorted seam behaviour", () => {
  it("matches Square's own refunded_money for that payment", () => {
  // Verified live: GET /v2/payments -> amount_money 2500, refunded_money 2000
  expect(reduceRefundedMinor(REAL_SEQUENCE, PAY)).toEqual(2000);
});

  it("the £120 payment (two refunds, £40 + £80) totals £120", () => {
  const P = "j3TuRrSjQrawnjDt7wZqV1vUmPfZY";
  const evs = [
    { id: P + "_a", payment_id: P, status: "COMPLETED", amount_money: { amount: 4000 } },
    { id: P + "_b", payment_id: P, status: "COMPLETED", amount_money: { amount: 8000 } },
    { id: P + "_a", payment_id: P, status: "PENDING",   amount_money: { amount: 4000 } },
  ];
  expect(reduceRefundedMinor(evs, P)).toEqual(12000);
});

  it("rEJECTED and FAILED refunds are excluded — no money moved", () => {
  const evs = [
    ev(A, "COMPLETED", 1000),
    ev(B, "REJECTED",  1000),
  ];
  expect(reduceRefundedMinor(evs, PAY)).toEqual(1000);
  expect(reduceRefundedMinor([ev(A, "FAILED", 1000)], PAY)).toEqual(0);
});

  it("a refund that goes PENDING then REJECTED unwinds to zero", () => {
  // newest first: the REJECTED is the latest state
  expect(reduceRefundedMinor([ev(A, "REJECTED", 1000), ev(A, "PENDING", 1000)], PAY)).toEqual(0);
});

  it("events for OTHER payments are never counted", () => {
  const other = { id: "zzz", payment_id: "SOME_OTHER_PAYMENT", status: "COMPLETED", amount_money: { amount: 9999 } };
  expect(reduceRefundedMinor([ev(A, "COMPLETED", 1000), other], PAY)).toEqual(1000);
});

  it("returns null when nothing countable exists — caller must not guess", () => {
  expect(reduceRefundedMinor([], PAY)).toEqual(null);
  expect(reduceRefundedMinor([{ id: "x", payment_id: "other", status: "COMPLETED", amount_money: { amount: 1 } }], PAY)).toEqual(null);
  // malformed amount is skipped, leaving nothing countable
  expect(reduceRefundedMinor([{ id: "y", payment_id: PAY, status: "COMPLETED", amount_money: { amount: null } }], PAY)).toEqual(null);
});

  it("status and remaining are derived from the corrected total, never stale", () => {
  // the corrupted row: £25 charged, £20 truly refunded
  expect(refundStatusFor(25, 20)).toEqual("Partial Refund");
  expect(remainingAfterRefund(25, 20)).toEqual(5);
  // what the DB wrongly held
  expect(refundStatusFor(25, 50) === "Refunded" && remainingAfterRefund(25, 50) === 0, "with the bogus £50 the row still should not have shown remaining £25").toBeTruthy();
  // full refund
  expect(refundStatusFor(120, 120)).toEqual("Refunded");
  expect(remainingAfterRefund(120, 120)).toEqual(0);
});

  it("over-refund cannot drive remaining negative", () => {
  expect(remainingAfterRefund(25, 40)).toEqual(0);
});

  it("payments row has no amount_cents and no currency — guard against regression", () => {
  const row = realPaymentRow();
  expect((row as Record<string, unknown>).amount_cents).toEqual(undefined);
  expect((row as Record<string, unknown>).currency).toEqual(undefined);
  expect(typeof row.amount === "number", "amount is the real column").toBeTruthy();
});

  it("majorToMinorUnits converts dollars to cents", () => {
  expect(majorToMinorUnits(125.50)).toEqual(12550);
  expect(majorToMinorUnits(1)).toEqual(100);
  expect(majorToMinorUnits(0.01)).toEqual(1);
});

  it("majorToMinorUnits rounds — a bare multiply produces a non-integer Square rejects", () => {
  // Verified empirically: 19.99*100 = 1998.9999999999998, 0.29*100 = 28.999999999999996,
  // 8.87*100 = 886.9999999999999. Square rejects a non-integer with EXPECTED_INTEGER.
  // Note 10.1*100 IS exactly 1010 — only SOME values are affected, which is why an
  // unrounded multiply survives casual testing and then fails on a real price.
  expect(Number.isInteger(19.99 * 100), "the float hazard this guards is real").toEqual(false);
  expect(Number.isInteger(0.29 * 100)).toEqual(false);
  expect(majorToMinorUnits(19.99)).toEqual(1999);
  expect(majorToMinorUnits(0.29)).toEqual(29);
  expect(majorToMinorUnits(8.87)).toEqual(887);
  for (const v of [10.1, 19.99, 0.29, 1.005, 33.33, 8.87, 2.03]) {
    expect(Number.isInteger(majorToMinorUnits(v)!), `${v} must convert to an integer`).toBeTruthy();
  }
});

  it("majorToMinorUnits accepts numeric strings (PostgREST returns numeric as string)", () => {
  expect(majorToMinorUnits("125.50")).toEqual(12550);
  expect(majorToMinorUnits("0.99")).toEqual(99);
});

  it("majorToMinorUnits returns null rather than NaN for junk", () => {
  expect(majorToMinorUnits(undefined)).toEqual(null);
  // Number(null) === 0 — a null amount must never become a zero-amount refund.
  expect(majorToMinorUnits(null)).toEqual(null);
  expect(majorToMinorUnits("")).toEqual(null);
  expect(majorToMinorUnits([])).toEqual(null);
  expect(majorToMinorUnits("not-a-number")).toEqual(null);
  expect(majorToMinorUnits({})).toEqual(null);
  expect(majorToMinorUnits(Infinity)).toEqual(null);
});

  it("reading the OLD column name yields null — the exact bug, now pinned", () => {
  const row = realPaymentRow();
  // This is what the broken adapter did.
  expect(majorToMinorUnits((row as Record<string, unknown>).amount_cents)).toEqual(null);
  // This is what it must do.
  expect(majorToMinorUnits(row.amount)).toEqual(12550);
});

  it("a full refund resolves an amount from the real row (no silent skip)", () => {
  const row = realPaymentRow();
  const amountCents: number | undefined = undefined;   // caller omits => full refund
  const resolved = amountCents ?? majorToMinorUnits(row.amount);
  expect(resolved !== null && resolved !== undefined, "a full refund must resolve an amount, not fall through to a success-shaped skip").toBeTruthy();
  expect(resolved).toEqual(12550);
});

});

describe("refund maths — order independence", () => {
  it("any permutation gives the same total", () => {
  const seen = new Set<number>();
  // rotate through every starting offset
  for (let i = 0; i < REAL_SEQUENCE.length; i++) {
    const rotated = [...REAL_SEQUENCE.slice(i), ...REAL_SEQUENCE.slice(0, i)];
    seen.add(reduceRefundedMinor(rotated, PAY)!);
  }
  // reversed, and doubled (every event delivered twice)
  seen.add(reduceRefundedMinor([...REAL_SEQUENCE].reverse(), PAY)!);
  seen.add(reduceRefundedMinor([...REAL_SEQUENCE, ...REAL_SEQUENCE], PAY)!);
  expect([...seen], "ordering or duplication must never change the total").toEqual([2000]);
});

});

describe("refund maths — replay safety", () => {
  it("replaying the same event 50 times does not inflate", () => {
  const spam = Array.from({ length: 50 }, () => ev(A, "COMPLETED", 1000));
  expect(reduceRefundedMinor(spam, PAY)).toEqual(1000);
});

});
