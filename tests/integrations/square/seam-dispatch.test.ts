/**
 * SQUARE SEAM — routing, guards, capabilities and dispatch.
 *
 * PORTED from seam_test.ts and dispatch_test.ts.
 * Those files hold real, well-written coverage that NO RUNNER EXECUTES:
 * supabase/functions/deno.json has compilerOptions and imports but no "tasks"
 * key, no npm script references deno, and deno is not installed on this machine.
 * Porting was chosen over installing Deno because the seam modules import and
 * run under vitest through the `@fn` alias — readEnv wraps Deno.env.get in
 * try/catch, so the ReferenceError on `Deno` is swallowed at import time.
 *
 * The originals are deliberately left in place rather than deleted: they are the
 * provenance of these assertions, and removing them would make this file look
 * like new work instead of a rescue. They remain unwired.
 *
 * Test titles were REWRITTEN to the convention in tests/README.md section 10 —
 * the Deno names were terse prefixes ("defect 3: ...") and these are harvested
 * into TEST-CATALOGUE.md, so each must read as a behaviour sentence on its own.
 */

import { describe, it, expect } from "vitest";
import { SQUARE_OAUTH_SCOPES } from "@fn/_shared/payments/square-oauth.ts";
import { allProviderIds, describeProvider } from "@fn/_shared/payments/registry.ts";
import { applyStripeOnly, PROVIDER_COLUMN } from "@fn/_shared/payments/predicates.ts";
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { tryProviderCheckout } from "@fn/_shared/payments/checkout.ts";
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

import { PASSTHROUGH, skip, servedBySquare } from "@fn/_shared/payments/types.ts";
import { assertStripeTenant, isStripeTenant, WrongProviderError } from "@fn/_shared/payments/guard.ts";
import { capabilitiesFor, isCountrySupported } from "@fn/_shared/payments/capabilities.ts";
import { mapSquarePaymentStatus, mapSquareRefundStatus } from "@fn/_shared/payments/square-status-map.ts";
import { resolveFromTenantRow } from "@fn/_shared/payments/resolve.ts";
import { squareIdempotencyKey, verifySquareWebhook, SQUARE_IDEMPOTENCY_MAX } from "@fn/_shared/payments/square-client.ts";
import { tryProviderRefund } from "@fn/_shared/payments/refund.ts";

// --- from seam_test.ts ----------------------------------------------
/**
 * Square seam — contract tests.
 *
 * Run:  deno test --allow-net supabase/functions/_shared/payments/__tests__/
 *
 * The most important test in this file is `passthrough`. "A Stripe regression is
 * unacceptable" is only a slogan until something asserts it, and the assertion is
 * that a Stripe tenant makes the seam return handled:false — meaning the caller
 * runs its original body with nothing changed.
 */
// ---------------------------------------------------------------------------
// THE prime-directive test
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Guard — asymmetric fail direction
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Predicates — the nullable-column trap
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Capabilities drive behaviour — never the provider name
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Idempotency — truncation would silently double-charge
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Webhook signature — Square signs notification_url + body
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Status mapping — APPROVED is not money
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Outcome helpers
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Provider #3 must stay cheap — the lead asked for this explicitly
// ---------------------------------------------------------------------------

// --- from dispatch_test.ts ------------------------------------------
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

describe("the checkout seam — a Stripe tenant passes straight through", () => {
  it("a Stripe tenant is never handled by the seam", () => {
  expect(PASSTHROUGH.handled).toEqual(false);
  expect(PASSTHROUGH.body).toEqual(undefined);
});

});

describe("provider resolution from the tenant row", () => {
  it("absent provider column degrades to stripe, never square", () => {
  expect(resolveFromTenantRow({ id: "t1" }).provider).toEqual("stripe");
  expect(resolveFromTenantRow({ id: "t1", payment_provider: null }).provider).toEqual("stripe");
  expect(resolveFromTenantRow({ id: "t1", payment_provider: "nonsense" }).provider).toEqual("stripe");
  expect(resolveFromTenantRow({ id: "t1", payment_provider: "square" }).provider).toEqual("square");
});

  it("squareMode is null for stripe tenants", () => {
  expect(resolveFromTenantRow({ id: "t", payment_provider: "stripe" }).squareMode).toEqual(null);
  expect(resolveFromTenantRow({ id: "t", payment_provider: "square" }).squareMode).toEqual("test");
});

});

describe("the Stripe guard — which tenants it refuses", () => {
  it("fails OPEN on an unselected column (protects Stripe at runtime)", () => {
  assertStripeTenant({ id: "t" }, "test-ctx");                       // no throw
  assertStripeTenant({ payment_provider: undefined }, "test-ctx");   // no throw
  assertStripeTenant({ payment_provider: "stripe" }, "test-ctx");    // no throw
});

  it("blocks only an explicit square value", () => {
  let threw = false;
  try { assertStripeTenant({ payment_provider: "square" }, "test-ctx"); }
  catch (e) { threw = e instanceof WrongProviderError; }
  expect(threw, "expected WrongProviderError for a square tenant").toBeTruthy();
  expect(isStripeTenant({ payment_provider: "square" })).toEqual(false);
  expect(isStripeTenant({ payment_provider: undefined })).toEqual(true);
});

});

describe("query predicates that scope a read to one provider", () => {
  it("applyStripeOnly emits .eq(payment_provider,'stripe')", () => {
  const calls: Array<[string, string]> = [];
  const fake = { eq: (c: string, v: string) => { calls.push([c, v]); return fake; } };
  applyStripeOnly(fake);
  expect(calls).toEqual([[PROVIDER_COLUMN, "stripe"]]);
});

});

describe("the capability manifest", () => {
  it("square cannot store a credential, stripe can", () => {
  expect(capabilitiesFor("square").supportsStoredCredential).toEqual(false);
  expect(capabilitiesFor("stripe").supportsStoredCredential).toEqual(true);
});

  it("square's tight correlation limits are recorded", () => {
  const sq = capabilitiesFor("square");
  expect(sq.maxMetadataKeys).toEqual(10);
  expect(sq.maxReferenceIdChars).toEqual(40);
  expect(sq.maxIdempotencyKeyChars).toEqual(45);
  expect(sq.webhookAckBudgetMs).toEqual(10_000);
  expect(sq.tokenExpiresDays).toEqual(30);
});

  it("country gate refuses unknown country for a constrained provider", () => {
  expect(isCountrySupported("square", "GB")).toEqual(true);
  expect(isCountrySupported("square", "AE")).toEqual(false);   // UAE — not a Square market
  expect(isCountrySupported("square", null)).toEqual(false);   // unknown must not pass
  expect(isCountrySupported("stripe", null)).toEqual(true);    // stripe is unconstrained here
});

});

describe("Square idempotency key derivation", () => {
  it("long keys sharing a prefix do NOT collide after clamping", async () => {
  const base = "rental-3f9a1c2e-8b7d-4e5f-9a1b-2c3d4e5f6a7b-installment-";
  const a = await squareIdempotencyKey(base + "1");
  const b = await squareIdempotencyKey(base + "2");
  expect(a.length <= SQUARE_IDEMPOTENCY_MAX, `key too long: ${a.length}`).toBeTruthy();
  expect(b.length <= SQUARE_IDEMPOTENCY_MAX, `key too long: ${b.length}`).toBeTruthy();
  expect(a, "distinct operations must not share an idempotency key").not.toEqual(b);
});

  it("short keys pass through unchanged", async () => {
  expect(await squareIdempotencyKey("chk-abc")).toEqual("chk-abc");
});

});

describe("Square webhook signature verification", () => {
  it("valid signature verifies; tampering fails", async () => {
  const key = "test-signature-key";
  const url = "https://example.supabase.co/functions/v1/square-webhook";
  const body = JSON.stringify({ type: "payment.updated", data: { id: "p1" } });

  const mac = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey("raw", new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    new TextEncoder().encode(url + body),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(mac)));

  expect(await verifySquareWebhook(key, url, body, sig)).toEqual(true);
  expect(await verifySquareWebhook(key, url, body + " ", sig)).toEqual(false);
  // URL is part of the signed message — a different path must fail.
  expect(await verifySquareWebhook(key, url + "/x", body, sig)).toEqual(false);
  expect(await verifySquareWebhook(key, url, body, null)).toEqual(false);
});

});

describe("Square status mapping", () => {
  it("aPPROVED (authorised, uncaptured) must NOT read as Completed", () => {
  expect(mapSquarePaymentStatus("APPROVED")).toEqual("Pending");
  expect(mapSquarePaymentStatus("COMPLETED")).toEqual("Completed");
  expect(mapSquarePaymentStatus("FAILED")).toEqual("Failed");
  expect(mapSquarePaymentStatus("WHAT_IS_THIS")).toEqual("Pending");
});

  it("a Square refund starts Pending, not Completed", () => {
  expect(mapSquareRefundStatus("PENDING")).toEqual("Pending");
  expect(mapSquareRefundStatus("REJECTED")).toEqual("Failed");
});

});

describe("the checkout seam — skip results", () => {
  it("is handled, is a skip, and carries a machine-readable reason", () => {
  const s = skip("provider_cannot_store_credential");
  expect(s.handled).toEqual(true);
  expect(s.skipped).toEqual(true);
  expect(s.reason).toEqual("provider_cannot_store_credential");
  expect(s.body?.skipped).toEqual(true);
});

});

describe("adapter results served by Square", () => {
  it("handled with a body and no skip flag", () => {
  const o = servedBySquare({ url: "https://sq" });
  expect(o.handled).toEqual(true);
  expect(o.skipped).toEqual(undefined);
});

});

describe("the provider registry", () => {
  it("exactly one native rail, and it is stripe", () => {
  const native = allProviderIds().filter((id) => describeProvider(id).isNativeRail);
  expect(native).toEqual(["stripe"]);
});

});

describe("Square OAuth scopes", () => {
  it("scope list omits the app-fee scope and never relies on the default", () => {
  expect(SQUARE_OAUTH_SCOPES.length > 0, "scope must never be empty — Square's default is read-only").toBeTruthy();
  expect(!SQUARE_OAUTH_SCOPES.includes("PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS" as never), "we take no platform cut; requesting the app-fee scope is a trust cost for nothing").toBeTruthy();
  expect(SQUARE_OAUTH_SCOPES.includes("PAYMENTS_WRITE"), "cannot take payments without PAYMENTS_WRITE").toBeTruthy();
});

});

describe("the checkout seam — routing and skip reasons", () => {
  it("a STRIPE tenant passes through, untouched", async () => {
  const sb = stubSupabase({ data: { id: "t1", payment_provider: "stripe" }, error: null });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  expect(out.handled, "a Stripe tenant must never be handled by the seam").toEqual(false);
  expect(out.body).toEqual(undefined);
});

  it("a tenant-read ERROR degrades to Stripe, it does not throw", async () => {
  // This is the staging 42703 case. Throwing here would break live checkouts on
  // any environment whose schema lags the code.
  const sb = stubSupabase({ data: null, error: { code: "42703", message: "column does not exist" } });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  expect(out.handled, "a read failure must fall through to the Stripe rail").toEqual(false);
});

  it("a MISSING tenant row degrades to Stripe", async () => {
  const sb = stubSupabase({ data: null, error: { code: "PGRST116", message: "no rows" } });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  expect(out.handled).toEqual(false);
});

  it("an UNKNOWN provider value degrades to Stripe, never to Square", async () => {
  const sb = stubSupabase({ data: { id: "t1", payment_provider: "paypal" }, error: null });
  const out = await tryProviderCheckout(sb, "t1", SPEC);
  expect(out.handled).toEqual(false);
});

  it("a SQUARE tenant needing a stored credential SKIPS, and does not throw", async () => {
  const sb = stubSupabase({
    data: { id: "t1", payment_provider: "square", square_mode: "test", country: "GB" },
    error: null,
  });
  const out = await tryProviderCheckout(sb, "t1", { ...SPEC, requiresStoredCredential: true });
  expect(out.handled).toEqual(true);
  expect(out.skipped).toEqual(true);
  expect(out.reason).toEqual("provider_cannot_store_credential");
  expect(!out.error, "a capability gap is a skip, never an error").toBeTruthy();
});

});

describe("the refund seam — routing", () => {
  it("a STRIPE payment record passes through regardless of tenant", async () => {
  const sb = stubSupabase({ data: { id: "t1", payment_provider: "square" }, error: null });
  const out = await tryProviderRefund(sb, "t1", {
    paymentRecord: { id: "p1", payment_provider: "stripe", stripe_payment_intent_id: "pi_1" },
  });
  expect(out.handled, "a refund must go back on the rail the CHARGE was taken on, not the tenant's current provider").toEqual(false);
});

  it("a tenant-read error FAILS rather than silently using sandbox", async () => {
  const sb = stubSupabase({ data: null, error: { code: "PGRST116", message: "no rows" } });
  const out = await tryProviderRefund(sb, "t1", {
    paymentRecord: { id: "p1", payment_provider: "square", square_payment_id: "sq1" },
  });
  expect(out.handled).toEqual(true);
  expect(out.error, "guessing test-vs-live on a refund is not acceptable").toEqual(true);
  expect(out.reason).toEqual("square_tenant_unreadable");
});

});
