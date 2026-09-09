// =============================================================================
// integrations/stripe — REFUND.
//
// Named by Haseeb as one of the two cases that belong in this folder ("like
// REFUND, PARTIAL PAYMENT"). It is SCAFFOLDED, not built: the onboarding flow
// is the whole of the current scope, and refunds move real money in the other
// direction, which is not a thing to automate against anything live in a hurry.
//
// What it does today is worth having on its own, though: it proves the contract
// helper works on a function nobody involved in onboarding wrote. `process-refund`
// parses its body by DESTRUCTURING (`const { rentalId, ... }: RefundRequest =
// await req.json()`), a different shape from all four signup functions. If the
// helper only handled the shapes it was written against, it would silently
// report zero fields here and every future refund contract test would pass
// against nothing.
// =============================================================================

import { describe, expect, it } from "vitest";
import { diffContract, readEdgeFunction, type PayloadContract } from "../../helpers/edge-contract";

/**
 * From apps/portal — the refund dialog's body. Kept minimal on purpose: the
 * behavioural cases below are what would make this contract worth extending,
 * and they are not in scope yet.
 */
const CONTRACT: PayloadContract = {
  step: "05-provision", // not on the spine chain; this folder runs independently
  fn: "process-refund",
  builtIn: "apps/portal — refund dialog",
  payload: {
    rentalId: "00000000-0000-0000-0000-000000000000",
    refundType: "full",
    refundAmount: 100,
    category: "Rental",
    reason: "spine scaffold",
  },
  serverOnlyOptional: {
    paymentId: "Optional — omitted for a full refund, which resolves its own payment rows.",
    extensionId: "Required only for an Extension-category refund; see the function's guard.",
    processedBy: "Stamped by the caller when a staff user is attributable.",
    tenantId: "Falls back to the rental's tenant when the caller does not send one.",
  },
};

describe("stripe/refund — the process-refund request contract", () => {
  it("parses a destructured request body (a shape the signup functions never use)", () => {
    const shape = readEdgeFunction("process-refund");
    expect(
      shape.fields.length,
      "The contract helper found no request fields in process-refund. It parses three " +
        "body shapes; this function destructures. A silent zero here would make every " +
        "refund contract assertion pass against nothing.",
    ).toBeGreaterThan(0);
    expect(shape.fields).toContain("rentalId");
    expect(shape.fields).toContain("refundAmount");
  });

  it("agrees with the portal's refund payload", () => {
    const drift = diffContract(CONTRACT, readEdgeFunction("process-refund"));
    expect(drift.extra).toEqual([]);
    expect(drift.missing).toEqual([]);
  });

  it("still requires an amount and a reason", () => {
    // These two are what the function hard-rejects on ("Missing required
    // fields: rentalId, reason, and valid refundAmount"). A refund with no
    // recorded reason is an unexplainable movement of an operator's money.
    const shape = readEdgeFunction("process-refund");
    expect(shape.requiredByType).toContain("rentalId");
    expect(shape.requiredByType).toContain("reason");
    expect(shape.requiredByType).toContain("refundAmount");
  });

  it.todo("live: a full refund against a test-mode charge returns 200 and writes one ledger row");
  it.todo("live: refunding more than was captured is refused before Stripe is called");
  it.todo("live: an Extension-category refund without extensionId is refused");
});
