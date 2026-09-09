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
// =============================================================================

import { describe, expect, it } from "vitest";
import { readEdgeFunction, readEdgeFunctionSource } from "../../helpers/edge-contract";
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

  it.todo("live: a test-mode PaymentIntent confirms and the subscription becomes active");
  it.todo("live: a declined test card leaves the subscription incomplete and charges nothing");
});
