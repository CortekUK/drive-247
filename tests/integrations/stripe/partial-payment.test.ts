// =============================================================================
// integrations/stripe — PARTIAL PAYMENT.
//
// The second case Haseeb named. Scaffolded for the same reason as refund.test.ts:
// the agreed scope is onboarding, and this one is harder than it looks —
// a partial refund has to pick WHICH categories it comes out of, in order.
//
// What is asserted today is only the contract surface the eventual behavioural
// tests will stand on: that a partial refund is expressed as an amount plus a
// category, and that the function still distinguishes it from a full one. The
// ordering rules themselves are `todo` because getting them wrong in a test is
// worse than not having the test — it would encode the wrong order as correct.
// =============================================================================

import { describe, expect, it } from "vitest";
import { readEdgeFunction, readEdgeFunctionSource } from "../../helpers/edge-contract";

describe("stripe/partial-payment — the fields a partial refund stands on", () => {
  it("expresses a partial refund as an amount plus a category", () => {
    const shape = readEdgeFunction("process-refund");
    // Without both, "partial" has no meaning: an amount with no category cannot
    // be attributed to a ledger line, and a category with no amount is a full
    // refund of that line by another name.
    expect(shape.fields).toContain("refundAmount");
    expect(shape.fields).toContain("category");
    expect(shape.fields).toContain("refundType");
  });

  it("still distinguishes a partial refund from a full one", () => {
    const src = readEdgeFunctionSource("process-refund");
    // `refundType: "full" | "partial"` is the switch. If it ever collapses to a
    // single path, every partial refund silently becomes a full one — which is
    // the operator's whole deposit going back instead of a cleaning fee.
    expect(src).toMatch(/["']partial["']/);
    expect(src).toMatch(/["']full["']/);
  });

  it.todo("live: a partial refund draws from categories in FIFO order");
  it.todo("live: two partial refunds summing to the charge leave the payment fully refunded");
  it.todo("live: a partial refund that exceeds the remaining balance is refused");
});
