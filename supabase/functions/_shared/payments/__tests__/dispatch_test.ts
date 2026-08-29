/**
 * Dispatch contract tests.
 *
 * WHY THESE EXIST: the original suite asserted the passthrough contract only
 * against the frozen PASSTHROUGH constant, never by invoking tryProviderCheckout
 * or tryProviderRefund. That left the real Stripe-regression vector untested —
 * and it was live: resolvePaymentProvider used to THROW on a read error, so on a
 * schema-lagging environment (staging returns 42703 for these columns today)
 * every checkout would have thrown instead of falling through to its untouched
 * Stripe body.
 */

import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { tryProviderCheckout } from "../checkout.ts";
import { tryProviderRefund } from "../refund.ts";

/** Minimal PostgREST-shaped stub. */
// deno-lint-ignore no-explicit-any
function stubSupabase(result: { data?: unknown; error?: unknown }): any {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(result),
  };
  return { from: () => chain, rpc: () => Promise.resolve({ data: null, error: { message: "no rpc" } }) };
}

const SPEC = {
  amountCents: 5000,
  currency: "GBP",
  description: "test",
  reference: { paymentId: "pay-1" },
};

Deno.test("checkout: a STRIPE tenant passes through, untouched", async () => {
  const sb = stubSupabase({ data: { id: "t1", payment_provider: "stripe" }, error: null });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  assertEquals(out.handled, false, "a Stripe tenant must never be handled by the seam");
  assertEquals(out.body, undefined);
});

Deno.test("checkout: a tenant-read ERROR degrades to Stripe, it does not throw", async () => {
  // This is the staging 42703 case. Throwing here would break live checkouts on
  // any environment whose schema lags the code.
  const sb = stubSupabase({ data: null, error: { code: "42703", message: "column does not exist" } });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  assertEquals(out.handled, false, "a read failure must fall through to the Stripe rail");
});

Deno.test("checkout: a MISSING tenant row degrades to Stripe", async () => {
  const sb = stubSupabase({ data: null, error: { code: "PGRST116", message: "no rows" } });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  assertEquals(out.handled, false);
});

Deno.test("checkout: an UNKNOWN provider value degrades to Stripe, never to Square", async () => {
  const sb = stubSupabase({ data: { id: "t1", payment_provider: "paypal" }, error: null });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  assertEquals(out.handled, false);
});

Deno.test("checkout: a SQUARE tenant needing a stored credential SKIPS, and does not throw", async () => {
  const sb = stubSupabase({
    data: { id: "t1", payment_provider: "square", square_mode: "test", country: "GB" },
    error: null,
  });
  const out = await tryProviderCheckout(sb, "t1", { ...SPEC, requiresStoredCredential: true });
  assertEquals(out.handled, true);
  assertEquals(out.skipped, true);
  assertEquals(out.reason, "provider_cannot_store_credential");
  assert(!out.error, "a capability gap is a skip, never an error");
});

Deno.test("refund: a STRIPE payment record passes through regardless of tenant", async () => {
  const sb = stubSupabase({ data: { id: "t1", payment_provider: "square" }, error: null });
  const out = await tryProviderRefund(sb, "t1", {
    paymentRecord: { id: "p1", payment_provider: "stripe", stripe_payment_intent_id: "pi_1" },
  });
  assertEquals(out.handled, false,
    "a refund must go back on the rail the CHARGE was taken on, not the tenant's current provider");
});

Deno.test("refund: a tenant-read error FAILS rather than silently using sandbox", async () => {
  const sb = stubSupabase({ data: null, error: { code: "PGRST116", message: "no rows" } });
  const out = await tryProviderRefund(sb, "t1", {
    paymentRecord: { id: "p1", payment_provider: "square", square_payment_id: "sq1" },
  });
  assertEquals(out.handled, true);
  assertEquals(out.error, true, "guessing test-vs-live on a refund is not acceptable");
  assertEquals(out.reason, "square_tenant_unreadable");
});
