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
//
// That last sentence turned out to matter. Reading the two functions showed the
// premise behind the "FIFO order" case was inverted; the real rule, and where
// FIFO genuinely binds a partial refund, is set out in the comment above the
// ordering cases below.
//
// TWO LAYERS, the same as the spine:
//
//   LAYER 1  the first describe. Source-derived, no network, always runs.
//   LAYER 2  the second describe. Every case there moves or attempts to move
//            real money, so all three need the full gate ladder up to
//            D247_LIVE_ALLOW_MONEY_MOVEMENT=1 plus a fixture rental. What each
//            one does when enabled is spelled out above that describe.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunction, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { classifyLive, liveMoneyGate, liveMoneyMovementRequested } from "../../helpers/live-call";
import {
  callProcessRefund,
  probeRefundableBalance,
  refundBody,
  resolveRefundFixture,
  round2,
} from "../../helpers/stripe-live";

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

  // ==========================================================================
  // THE ORDER QUESTION, ANSWERED PROPERLY.
  //
  // The `todo` this replaces read "a partial refund draws from categories in
  // FIFO order". Reading the two functions shows the premise is inverted, and
  // the header above says encoding a wrong order as correct is worse than
  // having no test — so here is what is actually true:
  //
  //   A refund does NOT walk the categories. It NAMES one (`category`) and
  //   every read, every guard and the ledger row are scoped to it.
  //
  //   FIFO lives on the other side of the transaction, in `apply-payment`:
  //   when the money came IN, that order decided how much of the payment
  //   landed in each category, and it wrote the answer to
  //   `payment_applications.amount_applied`.
  //
  //   process-refund then READS THAT BACK as `categoryCap`, and clamps the
  //   Stripe refund with it. So FIFO does bind a partial refund — not by being
  //   re-walked, but by being the record of what this payment ever put into
  //   this category.
  //
  // Both halves are asserted, because the guarantee only holds while both are
  // in place.
  // ==========================================================================

  it("settles the security deposit LAST when money comes in — the order the cap is computed from", () => {
    const src = blankComments(readEdgeFunctionSource("apply-payment"));
    const block = /allocationOrder = \[([\s\S]*?)\n\s*\];/.exec(src)?.[1];

    expect(
      block,
      "apply-payment no longer declares a literal `allocationOrder` list. The FIFO " +
        "order is what decides how much of an incoming payment lands in each category, " +
        "and process-refund reads that decision back as its category cap.",
    ).toBeTruthy();

    const at = (category: string) => (block as string).indexOf(`'${category}'`);
    expect(at("Rental"), "no Rental in the allocation order").toBeGreaterThan(-1);
    expect(at("Security Deposit"), "no Security Deposit in the allocation order").toBeGreaterThan(-1);

    // Priority 14 in payment_apply_fifo_v2, and the comment beside it says why:
    // a deposit is refundable money we hold, so it may only absorb what is left
    // after everything genuinely earned has been settled. Move it up the list
    // and a deposit refund starts handing back money that paid the rental.
    for (const earned of ["Rental", "Tax", "Service Fee", "Insurance", "Fine", "Other"]) {
      expect(
        at("Security Deposit") > at(earned),
        `Security Deposit now settles BEFORE ${earned} in apply-payment's allocation ` +
          `order. It must be last (payment_apply_fifo_v2 priority 14): a deposit is ` +
          `money we are holding, not money we have earned, so it may only absorb what ` +
          `is left over. Refunds are scoped by category and read this allocation back ` +
          `as their cap, so getting it wrong here mis-prices every later refund.`,
      ).toBe(true);
    }
  });

  it("caps a partial refund at what THIS payment put into THIS category", () => {
    const src = blankComments(readEdgeFunctionSource("process-refund"));

    // The cap is derived, not assumed: charges of this category -> the
    // applications that settled them -> the sum this one payment contributed.
    expect(src, "process-refund no longer computes a categoryCap.").toContain("categoryCap");
    expect(
      src,
      "The category cap is no longer read from payment_applications.amount_applied, " +
        "so it is no longer the FIFO allocation it is supposed to mirror.",
    ).toContain("amount_applied");

    // The clamp itself. One PaymentIntent routinely settles Rental + Tax +
    // Security Deposit at once — 224 such payments already exist — so "what
    // this PI has left" is NOT "what it put into this category". Drop
    // categoryCap out of this Math.min and a deposit refund quietly hands back
    // money that paid the rental, with no rental refund ever recorded.
    expect(
      src.replace(/\s+/g, " "),
      "process-refund no longer clamps the Stripe refund by categoryCap. A refund can " +
        "now reach across into money that settled a different category.",
    ).toContain("Math.min(refundAmount, stripeUnrefunded, categoryCap)");
  });

  it("flips a payment to Refunded only when the partials add up, and counts each one once", () => {
    const src = blankComments(readEdgeFunctionSource("process-refund"));

    // The threshold, epsilon and all. `Refunded` vs `Partial Refund` is what
    // the payments screen shows and what the refund trigger fires on.
    expect(
      src.replace(/\s+/g, " "),
      "The Refunded/Partial Refund threshold has changed shape. Without the epsilon, " +
        "float arithmetic leaves a fully-refunded payment stuck on 'Partial Refund'.",
    ).toContain("newTotalRefund + 0.0001 >= Number(pRec.amount)");
    expect(src).toContain('"Partial Refund"');
    expect(src).toContain('"Refunded"');

    // And the guard that makes "two partials summing to the charge" arrive at
    // the charge rather than at twice it. The Stripe block has already added
    // this refund to the owning payment's refund_amount; re-adding it in the
    // allocation loop is the $1.22 charge -> $2.44 refund_amount bug, which
    // flips a payment to Refunded after the FIRST partial and blocks the second.
    expect(
      src,
      "The double-count guard is gone from process-refund's payment allocation loop. " +
        "The Stripe branch and the allocation loop will both add this refund to the " +
        "same payment, so one partial refund counts twice — the payment reads as fully " +
        "refunded when half the money is still owed.",
    ).toContain("alreadyCountedByStripeBlock");
  });

  it("shrinks the ceiling by what has already been given back", () => {
    const src = blankComments(readEdgeFunctionSource("process-refund"));

    // This subtraction is the entire difference between a partial refund and a
    // full one. Without it every partial refund is refundable again, in full,
    // for ever.
    expect(
      src.replace(/\s+/g, " "),
      "process-refund no longer subtracts what has already been refunded when it works " +
        "out what is still refundable. Each partial refund would then be repeatable at " +
        "the original amount.",
    ).toContain("const availableForRefund = totalPaid - totalAlreadyRefunded");
    expect(
      src.replace(/\s+/g, " "),
      "totalAlreadyRefunded is no longer summed from this category's Refund ledger rows.",
    ).toMatch(/totalAlreadyRefunded = Math\.abs\(ledgerRefunds/);
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// ALL THREE MOVE OR ATTEMPT TO MOVE REAL MONEY, so all three sit behind the
// full ladder: D247_LIVE_TESTS=1 + D247_LIVE_ALLOW_WRITES=1 +
// D247_LIVE_ALLOW_MONEY_MOVEMENT=1 + D247_LIVE_STRIPE_MODE=test, a
// non-production Supabase project, and the fixture
// (D247_LIVE_REFUND_RENTAL_ID + D247_LIVE_PORTAL_JWT).
//
// WHAT EACH DOES IF ENABLED:
//
//   "…draws only from the category it names"
//       Refunds D247_LIVE_REFUND_AMOUNT (default 1) from the fixture category
//       at Stripe, then re-reads the balance and asserts it fell by exactly
//       that and nothing else moved.
//
//   "…that exceeds the remaining balance is refused"
//       Asks for one unit more than is available. Moves nothing while the
//       guard holds — and the guard holding is the claim under test.
//
//   "two partial refunds summing to the charge…"
//       SPENDS THE FIXTURE. It refunds the balance in two halves and then
//       asserts there is nothing left. It runs LAST in this file for that
//       reason, and it is why `refund.test.ts` — which sorts after this file —
//       reads D247_LIVE_FULL_REFUND_RENTAL_ID for a rental of its own.
//
// Each case re-reads the balance for itself, so they are order-tolerant among
// themselves and re-runnable against a fresh fixture. Against a spent one they
// SKIP with a message saying so; a drained fixture is not a code failure.
// ===========================================================================
describe("stripe/partial-payment — live (Layer 2)", () => {
  /** Balance, or a skip: there is no partial refund to test without one. */
  async function balanceOrSkip(
    ctx: { skip: (note?: string) => void },
    fixture: ReturnType<typeof resolveRefundFixture>,
    minimum: number,
  ): Promise<number | null> {
    const probe = await probeRefundableBalance(fixture);
    if (probe.state === "exhausted" || (probe.state === "known" && probe.available < minimum)) {
      ctx.skip(
        `Rental ${fixture.rentalId} has less than ${minimum} refundable in ` +
          `"${fixture.category}". These fixtures are one-shot — point ` +
          `D247_LIVE_REFUND_RENTAL_ID at a rental with settled money on it.`,
      );
      return null;
    }
    expect(
      probe.state,
      "Could not read the refundable balance out of process-refund's refusal:\n" +
        `  ${probe.status}: ${probe.raw.slice(0, 300)}\n` +
        "  FAILURE MODE (a) if the message was reworded — the parser lives in " +
        "helpers/stripe-live.ts. FAILURE MODE (b) if this is not that refusal at all.",
    ).toBe("known");
    return (probe as { available: number }).available;
  }

  it.skipIf(!liveMoneyMovementRequested())(
    "live: a partial refund draws only from the category it names, up to what that category was paid",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      const fixture = resolveRefundFixture();
      const before = await balanceOrSkip(ctx, fixture, fixture.amount);
      if (before === null) return;

      const res = await callProcessRefund(fixture, refundBody(fixture));
      expect(res.status, classifyLive(res).explain).toBe(200);
      expect(res.json?.success).toBe(true);

      const recorded = Number(res.json?.recordedAmount);
      expect(
        recorded <= fixture.amount + 0.0001,
        `process-refund recorded ${recorded} for a ${fixture.amount} refund. It must ` +
          "never record more than was asked for; the only legitimate difference is " +
          "downward, when the PaymentIntent had less headroom (shortfallWarning).",
      ).toBe(true);

      // The real assertion, and the one the categoryCap exists for: the money
      // came out of THIS category's balance and only this one.
      const after = await probeRefundableBalance(fixture);
      expect(
        after.state,
        "The balance was readable before the refund and is not readable after it:\n" +
          `  ${after.status}: ${after.raw.slice(0, 300)}\n` +
          "  The refund itself returned 200, so this is about the SECOND read — most " +
          "likely the rental moved into a state that changes which guard answers first.",
      ).not.toBe("unreadable");
      const remaining = after.state === "exhausted" ? 0 : (after as { available: number }).available;
      expect(
        round2(remaining),
        `"${fixture.category}" was ${before} refundable before and ${remaining} after a ` +
          `${recorded} refund. Expected ${round2(before - recorded)}.\n` +
          "  A LARGER drop means the refund reached past this category — check the\n" +
          "  categoryCap clamp (Layer 1 asserts it is still written down).\n" +
          "  A SMALLER drop means the ledger row does not match what Stripe moved.",
      ).toBe(round2(before - recorded));
    },
  );

  it.skipIf(!liveMoneyMovementRequested())(
    "live: a partial refund that exceeds the remaining balance is refused",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      const fixture = resolveRefundFixture();
      const available = await balanceOrSkip(ctx, fixture, 0.01);
      if (available === null) return;

      // One unit over. Deliberately close to the line rather than absurd: the
      // interesting failure is an off-by-one in the comparison, and 1,000,000
      // would pass an accidental `>=`-vs-`>` swap right along with a correct one.
      const res = await callProcessRefund(
        fixture,
        refundBody(fixture, { refundAmount: round2(available + 1) }),
      );

      expect(
        res.status,
        `process-refund accepted a refund of ${round2(available + 1)} when only ` +
          `${available} is refundable.\n` +
          "  FAILURE MODE (b), and it has already moved the money by the time you read\n" +
          "  this. The comparison is `refundAmount > availableForRefund` in\n" +
          "  supabase/functions/process-refund/index.ts.\n" +
          classifyLive(res).explain,
      ).toBe(400);
      expect(String(res.json?.error ?? res.text)).toMatch(/exceeds available refundable amount/i);
    },
  );

  // LAST IN THE FILE, deliberately — it spends the fixture down to zero.
  it.skipIf(!liveMoneyMovementRequested())(
    "live: two partial refunds summing to the charge leave the payment fully refunded",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      const fixture = resolveRefundFixture();
      // Two refunds, each of which must survive process-refund's own
      // `refundAmount <= 0` rejection, so the balance has to split in two.
      const available = await balanceOrSkip(ctx, fixture, 0.02);
      if (available === null) return;

      const first = round2(available / 2);
      const second = round2(available - first);

      const one = await callProcessRefund(fixture, refundBody(fixture, { refundAmount: first }));
      expect(one.status, `first partial (${first}) refused.\n` + classifyLive(one).explain).toBe(200);

      const two = await callProcessRefund(fixture, refundBody(fixture, { refundAmount: second }));
      expect(
        two.status,
        `The SECOND partial (${second}) was refused after the first (${first}) of ` +
          `${available} succeeded.\n` +
          "  The classic cause is double counting: the Stripe branch and the payment\n" +
          "  allocation loop both adding the same refund, so the first partial already\n" +
          "  looks like the whole thing. Layer 1 in this file asserts the guard against\n" +
          "  that is still in the source — if it passed and this failed, the guard is\n" +
          "  present but no longer working.\n" +
          classifyLive(two).explain,
      ).toBe(200);

      // Both landed, and together they were the whole balance.
      expect(one.json?.ledgerRecorded).toBe(true);
      expect(two.json?.ledgerRecorded).toBe(true);
      expect(round2(Number(one.json?.recordedAmount) + Number(two.json?.recordedAmount))).toBe(available);

      const after = await probeRefundableBalance(fixture);
      expect(
        after.state,
        `"${fixture.category}" still reports a refundable balance after ${first} + ` +
          `${second} = ${available} was refunded:\n  ${after.raw.slice(0, 300)}\n` +
          "  Money can be handed back twice from here.",
      ).toBe("exhausted");
    },
  );
});
