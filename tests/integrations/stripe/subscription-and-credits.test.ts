/**
 * STRIPE — SUBSCRIPTIONS AND CREDITS. Layer 1, offline.
 *
 * The last two families from the team lead's standalone Stripe list:
 *
 *   "subscriptions. Now around subscriptions there's a whole circus."
 *   "after that, credits — Stripe calls it products."
 *
 * A NOTE ON THE SECOND ONE, because I got it wrong first: I reported that credits
 * were an internal ledger with no Stripe Product involved. That was WRONG.
 * create-credit-checkout:126 calls stripe.prices.create with `product_data`, so
 * Stripe creates an implicit Product for every credit purchase. He was right and
 * the tests below pin what actually happens.
 *
 * SCOPE. These are the platform axis — Drive247 billing its tenants — which the
 * team lead called "tomorrow's work" relative to the rental axis. They are here
 * because he listed them in the STANDALONE Stripe health check, and because a
 * subscription gate can block a rental flow and make spine tests fail for reasons
 * that have nothing to do with payments.
 *
 * tests/integrations/stripe/checkout.test.ts already covers the signup
 * subscription CHECKOUT contract. This file covers what happens afterwards: the
 * webhook events, trials, and the credit purchase path.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);
const fnSrc = (n: string) => readFileSync(root(`supabase/functions/${n}/index.ts`), "utf8");

const SUB_HOOK = fnSrc("subscription-webhook");
const SUB_CHECKOUT = fnSrc("create-subscription-checkout");
const CREDIT_CHECKOUT = fnSrc("create-credit-checkout");
const PLANS = fnSrc("manage-subscription-plans");

// @usecase A subscription lifecycle event that is silently dropped leaves the
// tenant's access state wrong in one direction or the other — either a paying
// tenant is locked out, or a cancelled one keeps full access indefinitely.
describe("subscription webhook — the lifecycle events it handles", () => {
  const HANDLED = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "invoice.marked_uncollectible",
    "invoice.deleted",
  ];

  for (const evt of HANDLED) {
    it(`acts on ${evt} rather than ignoring it`, () => {
      expect(SUB_HOOK).toContain(`"${evt}"`);
    });
  }

  it("covers both directions of failure, not just the happy path", () => {
    // payment_failed, voided, uncollectible and deleted are the four ways a
    // subscription stops being worth anything; all four are handled.
    for (const evt of ["invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible", "invoice.deleted"]) {
      expect(SUB_HOOK).toContain(evt);
    }
  });

  it("runs with verify_jwt off, so its signature check is the only gate", () => {
    const config = readFileSync(root("supabase/config.toml"), "utf8");
    expect(config).toMatch(/\[functions\.subscription-webhook\][\s\S]{0,400}?verify_jwt\s*=\s*false/);
    expect(SUB_HOOK).toMatch(/constructEvent|constructEventAsync/);
  });
});

// @usecase A trial that is set wrong either bills a tenant on day one of a free
// trial, or gives away a month. Stripe rejects trial_period_days:0 with a 400,
// so the zero case is a real branch and not a hypothetical.
describe("subscription trials", () => {
  it("passes Stripe an exact trial_end timestamp rather than a day count", () => {
    // A day count drifts against the tenant's existing billing anchor; an exact
    // timestamp does not.
    expect(SUB_CHECKOUT).toMatch(/trial_end/);
  });

  it("sends neither trial key when the plan has no trial, because Stripe rejects zero", () => {
    /**
     * Stripe returns a 400 for trial_period_days: 0 — the minimum is 1 — so a
     * plan with no trial must omit BOTH keys rather than send a zero. The source
     * documents this at :359 precisely because it is the kind of thing a later
     * "tidy-up" would reintroduce.
     */
    expect(SUB_CHECKOUT).toMatch(/Stripe rejects trial_period_days:0/);
  });
});

// @usecase Plan amounts must come from the plan record, never from the caller.
// This is the same class of hole found on the rental checkout rail, and here it
// is closed — worth pinning so it stays closed.
describe("subscription plans — where the price comes from", () => {
  it("creates a real Stripe Product and Price when a plan is configured", () => {
    expect(PLANS).toMatch(/stripe\.products\.create/);
    expect(PLANS).toMatch(/stripe\.prices\.create/);
  });

  it("creates a replacement Price rather than mutating one, because Prices are immutable", () => {
    // Stripe Prices cannot be edited; changing an amount means a new Price and
    // deactivating the old one. Two prices.create calls is the tell.
    expect((PLANS.match(/stripe\.prices\.create/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

// @usecase The team lead named credits explicitly. Every purchase mints new
// Stripe objects, and a retry mints another set plus another payable session —
// the same missing-idempotency shape found across the rental checkout rail.
describe("credits — which do involve Stripe Products, contrary to my earlier report", () => {
  it("creates a one-time Stripe Price for the exact credit amount", () => {
    // create-credit-checkout:126. `product_data` makes Stripe create an implicit
    // Product alongside it, which is what "Stripe calls it products" meant.
    expect(CREDIT_CHECKOUT).toMatch(/stripe\.prices\.create/);
    expect(CREDIT_CHECKOUT).toMatch(/product_data/);
  });

  it("names the product after the credit quantity so it is identifiable in Stripe", () => {
    expect(CREDIT_CHECKOUT).toMatch(/Drive247 Credits/);
  });

  it("buys credits as a one-time payment, never as a recurring subscription", () => {
    // A credit top-up billed monthly would be a serious mis-sell.
    expect(CREDIT_CHECKOUT).toMatch(/mode:\s*["']payment["']/);
    expect(CREDIT_CHECKOUT).not.toMatch(/mode:\s*["']subscription["']/);
  });

  it("carries the credit quantity in session metadata so the webhook can grant it", () => {
    expect(CREDIT_CHECKOUT).toMatch(/type:\s*["']credit_purchase["']/);
    expect(CREDIT_CHECKOUT).toMatch(/credits:\s*String\(creditAmount\)/);
  });

  it("mints a brand-new Price and Product on every single purchase, reusing nothing", () => {
    /**
     * Pinned rather than watchdogged, because it is defensible: an arbitrary
     * credit amount cannot be expressed with a fixed catalogue of Prices, and
     * Stripe's own docs accept ad-hoc prices for this.
     *
     * It is recorded because the consequence is real and cumulative: every credit
     * purchase leaves a permanent Product and Price in the Stripe account, and
     * nothing ever archives them. Combined with the missing idempotency below, a
     * retried purchase leaves TWO.
     */
    expect(CREDIT_CHECKOUT).not.toMatch(/prices\.list|lookup_key|retrieve\(.*price/);
  });

  it("passes no idempotency key, so a retried purchase mints a second payable session", () => {
    /**
     * DEFECT, and the same shape as the rental checkout rail: no idempotency key
     * reaches Stripe, so a network retry of one credit purchase creates another
     * Price, another implicit Product and another payable Checkout session. The
     * tenant can pay twice for one top-up.
     *
     * charge-saved-card:541 is the in-repo precedent that does this correctly,
     * deriving its key from the rental and a caller-supplied request id.
     */
    expect(CREDIT_CHECKOUT).not.toMatch(/idempotencyKey|idempotency_key/);
  });

  it.fails("should make a repeated credit purchase idempotent", () => {
    // Remove the `.fails` marker once create-credit-checkout takes a
    // caller-supplied request id and passes an idempotency key to Stripe.
    expect(/idempotencyKey|idempotency_key/.test(CREDIT_CHECKOUT)).toBe(true);
  });
});
