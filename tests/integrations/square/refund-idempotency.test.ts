/**
 * SQUARE — refund idempotency, the provider seam's fail-safe direction, and the
 * capability binding rule. Layer 3 (executable) plus Layer 1 (source contract).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS WHEN 159 SQUARE TESTS ALREADY PASS
 *
 * apps/portal/src/__tests__/lib/ holds six Square files — 159 passing cases
 * (square-edge-cases 44, square-provider-routing 56, square-payment-correlation
 * 19, square-refund-safety 17, square-idempotency 13, square-checkout-retry 10).
 * They are valuable and this file does not duplicate them. Two differences:
 *
 *  1. They run under the PORTAL's vitest project, so `npm run test:spine` — the
 *     command the team lead will actually run — does not execute a single one.
 *  2. They are source-grep tests: they read module text and assert on it, and
 *     never import the modules. So they can prove a line EXISTS; they cannot
 *     prove what the arithmetic DOES.
 *
 * This file imports the shipped seam through the `@fn` alias and RUNS it. That
 * was not obvious: these are Deno modules. It works because readEnv wraps
 * Deno.env.get in try/catch, so the ReferenceError on `Deno` is swallowed at
 * import time. Verified by probe before this file was written.
 * ---------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { squareIdempotencyKey } from "@fn/_shared/payments/square-client.ts";
import { majorToMinorUnits } from "@fn/_shared/payments/square-adapter.ts";
import { resolveFromTenantRow, TENANT_PROVIDER_COLUMNS } from "@fn/_shared/payments/resolve.ts";
import { isStripeTenant, assertStripeTenant } from "@fn/_shared/payments/guard.ts";
import {
  capabilitiesFor,
  STRIPE_CAPABILITIES,
  SQUARE_CAPABILITIES,
} from "@fn/_shared/payments/capabilities.ts";

const fn = (p: string) => resolvePath(__dirname, "../../../supabase/functions", p);
const REFUND_SEAM = readFileSync(fn("_shared/payments/refund.ts"), "utf8");
const SQUARE_ADAPTER = readFileSync(fn("_shared/payments/square-adapter.ts"), "utf8");

/**
 * The adapter's own key derivation, square-adapter.ts:982-988, reproduced here so
 * the two branches can be compared directly:
 *
 *   refundIdentity = refund_row_id ?? `${id ?? "norow"}-after${priorRefundedMinor}`
 *   key            = squareIdempotencyKey(`rfnd-${paymentId}-${refundIdentity}-${amount}`)
 */
const keyFor = (paymentId: string, refundIdentity: string, amountMinor: number) =>
  squareIdempotencyKey(`rfnd-${paymentId}-${refundIdentity}-${amountMinor}`);

// @usecase A retried refund that mints a fresh idempotency key sends real
// money out twice. The adapter was built to prevent exactly this and a per-
// attempt random id defeats it.
describe("square refunds — the retry-dedup seed the adapter was built around", () => {
  it("gives the same idempotency key to a retry of the same refund, when seeded by prior-refunded", async () => {
    /**
     * This is the design the adapter documents at :965-980. Seeding the key on
     * how much has ALREADY been refunded means:
     *   1st refund of 10.00, nothing banked -> seed "…-after0"    -> proceeds
     *   a retry of it, still nothing banked  -> seed "…-after0"    -> DE-DUPES
     *   a genuine 2nd 10.00, 10.00 banked    -> seed "…-after1000" -> proceeds
     * Proven by running the real key function, not by reading the comment.
     */
    const a = await keyFor("sqpay_1", "row_9-after0", 1000);
    const b = await keyFor("sqpay_1", "row_9-after0", 1000);
    expect(a).toBe(b);
  });

  it("gives a different key to a genuine second refund once the first has banked", async () => {
    const first = await keyFor("sqpay_1", "row_9-after0", 1000);
    const second = await keyFor("sqpay_1", "row_9-after1000", 1000);
    expect(second).not.toBe(first);
  });

  it("gives a DIFFERENT key to a retry once a random per-attempt id is used instead", async () => {
    /**
     * DEFECT — the mechanism, run rather than argued.
     *
     * refund.ts:92 sets `refund_row_id: spec.refundIdempotencyId ?? crypto.randomUUID()`.
     * refund_row_id is therefore ALWAYS populated, so the adapter's
     * `?? …-after<priorRefunded>` fallback at :984-986 is unreachable through this
     * path, and the key is seeded on a value that is fresh on every attempt.
     *
     * Consequence: a network retry of ONE logical refund produces a NEW key, and
     * Square treats it as a NEW refund. Real money goes out twice.
     *
     * The adapter's comment states the intended trade-off explicitly: "Blocking a
     * real refund is recoverable... Double-refunding real money is not." The
     * random id inverts exactly that.
     */
    const attempt1 = await keyFor("sqpay_1", crypto.randomUUID(), 1000);
    const attempt2 = await keyFor("sqpay_1", crypto.randomUUID(), 1000);
    expect(attempt1).not.toBe(attempt2);
  });

  it("mints a fresh per-attempt refund id, leaving the prior-refunded fallback dead code", () => {
    // The `??` means the fallback runs only when refund_row_id is nullish, and
    // refund.ts guarantees it never is.
    expect(REFUND_SEAM).toContain("refund_row_id: spec.refundIdempotencyId ?? crypto.randomUUID()");
    expect(SQUARE_ADAPTER).toContain('spec.paymentRecord.refund_row_id as string | undefined');
    expect(SQUARE_ADAPTER).toMatch(/-after\$\{priorRefundedMinor\}/);
  });

  it("is not rescued by any caller supplying a stable refundIdempotencyId, because none does", () => {
    /**
     * This is what settles the severity. `refundIdempotencyId` is the escape hatch
     * that would make the key stable across retries — a caller passing a durable
     * id per logical refund would satisfy BOTH goals (dedupe a retry, separate two
     * equal partials). It appears in exactly TWO places in the whole repository,
     * both inside refund.ts: its own declaration at :45 and its own consumption at
     * :92. Every one of the seven production refund callers therefore takes the
     * randomUUID branch.
     *
     * Callers verified: process-refund, process-scheduled-refund,
     * cancel-rental-refund, deduct-from-deposit, reject-rental.
     */
    const declarations = (REFUND_SEAM.match(/refundIdempotencyId/g) || []).length;
    expect(declarations, "refundIdempotencyId should still be declared and consumed here").toBe(2);

    for (const caller of [
      "process-refund/index.ts",
      "process-scheduled-refund/index.ts",
      "cancel-rental-refund/index.ts",
      "deduct-from-deposit/index.ts",
      "reject-rental/index.ts",
    ]) {
      const src = readFileSync(fn(caller), "utf8");
      expect(src, `${caller} does not pass refundIdempotencyId`).not.toContain("refundIdempotencyId");
    }
  });

  it.fails("should derive the refund key from durable state so a retry cannot double-refund", () => {
    /**
     * Remove the `.fails` marker once refund.ts stops minting a random id per
     * attempt — either by requiring callers to pass refundIdempotencyId, or by
     * deleting the `?? crypto.randomUUID()` so the adapter's prior-refunded seed
     * becomes reachable again.
     *
     * Both goals are satisfiable at once: a durable id per logical refund ROW
     * de-dupes a retry AND keeps two genuine equal-amount partials distinct. A
     * value that is random per ATTEMPT can only do the second.
     */
    expect(REFUND_SEAM).not.toContain("crypto.randomUUID()");
  });
});

// @usecase Every amount crossing to Square is integer minor units. A float
// artifact here is a cent lost or gained on every transaction, and a null
// coerced to 0 refunds nothing while reporting success.
describe("square refunds — minor-unit conversion, executed", () => {
  it("converts major units to integer minor units", () => {
    expect(majorToMinorUnits(10)).toBe(1000);
    expect(majorToMinorUnits(10.5)).toBe(1050);
    expect(majorToMinorUnits("10.50")).toBe(1050);
  });

  it("does not lose a cent to floating point on a value that cannot be represented", () => {
    // 0.1 + 0.2 style drift: 10.07 * 100 is 1006.9999999999999 in float.
    expect(majorToMinorUnits(10.07)).toBe(1007);
    expect(majorToMinorUnits(19.99)).toBe(1999);
  });

  it("returns null rather than zero for a value it cannot convert", () => {
    // Returning 0 would silently refund nothing; null forces the caller to decide.
    expect(majorToMinorUnits(null)).toBeNull();
    expect(majorToMinorUnits(undefined)).toBeNull();
    expect(majorToMinorUnits("abc")).toBeNull();
  });
});

// @usecase When the tenant's provider cannot be determined the seam must
// degrade to Stripe, never to the unbuilt rail. A schema-lagging deploy must
// not throw on every Stripe checkout.
describe("square seam — the fail-safe direction, executed", () => {
  it("routes a tenant whose provider column is missing to Stripe, never to Square", () => {
    // The unreadable-row case: a schema-lagging deploy must not throw on every
    // Stripe checkout, and must not route money down the unbuilt rail.
    expect(resolveFromTenantRow({}).provider).toBe("stripe");
    expect(resolveFromTenantRow({ payment_provider: null }).provider).toBe("stripe");
    expect(resolveFromTenantRow({ payment_provider: undefined }).provider).toBe("stripe");
  });

  it("treats only the exact string 'square' as Square, so a stale enum value cannot route money", () => {
    // The coercion is internal to resolve.ts; asserted through its exported entry
    // point, which is the surface every caller actually uses.
    const p = (v: unknown) => resolveFromTenantRow({ payment_provider: v }).provider;
    expect(p("square")).toBe("square");
    expect(p("Square")).toBe("stripe");
    expect(p("SQUARE")).toBe("stripe");
    expect(p(" square")).toBe("stripe");
    expect(p("paypal")).toBe("stripe");
    expect(p(42)).toBe("stripe");
  });

  it("names the exact tenant columns the seam needs, so a hand-rolled select cannot drift", () => {
    // 38 of 43 importers hand-roll their select; this constant is the contract.
    expect(TENANT_PROVIDER_COLUMNS).toBe("id, payment_provider, square_mode, country");
  });

  it("leaves squareMode null for a Stripe tenant even when a stale square_mode is set", () => {
    const r = resolveFromTenantRow({ payment_provider: "stripe", square_mode: "live" });
    expect(r.provider).toBe("stripe");
    expect(r.squareMode).toBeNull();
  });

  it("defaults a Square tenant with no mode to test, never to live", () => {
    expect(resolveFromTenantRow({ payment_provider: "square" }).squareMode).toBe("test");
  });

  it("lets a cron skip a Square row without aborting the whole batch", () => {
    // isStripeTenant is true for absent/unknown providers so one Square row in a
    // Stripe batch is skipped, not fatal.
    expect(isStripeTenant({})).toBe(true);
    expect(isStripeTenant({ payment_provider: "paypal" })).toBe(true);
    expect(isStripeTenant({ payment_provider: "square" })).toBe(false);
  });

  it("throws only on an explicit Square tenant, and passes everything else through", () => {
    expect(() => assertStripeTenant({})).not.toThrow();
    expect(() => assertStripeTenant({ payment_provider: undefined })).not.toThrow();
    expect(() => assertStripeTenant({ payment_provider: "paypal" })).not.toThrow();
    expect(() => assertStripeTenant({ payment_provider: "square" })).toThrow();
  });
});

// @usecase One flag, supportsStoredCredential, is what switches off
// installments, auto-extend and deposit holds for Square. If it flips,
// unattended charges are attempted on a rail that cannot store a card.
describe("square seam — capabilities, executed", () => {
  it("reports that Square cannot store a credential for later unattended charging", () => {
    // This one flag is what switches off installments, auto-extend auto_charge,
    // charge-saved-card and deposit holds for Square. It is the axis the whole
    // v1 feature set hangs on.
    expect(SQUARE_CAPABILITIES.supportsStoredCredential).toBe(false);
    expect(SQUARE_CAPABILITIES.canChargeOffSession).toBe(false);
    expect(STRIPE_CAPABILITIES.supportsStoredCredential).toBe(true);
    expect(STRIPE_CAPABILITIES.canChargeOffSession).toBe(true);
  });

  it("reports that Square refunds settle asynchronously while Stripe's do not", () => {
    // A Square refund lands PENDING and can still be REJECTED later, so nothing
    // may write Completed off the submission response.
    expect(SQUARE_CAPABILITIES.refundsSettleAsynchronously).toBe(true);
    expect(STRIPE_CAPABILITIES.refundsSettleAsynchronously).toBe(false);
  });

  it("reports that Square has no cancel URL and needs a location id", () => {
    expect(SQUARE_CAPABILITIES.supportsCancelUrl).toBe(false);
    expect(SQUARE_CAPABILITIES.requiresLocationId).toBe(true);
    expect(STRIPE_CAPABILITIES.supportsCancelUrl).toBe(true);
    expect(STRIPE_CAPABILITIES.requiresLocationId).toBe(false);
  });

  it("hands back the Stripe manifest for any provider it does not know", () => {
    expect(capabilitiesFor("stripe")).toBe(STRIPE_CAPABILITIES);
    expect(capabilitiesFor("square")).toBe(SQUARE_CAPABILITIES);
    // @ts-expect-error deliberately probing an unregistered provider
    expect(capabilitiesFor("paypal")).toBe(STRIPE_CAPABILITIES);
  });

  it("freezes both manifests so no request handler can mutate a capability at runtime", () => {
    expect(Object.isFrozen(STRIPE_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(SQUARE_CAPABILITIES)).toBe(true);
  });
});
