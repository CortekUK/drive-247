// =============================================================================
// SPINE STEP 4 — PAYMENT.
//
//     paymnet --- checkout ---> {999} --- 200
//
// "yahan bhi payload se game karni padegi, kyunki yahan Stripe hai aur Stripe
//  third party hai. 99 upar se jo saari cheezein aa rahi thi wo Stripe ke
//  checkout wale payload mein chali gayi hai. humne Stripe API call ki hai aur
//  apna koi TEST CARD de diya hai. uska result bhi 200 aana chahiye — magar 200
//  nahi aayega to HUM YAHAN PAR ROK DENGE."
//
// The interesting assertion here is NOT "did Stripe say 200". It is the arrow
// on the whiteboard: the 99 seeded at step 1 has to be the number that ends up
// in the Stripe payload. Drive247 resolves that server-side and the amount
// never crosses the wire inbound, which is the property worth pinning:
//
//   PaymentIntentRequest is `{ planId }` and nothing else.
//
// If someone ever adds `amountCents` (or `priceUsd`, or `total`) to that
// interface as a convenience, the browser starts telling the server what to
// charge. That is a one-line change, it looks harmless in review, and it is a
// price-tampering hole. This test fails on it.
//
// Layer 2 stops at "the endpoint is up and its auth gate holds". Getting a real
// 200 out of signup-payment-intent means creating a Stripe Customer and an
// incomplete Subscription against a live Stripe account — a third-party write
// with no cheap undo — so the harness deliberately does not do it unattended.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  assertContract,
  readEdgeFunction,
  readEdgeFunctionSource,
  type PayloadContract,
} from "../../helpers/edge-contract";
import { chain, guarded, guardedAsync, haltIfBroken } from "../../helpers/chain";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";

const STEP = "04-payment" as const;

/**
 * Stripe's universal test card. Declared here because the whiteboard says the
 * payment step supplies one — but note where it is NOT used: this flow uses the
 * inline Payment Element, so the card number is entered into a Stripe-hosted
 * iframe in the browser and never reaches any Drive247 payload. Confirming it
 * would need the browser automation the team lead ruled out.
 */
export const STRIPE_TEST_CARD = {
  number: "4242424242424242",
  expMonth: 12,
  expYear: 2034,
  cvc: "123",
} as const;

/**
 * From apps/web/src/components/onboarding/onboarding-provider.tsx:
 *   signupPaymentIntent({ planId })
 */
const CONTRACT: PayloadContract = {
  step: STEP,
  fn: "signup-payment-intent",
  builtIn: "apps/web/src/components/onboarding/onboarding-provider.tsx",
  payload: { planId: "starter" },
};

describe("04 — payment: the signup-payment-intent contract (Layer 1)", () => {
  it("sends exactly the fields signup-payment-intent reads", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const plan = chain.seeded<{ id: string }>("plan");
      const shape = assertContract({ ...CONTRACT, payload: { planId: plan.id } });
      expect(shape.fields).toEqual(["planId"]);
    });
  });

  it("never lets the browser name the price", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const shape = readEdgeFunction("signup-payment-intent");
      const priceish = shape.fields.filter((f) =>
        /amount|price|cents|total|usd|currency|discount|coupon/i.test(f),
      );
      expect(
        priceish,
        "\nsignup-payment-intent has started reading a money field off the request body:\n" +
          priceish.map((f) => `  - ${f}`).join("\n") +
          "\n\n  The amount charged must be resolved server-side from `planId` alone.\n" +
          "  _shared/signup-plans.ts, its own header: \"The client sends a `planId` and\n" +
          "  nothing else; price never crosses the wire inbound.\"\n" +
          "  A price the browser supplies is a price the browser can change.\n",
      ).toEqual([]);
    });
  });

  it("charges the amount seeded at step 01 — the 99 reaches the Stripe payload", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const plan = chain.seeded<{ id: string; amountCents: number; currency: string }>("plan");
      const src = readEdgeFunctionSource("signup-payment-intent");

      // The path from planId to money, asserted as it is actually written:
      // fetchSignupPlan reads `signup_plans` (falling back to the hardcoded
      // catalogue), and the resolved plan — not the request — is what feeds
      // Stripe. `plan.amountCents` appearing in the Stripe call is the arrow
      // the team lead drew from "99" down into the checkout payload.
      expect(
        src,
        "signup-payment-intent no longer resolves the plan through fetchSignupPlan(). " +
          "If it went back to the hardcoded catalogue, a super admin's price change in " +
          "the admin UI would stop reaching the charge.",
      ).toContain("fetchSignupPlan(");
      expect(
        src,
        "signup-payment-intent no longer derives the Stripe amount from the resolved " +
          "plan's amountCents.",
      ).toMatch(/plan\.amountCents/);

      // And the seeded value is a real, chargeable amount at the far end:
      // Stripe rejects anything under 50 cents outright.
      expect(plan.amountCents).toBeGreaterThanOrEqual(50);
      expect(plan.currency).toBe("usd");
    });
  });

  it("declares a Stripe TEST card, never a live one", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      // Cheap, but it is the assertion that stops a real PAN being pasted into
      // a test fixture and committed. 4242… is Stripe's published test number
      // and is declined by every live account.
      expect(STRIPE_TEST_CARD.number).toBe("4242424242424242");
      expect(STRIPE_TEST_CARD.number.startsWith("4242")).toBe(true);

      chain.pass(STEP);
    });
  });
});

describe("04 — payment: live status (Layer 2)", () => {
  it("signup-payment-intent is deployed and its auth gate holds", async (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    // `liveStatus()` inside the guard: the production refusal is a throw, and a
    // refusal at step N must stop the chain like any other failure. Outside the
    // guard it would be re-raised identically at every later step instead.
    const status = guarded(STEP, liveStatus);
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }

    await guardedAsync(STEP, async () => {
      // Anon key only. The 401 is returned before the function touches Stripe,
      // so this probe creates no Customer and no Subscription. Reaching a real
      // 200 here would mean a live third-party write; see the header.
      const res = await liveCall(
        "signup-payment-intent",
        { planId: chain.seeded<{ id: string }>("plan").id },
        { token: status.target.anonKey },
      );

      expect(
        res.status,
        "Expected 401 UNAUTHENTICATED from signup-payment-intent with no user session.\n" +
          classifyLive(res).explain,
      ).toBe(401);
      expect(res.json?.code).toBe("UNAUTHENTICATED");
    });
  });
});
