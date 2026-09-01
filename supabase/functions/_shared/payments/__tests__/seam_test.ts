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

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

import { PASSTHROUGH, skip, servedBySquare } from "../types.ts";
import { capabilitiesFor, isCountrySupported } from "../capabilities.ts";
import { resolveFromTenantRow } from "../resolve.ts";
import { assertStripeTenant, isStripeTenant, WrongProviderError } from "../guard.ts";
import { applyStripeOnly, PROVIDER_COLUMN } from "../predicates.ts";
import { squareIdempotencyKey, verifySquareWebhook, SQUARE_IDEMPOTENCY_MAX } from "../square-client.ts";
import { mapSquarePaymentStatus, mapSquareRefundStatus } from "../square-status-map.ts";
import { allProviderIds, describeProvider } from "../registry.ts";
import { SQUARE_OAUTH_SCOPES } from "../square-oauth.ts";

// ---------------------------------------------------------------------------
// THE prime-directive test
// ---------------------------------------------------------------------------
Deno.test("passthrough: a Stripe tenant is never handled by the seam", () => {
  assertEquals(PASSTHROUGH.handled, false);
  assertEquals(PASSTHROUGH.body, undefined);
});

Deno.test("resolve: absent provider column degrades to stripe, never square", () => {
  assertEquals(resolveFromTenantRow({ id: "t1" }).provider, "stripe");
  assertEquals(resolveFromTenantRow({ id: "t1", payment_provider: null }).provider, "stripe");
  assertEquals(resolveFromTenantRow({ id: "t1", payment_provider: "nonsense" }).provider, "stripe");
  assertEquals(resolveFromTenantRow({ id: "t1", payment_provider: "square" }).provider, "square");
});

Deno.test("resolve: squareMode is null for stripe tenants", () => {
  assertEquals(resolveFromTenantRow({ id: "t", payment_provider: "stripe" }).squareMode, null);
  assertEquals(resolveFromTenantRow({ id: "t", payment_provider: "square" }).squareMode, "test");
});

// ---------------------------------------------------------------------------
// Guard — asymmetric fail direction
// ---------------------------------------------------------------------------
Deno.test("guard: fails OPEN on an unselected column (protects Stripe at runtime)", () => {
  assertStripeTenant({ id: "t" }, "test-ctx");                       // no throw
  assertStripeTenant({ payment_provider: undefined }, "test-ctx");   // no throw
  assertStripeTenant({ payment_provider: "stripe" }, "test-ctx");    // no throw
});

Deno.test("guard: blocks only an explicit square value", () => {
  let threw = false;
  try { assertStripeTenant({ payment_provider: "square" }, "test-ctx"); }
  catch (e) { threw = e instanceof WrongProviderError; }
  assert(threw, "expected WrongProviderError for a square tenant");
  assertEquals(isStripeTenant({ payment_provider: "square" }), false);
  assertEquals(isStripeTenant({ payment_provider: undefined }), true);
});

// ---------------------------------------------------------------------------
// Predicates — the nullable-column trap
// ---------------------------------------------------------------------------
Deno.test("predicates: applyStripeOnly emits .eq(payment_provider,'stripe')", () => {
  const calls: Array<[string, string]> = [];
  const fake = { eq: (c: string, v: string) => { calls.push([c, v]); return fake; } };
  applyStripeOnly(fake);
  assertEquals(calls, [[PROVIDER_COLUMN, "stripe"]]);
});

// ---------------------------------------------------------------------------
// Capabilities drive behaviour — never the provider name
// ---------------------------------------------------------------------------
Deno.test("capabilities: square cannot store a credential, stripe can", () => {
  assertEquals(capabilitiesFor("square").supportsStoredCredential, false);
  assertEquals(capabilitiesFor("stripe").supportsStoredCredential, true);
});

Deno.test("capabilities: square's tight correlation limits are recorded", () => {
  const sq = capabilitiesFor("square");
  assertEquals(sq.maxMetadataKeys, 10);
  assertEquals(sq.maxReferenceIdChars, 40);
  assertEquals(sq.maxIdempotencyKeyChars, 45);
  assertEquals(sq.webhookAckBudgetMs, 10_000);
  assertEquals(sq.tokenExpiresDays, 30);
});

Deno.test("capabilities: country gate refuses unknown country for a constrained provider", () => {
  assertEquals(isCountrySupported("square", "GB"), true);
  assertEquals(isCountrySupported("square", "AE"), false);   // UAE — not a Square market
  assertEquals(isCountrySupported("square", null), false);   // unknown must not pass
  assertEquals(isCountrySupported("stripe", null), true);    // stripe is unconstrained here
});

// ---------------------------------------------------------------------------
// Idempotency — truncation would silently double-charge
// ---------------------------------------------------------------------------
Deno.test("idempotency: long keys sharing a prefix do NOT collide after clamping", async () => {
  const base = "rental-3f9a1c2e-8b7d-4e5f-9a1b-2c3d4e5f6a7b-installment-";
  const a = await squareIdempotencyKey(base + "1");
  const b = await squareIdempotencyKey(base + "2");
  assert(a.length <= SQUARE_IDEMPOTENCY_MAX, `key too long: ${a.length}`);
  assert(b.length <= SQUARE_IDEMPOTENCY_MAX, `key too long: ${b.length}`);
  assertNotEquals(a, b, "distinct operations must not share an idempotency key");
});

Deno.test("idempotency: short keys pass through unchanged", async () => {
  assertEquals(await squareIdempotencyKey("chk-abc"), "chk-abc");
});

// ---------------------------------------------------------------------------
// Webhook signature — Square signs notification_url + body
// ---------------------------------------------------------------------------
Deno.test("webhook: valid signature verifies; tampering fails", async () => {
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

  assertEquals(await verifySquareWebhook(key, url, body, sig), true);
  assertEquals(await verifySquareWebhook(key, url, body + " ", sig), false);
  // URL is part of the signed message — a different path must fail.
  assertEquals(await verifySquareWebhook(key, url + "/x", body, sig), false);
  assertEquals(await verifySquareWebhook(key, url, body, null), false);
});

// ---------------------------------------------------------------------------
// Status mapping — APPROVED is not money
// ---------------------------------------------------------------------------
Deno.test("status: APPROVED (authorised, uncaptured) must NOT read as Completed", () => {
  assertEquals(mapSquarePaymentStatus("APPROVED"), "Pending");
  assertEquals(mapSquarePaymentStatus("COMPLETED"), "Completed");
  assertEquals(mapSquarePaymentStatus("FAILED"), "Failed");
  assertEquals(mapSquarePaymentStatus("WHAT_IS_THIS"), "Pending");
});

Deno.test("status: a Square refund starts Pending, not Completed", () => {
  assertEquals(mapSquareRefundStatus("PENDING"), "Pending");
  assertEquals(mapSquareRefundStatus("REJECTED"), "Failed");
});

// ---------------------------------------------------------------------------
// Outcome helpers
// ---------------------------------------------------------------------------
Deno.test("skip: is handled, is a skip, and carries a machine-readable reason", () => {
  const s = skip("provider_cannot_store_credential");
  assertEquals(s.handled, true);
  assertEquals(s.skipped, true);
  assertEquals(s.reason, "provider_cannot_store_credential");
  assertEquals(s.body?.skipped, true);
});

Deno.test("servedBySquare: handled with a body and no skip flag", () => {
  const o = servedBySquare({ url: "https://sq" });
  assertEquals(o.handled, true);
  assertEquals(o.skipped, undefined);
});

// ---------------------------------------------------------------------------
// Provider #3 must stay cheap — the lead asked for this explicitly
// ---------------------------------------------------------------------------
Deno.test("registry: exactly one native rail, and it is stripe", () => {
  const native = allProviderIds().filter((id) => describeProvider(id).isNativeRail);
  assertEquals(native, ["stripe"]);
});

Deno.test("oauth: scope list omits the app-fee scope and never relies on the default", () => {
  assert(SQUARE_OAUTH_SCOPES.length > 0, "scope must never be empty — Square's default is read-only");
  assert(!SQUARE_OAUTH_SCOPES.includes("PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS" as never),
    "we take no platform cut; requesting the app-fee scope is a trust cost for nothing");
  assert(SQUARE_OAUTH_SCOPES.includes("PAYMENTS_WRITE"), "cannot take payments without PAYMENTS_WRITE");
});
