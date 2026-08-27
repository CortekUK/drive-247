/**
 * Regression tests for the Square refund over-count bug.
 *
 * The sequence in the first test is REAL — replayed from
 * square_webhook_events on payment 7bR3JDwdPvNx… where two genuine £10 refunds
 * were recorded as £50 against a £25 payment.
 */

import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  reduceRefundedMinor, minorToMajor2dp, refundStatusFor, remainingAfterRefund,
} from "../square-refund-math.ts";

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

Deno.test("THE BUG: the real 7-event sequence yields £20, not £50", () => {
  const minor = reduceRefundedMinor(REAL_SEQUENCE, PAY);
  assertEquals(minor, 2000, "two £10 refunds = £20; the old code recorded £50");
  assertEquals(minorToMajor2dp(minor!), 20);
});

Deno.test("matches Square's own refunded_money for that payment", () => {
  // Verified live: GET /v2/payments -> amount_money 2500, refunded_money 2000
  assertEquals(reduceRefundedMinor(REAL_SEQUENCE, PAY), 2000);
});

Deno.test("ORDER-INDEPENDENT: any permutation gives the same total", () => {
  const seen = new Set<number>();
  // rotate through every starting offset
  for (let i = 0; i < REAL_SEQUENCE.length; i++) {
    const rotated = [...REAL_SEQUENCE.slice(i), ...REAL_SEQUENCE.slice(0, i)];
    seen.add(reduceRefundedMinor(rotated, PAY)!);
  }
  // reversed, and doubled (every event delivered twice)
  seen.add(reduceRefundedMinor([...REAL_SEQUENCE].reverse(), PAY)!);
  seen.add(reduceRefundedMinor([...REAL_SEQUENCE, ...REAL_SEQUENCE], PAY)!);
  assertEquals([...seen], [2000], "ordering or duplication must never change the total");
});

Deno.test("IDEMPOTENT: replaying the same event 50 times does not inflate", () => {
  const spam = Array.from({ length: 50 }, () => ev(A, "COMPLETED", 1000));
  assertEquals(reduceRefundedMinor(spam, PAY), 1000);
});

Deno.test("the £120 payment (two refunds, £40 + £80) totals £120", () => {
  const P = "j3TuRrSjQrawnjDt7wZqV1vUmPfZY";
  const evs = [
    { id: P + "_a", payment_id: P, status: "COMPLETED", amount_money: { amount: 4000 } },
    { id: P + "_b", payment_id: P, status: "COMPLETED", amount_money: { amount: 8000 } },
    { id: P + "_a", payment_id: P, status: "PENDING",   amount_money: { amount: 4000 } },
  ];
  assertEquals(reduceRefundedMinor(evs, P), 12000);
});

Deno.test("REJECTED and FAILED refunds are excluded — no money moved", () => {
  const evs = [
    ev(A, "COMPLETED", 1000),
    ev(B, "REJECTED",  1000),
  ];
  assertEquals(reduceRefundedMinor(evs, PAY), 1000);
  assertEquals(reduceRefundedMinor([ev(A, "FAILED", 1000)], PAY), 0);
});

Deno.test("a refund that goes PENDING then REJECTED unwinds to zero", () => {
  // newest first: the REJECTED is the latest state
  assertEquals(reduceRefundedMinor([ev(A, "REJECTED", 1000), ev(A, "PENDING", 1000)], PAY), 0);
});

Deno.test("events for OTHER payments are never counted", () => {
  const other = { id: "zzz", payment_id: "SOME_OTHER_PAYMENT", status: "COMPLETED", amount_money: { amount: 9999 } };
  assertEquals(reduceRefundedMinor([ev(A, "COMPLETED", 1000), other], PAY), 1000);
});

Deno.test("returns null when nothing countable exists — caller must not guess", () => {
  assertEquals(reduceRefundedMinor([], PAY), null);
  assertEquals(reduceRefundedMinor([{ id: "x", payment_id: "other", status: "COMPLETED", amount_money: { amount: 1 } }], PAY), null);
  // malformed amount is skipped, leaving nothing countable
  assertEquals(reduceRefundedMinor([{ id: "y", payment_id: PAY, status: "COMPLETED", amount_money: { amount: null } }], PAY), null);
});

Deno.test("status and remaining are derived from the corrected total, never stale", () => {
  // the corrupted row: £25 charged, £20 truly refunded
  assertEquals(refundStatusFor(25, 20), "Partial Refund");
  assertEquals(remainingAfterRefund(25, 20), 5);
  // what the DB wrongly held
  assert(refundStatusFor(25, 50) === "Refunded" && remainingAfterRefund(25, 50) === 0,
    "with the bogus £50 the row still should not have shown remaining £25");
  // full refund
  assertEquals(refundStatusFor(120, 120), "Refunded");
  assertEquals(remainingAfterRefund(120, 120), 0);
});

Deno.test("over-refund cannot drive remaining negative", () => {
  assertEquals(remainingAfterRefund(25, 40), 0);
});
