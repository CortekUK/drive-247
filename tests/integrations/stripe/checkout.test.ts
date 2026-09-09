// =============================================================================
// integrations/stripe — CHECKOUT.
//
// The first ring around the spine. Onboarding is where Stripe first touches the
// platform, so this file is the overlap between the two: it asserts the money
// half of the signup that tests/spine/onboarding/04-payment.test.ts asserts the
// payload half of.
//
// SCOPE: onboarding checkout only. "yeh automatic test sirf abhi sirf yeh
// ONBOARDING FLOW tak hi honge." The rest of the payments surface — booking
// checkouts, pre-auths, installments, Connect — belongs in this folder later,
// not now.
//
// TWO LAYERS, the same as the spine:
//
//   LAYER 1  everything down to the end of the first describe. Source-derived,
//            no network, runs on every `npm run test:spine`.
//   LAYER 2  the second describe. Skipped unless D247_LIVE_TESTS=1 AND
//            D247_LIVE_ALLOW_WRITES=1 AND D247_LIVE_ALLOW_MONEY_MOVEMENT=1 AND
//            D247_LIVE_STRIPE_MODE=test, on a non-production project. What each
//            case does when it IS enabled is spelled out above that describe —
//            one of them charges a card.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunction, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveMoneyGate, liveMoneyMovementRequested } from "../../helpers/live-call";
import {
  assertStripeTestPublishableKey,
  signupSessionJwt,
  stripeConfirmPaymentIntent,
  stripeCreateTestPaymentMethod,
  STRIPE_TEST_CARDS,
} from "../../helpers/stripe-live";
import { SIGNUP_PLANS as SERVER_PLANS } from "@fn/_shared/signup-plans.ts";

describe("stripe/checkout — the signup subscription", () => {
  it("resolves the amount from the plan, never from the request", () => {
    // The same property step 04 pins, asserted from the Stripe side: the
    // request carries an identifier, and the money is looked up behind it.
    const shape = readEdgeFunction("signup-payment-intent");
    expect(shape.fields).toEqual(["planId"]);
  });

  it("bills in the currency and interval the plan card advertised", () => {
    for (const [id, plan] of Object.entries(SERVER_PLANS)) {
      expect(plan.currency, `plan ${id}`).toBe("usd");
      expect(plan.interval, `plan ${id}`).toBe("month");
      // Stripe rejects a subscription line under 50 cents. A plan that cannot
      // be charged is a signup that dies at the card step with a Stripe error
      // the operator cannot act on.
      expect(plan.amountCents, `plan ${id}`).toBeGreaterThanOrEqual(50);
    }
  });

  it("creates the subscription as default_incomplete so nothing is charged before the card is confirmed", () => {
    const src = readEdgeFunctionSource("signup-payment-intent");
    // The inline Payment Element flow depends on this: Stripe must create the
    // subscription in `incomplete` and hand back a client secret, rather than
    // attempting a charge server-side against a payment method that does not
    // exist yet.
    expect(src).toContain("default_incomplete");
    expect(src).toContain("latest_invoice.payment_intent");
  });

  it("does not put a tenant_id on the Stripe objects — the tenant does not exist yet", () => {
    // From the function's own header, and it is load-bearing:
    //   "A tenant_id pointing at a row that does not exist would make
    //    handleSubscriptionUpdated ... hit FK violation 23503 ... Stripe then
    //    retries for ~3 days, and sustained 5xx can make Stripe auto-disable
    //    the endpoint, killing subscription event delivery for EVERY tenant."
    //
    // One well-meaning line in this function can take platform billing down for
    // all 32 paying operators, so it gets a test even though nothing here calls
    // Stripe.
    const src = readEdgeFunctionSource("signup-payment-intent");
    const metadataWrites = [...src.matchAll(/metadata:\s*\{([\s\S]{0,400}?)\}/g)]
      // Comments stripped first — the blocks carry a literal
      // `// NO tenant_id — see the header comment.` marker, which is the
      // opposite of the thing being looked for.
      .map((m) => m[1].replace(/\/\/[^\n]*/g, ""));
    expect(metadataWrites.length, "no Stripe metadata block found at all").toBeGreaterThan(0);
    for (const block of metadataWrites) {
      expect(
        /tenant_id/.test(block),
        "signup-payment-intent now stamps `tenant_id` into Stripe metadata. The tenant " +
          "does not exist at this point in the flow; subscription-webhook will hit an FK " +
          "violation, 5xx back at Stripe, and Stripe can auto-disable the endpoint for " +
          "every tenant on the platform. See the function's header comment.",
      ).toBe(false);
    }
  });

  // ==========================================================================
  // The two properties the Layer 2 cases below stand on. Both are asserted from
  // source, so they hold on every run — including the default, offline one.
  // ==========================================================================

  it("hands the browser everything a card confirmation needs, and nothing more", () => {
    // Comments blanked: this function's header discusses `clientSecret` and the
    // metadata trap at length, and a key that survives only in prose is a key
    // the browser never receives.
    const src = blankComments(readEdgeFunctionSource("signup-payment-intent"));

    // The confirm handshake is exactly three values: the secret that names the
    // PaymentIntent, the publishable key that is allowed to confirm it, and the
    // subscription id to check afterwards. If any one of them stops being
    // returned, the card step goes dead in the browser in a way that looks like
    // a rendering bug, and the live case below cannot run at all.
    for (const key of ["clientSecret", "publishableKey", "stripeSubscriptionId"]) {
      expect(
        src,
        `signup-payment-intent no longer returns \`${key}\`. The Payment Element ` +
          `needs all three to confirm in place; without one the card area mounts empty.`,
      ).toContain(key);
    }

    // Card only. Its own comment calls this load-bearing: card is the only
    // method whose 3DS challenge renders inside Stripe's iframe, so anything
    // redirect-based bounces the user out of the signup dialog — and would also
    // put the live case below on a path a publishable key cannot complete.
    expect(
      src.replace(/\s+/g, " "),
      "signup-payment-intent no longer pins payment_method_types to card.",
    ).toContain('payment_method_types: ["card"]');
  });

  it("reuses an incomplete subscription instead of spawning one per declined card", () => {
    const src = blankComments(readEdgeFunctionSource("signup-payment-intent"));

    // This is what makes "a decline charges nothing and leaves the subscription
    // incomplete" true rather than merely usually true. A customer whose card
    // is declined retries — often several times — and each retry re-enters this
    // endpoint. Without the reuse branch every retry creates another
    // subscription against the same Stripe Customer, and `tenant_subscriptions`
    // has a partial unique index on tenant_id that one of them will later lose
    // to, stranding a paying operator with no usable subscription row.
    expect(src).toContain("PAID_STATUSES");
    expect(src).toContain("DEAD_STATUSES");
    expect(
      src.replace(/\s+/g, " "),
      "signup-payment-intent no longer reuses an existing `incomplete` subscription. " +
        "Every declined-card retry now creates a new one.",
    ).toContain('existing.status === "incomplete"');
  });
});

// ===========================================================================
// LAYER 2 — the money cases.
//
// WHAT THESE DO IF ENABLED, stated plainly because one of them charges a card:
//
//   "a declined test card…"  Creates a real Stripe Customer and a real
//                            `incomplete` Subscription on the target account,
//                            tokenises 4000 0000 0000 0002, and attempts the
//                            first invoice's PaymentIntent. Stripe DECLINES it,
//                            so no money moves — but the Customer and the
//                            Subscription are permanent, and the signup session
//                            named by D247_LIVE_SESSION_JWT is consumed.
//
//   "a test-mode PaymentIntent confirms…"  The same, then tokenises
//                            4242 4242 4242 4242 and CONFIRMS. In Stripe test
//                            mode this settles test money and the subscription
//                            goes `active`. Against a live-mode account it
//                            would be a real charge on a real card — which is
//                            why the publishable key the function hands back is
//                            checked for `pk_test_` before anything is
//                            confirmed, and why the run must have declared
//                            D247_LIVE_STRIPE_MODE=test to get this far.
//
// ORDER IS DELIBERATE: the decline runs FIRST. Both cases share one signup
// session, a successful payment latches it to `paid` for ever, and after that
// the endpoint correctly refuses to hand out another client secret — so a
// decline case scheduled after a success has nothing left to decline.
// ===========================================================================
describe("stripe/checkout — live (Layer 2)", () => {
  const PLAN_ID = "starter";

  /**
   * Open the card step: a client secret, a publishable key, and the guarantee
   * that the key is a TEST key. Returns null (with the test skipped) when this
   * signup session has already paid — these fixtures are one-shot.
   */
  async function openCardStep(ctx: { skip: (note?: string) => void }) {
    const jwt = signupSessionJwt();
    if (!jwt) {
      throw new Error(
        "D247_LIVE_ALLOW_MONEY_MOVEMENT=1 but D247_LIVE_SESSION_JWT is not set.\n" +
          "  The checkout cases pay for a half-finished signup, so they need that\n" +
          "  signup's access token. It is not the same token as D247_LIVE_PORTAL_JWT,\n" +
          "  which the refund cases use.",
      );
    }

    const res = await liveCall("signup-payment-intent", { planId: PLAN_ID }, { token: jwt });
    expect(
      res.status,
      "signup-payment-intent refused to open the card step.\n" + classifyLive(res).explain,
    ).toBe(200);

    if (res.json?.alreadyPaid === true) {
      ctx.skip(
        "This signup session has already paid — D247_LIVE_SESSION_JWT is one-shot. " +
          "Run the spine's signup-begin write case against a fresh email to mint another.",
      );
      return null;
    }

    const clientSecret = res.json?.clientSecret;
    expect(
      typeof clientSecret,
      "signup-payment-intent returned 200 with no clientSecret. Its own guard turns " +
        "that into a 502 STRIPE_UNAVAILABLE, so a 200 without one means the response " +
        "shape changed — failure mode (a).",
    ).toBe("string");

    // The one check in this suite that observes Stripe's real mode instead of
    // trusting the operator's declaration. Throws before any confirm.
    assertStripeTestPublishableKey(res.json?.publishableKey);

    return {
      jwt,
      clientSecret: clientSecret as string,
      publishableKey: res.json.publishableKey as string,
      subscriptionId: res.json?.stripeSubscriptionId as string,
    };
  }

  it.skipIf(!liveMoneyMovementRequested())(
    "live: a declined test card leaves the subscription incomplete and charges nothing",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }

      const step = await openCardStep(ctx);
      if (!step) return;

      const pm = await stripeCreateTestPaymentMethod(
        step.publishableKey,
        STRIPE_TEST_CARDS.genericDecline,
      );
      expect(
        pm.status,
        `Stripe would not tokenise the declining test card.\n  ${pm.text.slice(0, 300)}\n` +
          "  This is Stripe refusing our request, not Drive247 code — check the key.",
      ).toBe(200);

      const confirm = await stripeConfirmPaymentIntent(
        step.publishableKey,
        step.clientSecret,
        pm.json.id,
      );

      // 402 is Stripe's decline. Anything else means the card that is supposed
      // to be refused was not refused, and the "charges nothing" half of this
      // case has not been demonstrated.
      expect(
        confirm.status,
        "Expected Stripe to decline 4000 0000 0000 0002 with 402.\n" +
          `  got ${confirm.status}: ${confirm.text.slice(0, 300)}`,
      ).toBe(402);
      expect(confirm.json?.error?.code).toBe("card_declined");

      // And the state Drive247 is left in: the SAME subscription, still
      // unpaid, still offering a secret to retry with. That is the property an
      // operator experiences as "my card was refused, let me try another one".
      const after = await liveCall("signup-payment-intent", { planId: PLAN_ID }, { token: step.jwt });
      expect(after.status, classifyLive(after).explain).toBe(200);
      expect(
        after.json?.alreadyPaid,
        "signup-payment-intent reports this signup as PAID after a declined card. " +
          "FAILURE MODE (b), and the expensive kind: provisioning is gated on this " +
          "flag, so a tenant would be created for money that never arrived.",
      ).toBe(false);
      expect(
        after.json?.stripeSubscriptionId,
        "A declined card produced a SECOND subscription instead of reusing the " +
          "incomplete one. See the Layer 1 case above — the partial unique index on " +
          "tenant_subscriptions will later strand one of them.",
      ).toBe(step.subscriptionId);
      expect(typeof after.json?.clientSecret).toBe("string");
    },
  );

  it.skipIf(!liveMoneyMovementRequested())(
    "live: a test-mode PaymentIntent confirms and the subscription becomes active",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }

      const step = await openCardStep(ctx);
      if (!step) return;

      const pm = await stripeCreateTestPaymentMethod(step.publishableKey, STRIPE_TEST_CARDS.visa);
      expect(pm.status, `Stripe would not tokenise 4242…: ${pm.text.slice(0, 300)}`).toBe(200);

      const confirm = await stripeConfirmPaymentIntent(
        step.publishableKey,
        step.clientSecret,
        pm.json.id,
      );
      expect(
        confirm.status,
        "Stripe would not confirm the first invoice's PaymentIntent.\n" +
          `  ${confirm.status}: ${confirm.text.slice(0, 400)}\n` +
          "  A 402 here with 4242 means the account is not in test mode after all.",
      ).toBe(200);
      expect(
        confirm.json?.status,
        "The PaymentIntent confirmed without reaching `succeeded`. `requires_action` " +
          "means the account forces 3DS on this card, which needs a browser — not a " +
          "Drive247 fault, but this case cannot prove anything past it.",
      ).toBe("succeeded");

      // Stripe flips the subscription to `active` when the first invoice is
      // paid, and does it a beat after the PaymentIntent settles. Asked through
      // OUR endpoint rather than Stripe's API on purpose: `alreadyPaid` is the
      // value signup-provision actually gates on, so this asserts the thing the
      // product depends on rather than a fact about Stripe.
      let paid = false;
      let last: any = null;
      for (let attempt = 0; attempt < 6 && !paid; attempt += 1) {
        if (attempt) await new Promise((r) => setTimeout(r, 1_500));
        last = await liveCall("signup-payment-intent", { planId: PLAN_ID }, { token: step.jwt });
        paid = last.json?.alreadyPaid === true;
      }

      expect(
        paid,
        "The card was charged but signup-payment-intent still reports this signup as " +
          "unpaid after ~9s.\n" +
          `  last response: ${String(last?.text).slice(0, 400)}\n` +
          "  FAILURE MODE (b). The customer has paid and cannot proceed — the status " +
          "read (PAID_STATUSES vs the subscription's real status) is the place to look.",
      ).toBe(true);
      expect(last.json?.clientSecret, "A paid signup must not be offered another card form.").toBeNull();
    },
  );
});
