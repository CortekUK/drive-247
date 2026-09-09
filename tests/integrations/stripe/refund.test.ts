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
//
// TWO LAYERS, the same as the spine:
//
//   LAYER 1  the first describe. Source-derived, no network, always runs. Two
//            of its cases assert the ORDER of the guards rather than their
//            existence, because a guard below `stripe.refunds.create` is not a
//            guard.
//   LAYER 2  the second describe. One case needs only D247_LIVE_TESTS=1 and is
//            provably harmless; the other two need the full ladder up to
//            D247_LIVE_ALLOW_MONEY_MOVEMENT=1 and one of them genuinely refunds
//            money. Each is spelled out above that describe.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  assertContract,
  blankComments,
  readEdgeFunction,
  readEdgeFunctionSource,
  type PayloadContract,
} from "../../helpers/edge-contract";
import {
  classifyLive,
  liveCall,
  liveMoneyGate,
  liveMoneyMovementRequested,
  liveStatus,
} from "../../helpers/live-call";
import {
  callProcessRefund,
  NON_EXISTENT_RENTAL_ID,
  probeRefundableBalance,
  refundBody,
  resolveRefundFixture,
  round2,
} from "../../helpers/stripe-live";

/**
 * The body the portal's refund dialog actually builds —
 * apps/portal/src/components/shared/dialogs/refund-dialog.tsx, the single
 * call-site (`payments-actions.tsx` reuses that dialog rather than duplicating
 * it, deliberately, "on the one screen where drift costs real money").
 *
 * All nine keys, because the dialog sends all nine. The four that used to sit
 * in `serverOnlyOptional` are not omitted by this client at all: excusing a
 * field the caller demonstrably sends is exactly the stale excuse tests/README
 * §9 warns about, and it would hide the next real drift behind it. The live
 * cases at the bottom of this file POST this same shape, so a fictional payload
 * here would mean the live cases prove something about this file rather than
 * about the portal.
 *
 * `paymentId`, `extensionId` and `tenantId` are frequently `undefined` on the
 * wire — JSON.stringify drops them — but the dialog is what decides that, per
 * refund, so they belong in the contract.
 */
const CONTRACT: PayloadContract = {
  step: "05-provision", // not on the spine chain; this folder runs independently
  fn: "process-refund",
  builtIn: "apps/portal/src/components/shared/dialogs/refund-dialog.tsx",
  payload: {
    rentalId: "00000000-0000-0000-0000-000000000000",
    paymentId: undefined,
    extensionId: undefined,
    refundType: "full",
    refundAmount: 100,
    category: "Rental",
    reason: "spine scaffold",
    processedBy: "admin",
    tenantId: undefined,
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
    // `assertContract`, not a bare `diffContract(...)` compared to `[]`.
    //
    // Both detect the same drift. Only one of them SAYS ANYTHING: the raw diff
    // fails with `expected [ 'category' ] to deeply equal []`, which names
    // neither the file that builds the payload, nor the file that reads it, nor
    // which of the team lead's two failure modes it is — the one thing every
    // failure in this suite is required to do. assertContract throws
    // describeDrift(), the same message the spine steps fail with.
    const shape = assertContract(CONTRACT);

    // The parse must have found something. A zero-field shape would make the
    // assertion above pass against a function that reads nothing at all.
    expect(shape.fields.length, `Parsed no request fields out of ${shape.file}`).toBeGreaterThan(0);
    expect(shape.typeName).toBe("RefundRequest");
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

  // ==========================================================================
  // The three properties the Layer 2 cases below stand on.
  //
  // Two of them are ORDER assertions, and order is the whole point: a guard
  // that runs after `stripe.refunds.create` is not a guard, it is a log line
  // written after the money has gone. `blankComments` first, so the several
  // paragraphs of prose in this function that discuss Stripe and ledger writes
  // cannot be mistaken for the calls themselves.
  // ==========================================================================

  it("refuses an over-large refund BEFORE any Stripe client is built", () => {
    const src = blankComments(readEdgeFunctionSource("process-refund"));

    const guardAt = src.indexOf("exceeds available refundable amount");
    const stripeAt = src.indexOf("stripe.refunds.create(");

    expect(
      guardAt,
      "process-refund no longer refuses a refund larger than the category's " +
        "available balance. That check is the only thing between an operator's " +
        "typo and a refund of money nobody paid.",
    ).toBeGreaterThan(-1);
    expect(stripeAt, "process-refund no longer calls stripe.refunds.create at all.").toBeGreaterThan(-1);

    expect(
      guardAt < stripeAt,
      "The `availableForRefund` guard has moved BELOW stripe.refunds.create.\n" +
        "  Stripe would be asked for the money first and refused afterwards, and a\n" +
        "  Stripe refund has no undo. This is not a stale test — nothing in this\n" +
        "  assertion depends on a field name.",
    ).toBe(true);
  });

  it("refuses an Extension refund with no extensionId before it reads anything", () => {
    const src = blankComments(readEdgeFunctionSource("process-refund"));

    const guardAt = src.indexOf("requires an extensionId");
    const firstLedgerRead = src.indexOf('from("ledger_entries")');
    const stripeAt = src.indexOf("stripe.refunds.create(");

    expect(
      guardAt,
      "The Extension/extensionId guard is gone. Its own comment: without extensionId " +
        "the function cannot tell which extension's charge to touch, which leaves " +
        "orphaned ledger rows and a payment whose status never updates.",
    ).toBeGreaterThan(-1);

    // Placed before the reads, not merely before the write. That is what makes
    // the live case below safe to run with nothing but an anon key: the request
    // is answered before the function has looked anything up.
    expect(
      guardAt < firstLedgerRead && guardAt < stripeAt,
      "The Extension guard has moved below the ledger reads or below Stripe.\n" +
        `  guard@${guardAt}  ledger@${firstLedgerRead}  stripe@${stripeAt}\n` +
        "  It is also what makes the Layer 2 case in this file harmless; if it moves,\n" +
        "  that case starts doing more than it claims to.",
    ).toBe(true);
  });

  it("reports whether the ledger row landed, separately from whether Stripe paid out", () => {
    // Comments blanked: the reconciliation paragraph in this function names
    // every one of these keys in prose, and a key that exists only there is a
    // key no caller can read.
    const src = blankComments(readEdgeFunctionSource("process-refund"));

    // The response contract the live case reads. These four exist because the
    // Stripe refund and the ledger row are two unbatched writes with no
    // transaction between them: "money moved but was not recorded" is a real,
    // permanent outcome and the caller has to be able to see it. Collapsing
    // them back into a bare `success` is what made an operator retry a refund
    // that had already paid out — and issue it twice.
    for (const key of ["ledgerRecorded", "requiresReconciliation", "requestedAmount", "recordedAmount"]) {
      expect(
        src,
        `process-refund no longer returns \`${key}\`. Callers cannot then tell a clean ` +
          `success from money-moved-but-unrecorded, and the safe reading of that ` +
          `ambiguity — retry — issues a second real refund.`,
      ).toContain(key);
    }

    // "ONE ledger row" is not a figure of speech: the unique index on
    // (rental_id, due_date, type, category, extension_id) means a second refund
    // of the same category on the same day collides, so the function merges
    // into the existing row instead of inserting.
    expect(
      src,
      "process-refund no longer merges a same-day second refund into the existing " +
        "ledger row. The INSERT will collide with the unique index and the refund " +
        "will look like it failed after Stripe has already paid.",
    ).toContain("mergedAmount");
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// WHAT EACH CASE DOES IF ENABLED:
//
//   "an Extension-category refund without extensionId is refused"
//       POSTs at process-refund with a rental id that cannot exist, an anon
//       key, and no extensionId. Answered by the guard above before the
//       function reads anything, so it moves no money and writes nothing —
//       and it stays harmless even if that guard is deleted, because an anon
//       caller is then 401'd by the authorization block instead. Needs only
//       D247_LIVE_TESTS=1. It is this folder's equivalent of the spine's
//       signup-slug-check: the case that proves the harness reaches a real
//       deployed function.
//
//   "refunding more than was captured is refused"
//       POSTs a deliberately absurd amount against the REAL fixture rental and
//       expects a 400 whose text is our own arithmetic, not Stripe's. Moves no
//       money when the guard holds — and the guard holding is the thing being
//       tested, so it is gated as if it does not.
//
//   "a full refund … returns 200 and records one ledger row"
//       MOVES REAL MONEY. It refunds the fixture category's entire remaining
//       balance on the fixture rental at Stripe. In test mode that is test
//       money; the gate exists because nothing in this process can tell the
//       difference on its own.
//
// The last two need the fixture (D247_LIVE_REFUND_RENTAL_ID, D247_LIVE_PORTAL_JWT)
// and the full ladder: D247_LIVE_TESTS=1 + D247_LIVE_ALLOW_WRITES=1 +
// D247_LIVE_ALLOW_MONEY_MOVEMENT=1 + D247_LIVE_STRIPE_MODE=test.
// ===========================================================================
describe("stripe/refund — live (Layer 2)", () => {
  it("live: an Extension-category refund without extensionId is refused", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip(
        "D247_LIVE_ANON_KEY is not set. Supabase's gateway 401s a request with no " +
          "apikey header before the function is ever invoked, so this probe would " +
          "measure the gateway rather than process-refund.",
      );
      return;
    }

    // Every field the required-check above the guard demands, and a rental id
    // that cannot exist. See the header for why that combination is safe.
    const res = await liveCall(
      "process-refund",
      {
        rentalId: NON_EXISTENT_RENTAL_ID,
        refundType: "partial",
        refundAmount: 1,
        category: "Extension Rental",
        reason: "drive247 spine suite — Extension guard probe",
      },
      { token: status.target.anonKey },
    );

    expect(
      res.status,
      "Expected 400 from process-refund's Extension/extensionId guard.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 401 means the guard now sits BELOW the authorization block — a real\n" +
        "  change, healthy or not, and the Layer 1 order case in this file will say\n" +
        "  which. Anything else is FAILURE MODE (b): " +
        classifyLive(res).explain,
    ).toBe(400);

    expect(
      String(res.json?.error ?? res.text),
      "process-refund answered 400 but not with the Extension guard's message. The " +
        "wording may have been changed (failure mode (a)), or a different validation " +
        "is now firing first.",
    ).toMatch(/requires an extensionId/i);
  });

  it.skipIf(!liveMoneyMovementRequested())(
    "live: refunding more than was captured is refused before Stripe is called",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      const fixture = resolveRefundFixture();
      const probe = await probeRefundableBalance(fixture);

      expect(
        probe.status,
        "process-refund did not refuse a refund of 1,000,000.\n" +
          `  ${probe.status}: ${probe.raw.slice(0, 300)}\n` +
          "  FAILURE MODE (b), and the worst one in this suite: the arithmetic that " +
          "stops an operator refunding money that was never paid did not run.",
      ).toBe(400);

      expect(
        probe.state,
        "The refusal did not arrive in a shape this test can read:\n" +
          `  ${probe.raw.slice(0, 300)}\n` +
          "  FAILURE MODE (a) if someone reworded the message — this case reads the " +
          "available balance out of it, so update helpers/stripe-live.ts's parser to " +
          "match. FAILURE MODE (b) if the body is not process-refund's at all.",
      ).not.toBe("unreadable");

      // The refusal has to be OUR arithmetic, not a Stripe error relayed back.
      // A Stripe-shaped message here would mean the call was made and Stripe
      // declined it — which is the same outcome by luck, not by design, and
      // would not hold for an amount Stripe happened to have headroom for.
      expect(
        probe.raw,
        "process-refund refused, but with a Stripe error — so it asked Stripe for the " +
          "money first and validated afterwards. The Layer 1 order case in this file " +
          "asserts that cannot happen; one of the two is now wrong.",
      ).not.toMatch(/Stripe refund failed/i);
    },
  );

  it.skipIf(!liveMoneyMovementRequested())(
    "live: a full refund against a test-mode charge returns 200 and records one ledger row",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      // Its own rental when one is named, because the partial cases run first
      // (`partial-payment` < `refund`) and deliberately spend the shared
      // fixture to zero.
      const fixture = resolveRefundFixture({ rentalIdVar: "D247_LIVE_FULL_REFUND_RENTAL_ID" });
      const probe = await probeRefundableBalance(fixture);

      if (probe.state === "exhausted") {
        ctx.skip(
          `Nothing left to refund in "${fixture.category}" on rental ${fixture.rentalId}. ` +
            "These fixtures are one-shot: set D247_LIVE_FULL_REFUND_RENTAL_ID to a rental " +
            "with settled money on it, or the partial cases have already spent this one.",
        );
        return;
      }
      expect(probe.state, `Could not read the refundable balance: ${probe.raw.slice(0, 300)}`).toBe("known");
      const available = (probe as { available: number }).available;

      const res = await callProcessRefund(
        fixture,
        refundBody(fixture, { refundType: "full", refundAmount: available }),
      );

      expect(
        res.status,
        `A full refund of ${available} was not accepted.\n` + classifyLive(res).explain,
      ).toBe(200);
      expect(res.json?.success).toBe(true);

      // "One ledger row" asserted through the function's own report rather than
      // by reading ledger_entries: Layer 2 holds no database credentials, by
      // design — it is a caller, like the portal is. `ledgerRecorded` is
      // precisely the claim "the row landed", and `requiresReconciliation` is
      // its negation for the money-moved-but-unrecorded case.
      expect(
        res.json?.ledgerRecorded,
        "Stripe was asked for the refund but the ledger row did not land. This is " +
          "FAILURE MODE (b) and it is NOT retryable — availableForRefund is derived " +
          "from ledger_entries, so a retry re-passes validation and issues a SECOND " +
          "real refund. Reconcile in Stripe by hand.\n" +
          `  ${res.json?.warning ?? ""}`,
      ).toBe(true);
      expect(res.json?.requiresReconciliation).toBe(false);

      // Requested vs recorded must agree with each other. They legitimately
      // differ when the PaymentIntent had less headroom than the ledger thought
      // — in that case the shortfall must be declared, never silently dropped.
      const recorded = Number(res.json?.recordedAmount);
      const remainder = Number(res.json?.unrecordedRemainder ?? 0);
      expect(
        round2(recorded + remainder),
        "requestedAmount, recordedAmount and unrecordedRemainder no longer add up:\n" +
          `  requested=${res.json?.requestedAmount} recorded=${res.json?.recordedAmount} ` +
          `remainder=${res.json?.unrecordedRemainder}\n` +
          "  Those three are how a caller tells a clean refund from a short one. If any " +
          "is missing the response shape changed — failure mode (a), and the Layer 1 " +
          "case above says which key went.",
      ).toBe(round2(Number(res.json?.requestedAmount)));
      if (remainder > 0) {
        expect(
          res.json?.shortfallWarning,
          "Stripe returned less than was requested and the response did not say so. " +
            "The customer is short by the difference and the ledger looks settled.",
        ).toBeTruthy();
      }
    },
  );
});
