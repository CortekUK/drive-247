/**
 * SQUARE — depth pass over the seam's EDGES: the callers around the adapter, the
 * two cron sweeps, and the capability manifest that is supposed to make all of
 * them provider-agnostic.
 *
 * WHAT THIS FILE COVERS
 *
 *   1. void-payment-link's Square branch — it tests `routed.error` only, and a
 *      skip is error-free, so a disconnected tenant is told a live link is dead.
 *   2. create-square-card-payment — the charged amount comes from the browser
 *      even when settling an existing payments row, and the row is then stamped
 *      Completed regardless of what was owed.
 *   3. The `idempotencyScope` both card forms transmit and the server never
 *      destructures.
 *   4. recover-pending-square-payments — paid_at is the cron's clock, not
 *      Square's, unlike both of its siblings.
 *   5. …the same sweep settling a COMPLETED order whose tender carries no
 *      payment_id, producing a Completed row with a NULL square_payment_id that
 *      the refund seam can only skip.
 *   6. …and its 24-hour lookback, copied from the Stripe twin onto the one rail
 *      whose links never expire.
 *   7. The capability manifest's BINDING RULE, measured: how many files gate on
 *      the provider NAME, and how many manifest fields no production file reads.
 *   8. The guardrail script a portal comment says enforces that rule, which is
 *      not in the repository.
 *   9. The Square feature flags forced false at tenant creation and re-enablable
 *      with one unguarded click in portal settings.
 *  10. send-auto-extension-reminder's Square gate, which sits inside the cron
 *      loop and below the manual entry point.
 *  11. refresh-square-tokens' hand-typed 30-day lifetime vs the manifest's.
 *  12. get-square-payment-request's currency, read from the tenant column rather
 *      than the connected location — where its sibling get-square-config reads
 *      the location and says why.
 *
 * LAYERS AND WHY
 *
 *   L1 (source-as-text, readFileSync) for every edge function here. They are Deno
 *   modules with `https://esm.sh/...` imports and a top-level `Deno.serve`, so
 *   they cannot be imported by vitest at all. `readEdgeFunction()` in
 *   tests/helpers/edge-contract.ts is not used: it hardcodes a `body` variable
 *   with a type annotation and throws on most of these files.
 *
 *   L3 (executable, through the `@fn` alias) wherever the behaviour lives in
 *   supabase/functions/_shared/payments/*, which is plain TypeScript with no
 *   Deno globals on the import path. `voidSquarePaymentLink` and
 *   `refundSquarePayment` are driven here against a hand-rolled Supabase stub —
 *   that is a real call through the real adapter, not a source grep.
 *
 * DELIBERATELY NOT COVERED
 *
 *   - Refund idempotency key derivation, the refund maths, the status map and
 *     the Square client's retry/timeout/versioning behaviour. Those are
 *     refund-idempotency.test.ts, seam-refund-math.test.ts, seam-correlation.test.ts
 *     and seam-dispatch.test.ts.
 *   - Webhook signature verification and the OAuth state row (oauth-and-webhook.test.ts).
 *   - The card path's catch-block row-killing and the lost refund handle
 *     (card-payment.test.ts).
 *   - Anything requiring a live call. Nothing here touches the network; the
 *     production project ref is never addressed.
 *
 * NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
 *
 *   - `skip(reason)` from types.ts returns `{handled:true, skipped:true, reason,
 *     body}` and NO `error` key. So `routed.error` is `undefined` on every skip.
 *     Five callers spell `routed.error || routed.skipped`; the one pinned below
 *     does not. Nothing about that is visible from the call site.
 *   - `loadConnection` returns null (→ skip) when there is no ACTIVE connection
 *     for the mode, and THROWS on a credential/mode mismatch. Both reach
 *     void-payment-link's soft-cancel: the skip through the falsy `error`, the
 *     throw through an enclosing catch whose comment says "non-fatal".
 *   - The two censuses in section 7 are CEILINGS. They are written as
 *     `toBeLessThanOrEqual` on purpose: the numbers are debt, and the test is
 *     meant to go red when the debt grows, not when it is paid down. If you pay
 *     some down, lower the literal in the same commit.
 *   - Every figure here was derived by hand from the source lines cited in the
 *     comment above it. None was copied out of program output.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { skip, failed, servedBySquare } from "@fn/_shared/payments/types.ts";
import type { ProviderResolution } from "@fn/_shared/payments/types.ts";
import {
  voidSquarePaymentLink,
  refundSquarePayment,
} from "@fn/_shared/payments/square-adapter.ts";
import {
  SQUARE_CAPABILITIES,
  STRIPE_CAPABILITIES,
  capabilitiesFor,
} from "@fn/_shared/payments/capabilities.ts";

const root = (p: string) => resolve(__dirname, "../../../", p);
const read = (p: string) => readFileSync(root(p), "utf8");
const exists = (p: string) => {
  try {
    statSync(root(p));
    return true;
  } catch {
    return false;
  }
};

const VOID_LINK = read("supabase/functions/void-payment-link/index.ts");
const CARD_FN = read("supabase/functions/create-square-card-payment/index.ts");
const ADAPTER = read("supabase/functions/_shared/payments/square-adapter.ts");
const RECOVER_SQUARE = read("supabase/functions/recover-pending-square-payments/index.ts");
const RECOVER_STRIPE = read("supabase/functions/recover-pending-stripe-payments/index.ts");
const SQUARE_WEBHOOK = read("supabase/functions/square-webhook/index.ts");
const AUTO_EXTEND = read("supabase/functions/send-auto-extension-reminder/index.ts");
const REFRESH_TOKENS = read("supabase/functions/refresh-square-tokens/index.ts");
const PAY_REQUEST = read("supabase/functions/get-square-payment-request/index.ts");
const SQUARE_CONFIG = read("supabase/functions/get-square-config/index.ts");
const CONFIG_TOML = read("supabase/config.toml");

/** A resolution for a Square tenant in test mode. */
const SQUARE_TENANT: ProviderResolution = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  provider: "square",
  squareMode: "test",
  country: "GB",
};

/**
 * The smallest Supabase stub the adapter's `loadConnection` will accept.
 * `rpcResult` is what `square_get_tokens` hands back; everything else throws, so
 * a test that accidentally reaches the network or a table says so loudly.
 */
function stubSupabase(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: async () => rpcResult,
    from() {
      throw new Error("stubSupabase: unexpected table access");
    },
  } as never;
}

// ===========================================================================
// 1. VOIDING A SQUARE LINK
// ===========================================================================

// @usecase An operator voids an unpaid Square payment request while the tenant's
// Square connection is inactive. The UI reports the link revoked and the payments
// row goes terminal, but the emailed URL is still payable — Square links have no
// expiry — so the money later arrives against a cancelled row.
describe("square void — what a skipped revoke is reported as", () => {
  it("returns a skip with no error flag when the tenant has no active Square connection", async () => {
    // EXECUTABLE, straight through the real adapter. `square_get_tokens` finds no
    // active row for the mode, loadConnection returns null
    // (square-adapter.ts:184-185), and voidSquarePaymentLink answers
    // skip("square_not_connected") at square-adapter.ts:1055.
    const routed = await voidSquarePaymentLink(
      stubSupabase({ data: null, error: null }),
      SQUARE_TENANT,
      "plink_abc123",
    );
    expect(routed.handled).toBe(true);
    expect(routed.skipped).toBe(true);
    expect(routed.reason).toBe("square_not_connected");
    // THE WHOLE POINT: `error` is absent, so `if (routed.error)` is false.
    expect(routed.error).toBeFalsy();
  });

  it("PINS TODAY'S BEHAVIOUR: the Square branch tests only routed.error, so a skip falls through to the soft-cancel", () => {
    /**
     * DEFECT, supabase/functions/void-payment-link/index.ts:209.
     *
     * The branch is:
     *     const routed = await voidSquarePaymentLink(...)      // :203
     *     if (routed.error) { return json({ success:false, ... }) }   // :209
     *     stripeExpired = true;  // shared flag: "the provider-side link is dead"  // :216
     *
     * `skip()` sets no `error` key (types.ts:89-91), so a skip takes neither
     * branch: control reaches :216 and the function goes on to soft-cancel the
     * payments row. The operator is shown "revoked"; Square still has a payable
     * link, because a Square link has no expiry — which is exactly what the
     * comment at :186-194 of this same file says.
     */
    const branchStart = VOID_LINK.indexOf('payment.payment_provider === "square"');
    expect(branchStart, "the Square branch moved").toBeGreaterThan(-1);
    const branchEnd = VOID_LINK.indexOf("} else if (tenant) {", branchStart);
    expect(branchEnd, "the Square/Stripe else-if moved").toBeGreaterThan(branchStart);
    const squareBranch = VOID_LINK.slice(branchStart, branchEnd);

    expect(squareBranch).toContain("if (routed.error) {");
    // The missing half.
    expect(
      squareBranch.includes("routed.skipped"),
      "the Square branch now mentions routed.skipped — re-read the watchdog below",
    ).toBe(false);
    // …and the fall-through target, in this branch, below the error return.
    expect(squareBranch).toContain(
      'stripeExpired = true; // shared flag: "the provider-side link is dead"',
    );
    expect(
      squareBranch.indexOf("if (routed.error) {"),
      "the error check must precede the flag it falls through to",
    ).toBeLessThan(squareBranch.indexOf("stripeExpired = true;"));
  });

  it("PINS TODAY'S BEHAVIOUR: a credential/mode mismatch throws into a catch that calls the failure non-fatal", () => {
    /**
     * The SECOND route to the same outcome. loadConnection throws on a
     * credential/mode mismatch (square-adapter.ts:191-196, "Refusing to
     * proceed."). void-payment-link wraps the whole provider block in a
     * try/catch whose comment reads "Already expired / completed / different
     * account — non-fatal." — written for the Stripe rail, where a dead session
     * genuinely makes the failure harmless. It swallows the Square throw too,
     * logs, and continues to the soft-cancel.
     */
    expect(ADAPTER).toContain("Refusing to proceed.");
    expect(VOID_LINK).toContain(
      "// Already expired / completed / different account — non-fatal.",
    );
    expect(VOID_LINK).toContain('console.log("void-payment-link: session expire skipped:", stripeNote);');
    // The catch is BELOW the Square branch, i.e. it encloses it.
    expect(VOID_LINK.indexOf('payment.payment_provider === "square"')).toBeLessThan(
      VOID_LINK.indexOf("// Already expired / completed / different account — non-fatal."),
    );
  });

  it("shows five sibling callers spelling the check the Square branch omits", () => {
    // The house pattern, so "routed.error alone" reads as an omission rather than
    // a local decision. Every one of these is a money path.
    const siblings = [
      "supabase/functions/process-refund/index.ts",
      "supabase/functions/cancel-rental-refund/index.ts",
      "supabase/functions/process-scheduled-refund/index.ts",
      "supabase/functions/deduct-from-deposit/index.ts",
      "supabase/functions/reject-rental/index.ts",
      "supabase/functions/create-square-card-payment/index.ts",
    ];
    for (const fn of siblings) {
      expect(read(fn), `${fn} no longer reasons about routed.skipped`).toContain("routed.skipped");
    }
    // process-refund's is the `else if` form; cancel-rental-refund's is the
    // combined form. Both are cited by the watchdog below.
    expect(read("supabase/functions/process-refund/index.ts")).toContain("} else if (routed.skipped) {");
    expect(read("supabase/functions/cancel-rental-refund/index.ts")).toContain(
      "if (routed.error || routed.skipped) {",
    );
  });

  it.fails("should refuse the void when the adapter skipped, the way process-refund and cancel-rental-refund do", () => {
    // Remove the .fails marker once supabase/functions/void-payment-link/index.ts:209
    // is fixed.
    //
    // CORRECT BEHAVIOUR: a skip means nothing was sent to Square, so the link is
    // still payable and the row must not be soft-cancelled. The branch should
    // read `if (routed.error || routed.skipped)`, exactly as
    // process-refund/index.ts:565 and cancel-rental-refund/index.ts:243 do.
    const branchStart = VOID_LINK.indexOf('payment.payment_provider === "square"');
    const branchEnd = VOID_LINK.indexOf("} else if (tenant) {", branchStart);
    const squareBranch = VOID_LINK.slice(branchStart, branchEnd);
    expect(squareBranch).toContain("routed.skipped");
  });
});

// ===========================================================================
// 2. THE AMOUNT A SETTLED CARD PAYMENT IS CHARGED
// ===========================================================================

// @usecase A renter holding an emailed Square pay link (which carries the
// payments-row uuid in the URL) posts the same uuid with totalAmount:1. £1 is
// charged, the row is stamped Completed with a paid_at, and a £500 debt reads as
// settled on the rental.
describe("square card payment — where the charged amount comes from", () => {
  it("PINS TODAY'S BEHAVIOUR: the amount is the browser's totalAmount, validated only for positivity", () => {
    /**
     * DEFECT, supabase/functions/create-square-card-payment/index.ts:87.
     *
     *   :53-56  const amountNum = Number(totalAmount);
     *           if (!Number.isFinite(amountNum) || amountNum <= 0) { ...reject }
     *   :87     amountCents: Math.round(amountNum * 100),
     *
     * The only check is "> 0". `paymentId` (destructured at :47, forwarded as
     * existingPaymentRowId at :92) names an existing payments row, and nothing
     * between those two lines reads that row's `amount`.
     */
    expect(CARD_FN).toContain("const amountNum = Number(totalAmount);");
    expect(CARD_FN).toContain("if (!Number.isFinite(amountNum) || amountNum <= 0) {");
    expect(CARD_FN).toContain("amountCents: Math.round(amountNum * 100),");
    expect(CARD_FN).toContain("existingPaymentRowId: paymentId ? String(paymentId) : undefined,");

    // No server-side read of the row's own amount anywhere in the function.
    expect(
      /select\([^)]*\bamount\b/.test(CARD_FN),
      "create-square-card-payment now selects an amount column — re-read the watchdog",
    ).toBe(false);
    // The ONLY `amount:` it writes is on the row it CREATES (the no-paymentId
    // path, :99), which is derived from the same browser figure.
    expect(CARD_FN).toContain("amount: Math.round(amountNum * 100) / 100,");
  });

  it("PINS TODAY'S BEHAVIOUR: the adapter's existing-row pre-flight reads settled-ness and never the amount", () => {
    /**
     * square-adapter.ts:780-796. The guard before charging an existing row is:
     *     .select("id, status, square_payment_id")     // :783
     *     if (existingRow.square_payment_id || (existingRow.status && existingRow.status !== "Pending"))
     *         return failed("square_payment_already_settled", 409, ...)
     *
     * "Already paid?" — yes. "For how much?" — never asked.
     */
    const guardStart = ADAPTER.indexOf(
      "// Refuse to charge a row that is no longer owed.",
    );
    expect(guardStart, "the existing-row pre-flight moved").toBeGreaterThan(-1);
    const guard = ADAPTER.slice(guardStart, guardStart + 900);
    expect(guard).toContain("if (paymentRowId) {");
    expect(guard).toContain('.select("id, status, square_payment_id")');
    expect(guard).toContain('return failed("square_payment_already_settled", 409, {');
    expect(guard.includes("amount"), "the pre-flight now looks at an amount").toBe(false);
  });

  it("PINS TODAY'S BEHAVIOUR: the post-charge update writes handles and status, never an amount or a remainder", () => {
    // square-adapter.ts:865-873. Four keys plus a conditional paid_at.
    const updStart = ADAPTER.indexOf("const update: Record<string, unknown> = {");
    expect(updStart).toBeGreaterThan(-1);
    const upd = ADAPTER.slice(updStart, ADAPTER.indexOf("};", updStart) + 2);
    expect(upd).toContain("square_payment_id: payment.id ?? null,");
    expect(upd).toContain("square_order_id: payment.order_id ?? null,");
    expect(upd).toContain("status: internal,");
    expect(upd.includes("remaining_amount")).toBe(false);
    expect(upd.includes("amount:")).toBe(false);
    // Completed, with a paid_at, regardless of what the row was for.
    expect(ADAPTER).toContain('if (internal === "Completed") {');
    expect(ADAPTER).toContain(
      "update.paid_at = payment.updated_at ?? payment.created_at ?? new Date().toISOString();",
    );
  });

  it("has no config.toml entry, so it runs at the default verify_jwt an anon key satisfies", () => {
    // The reachability half. Every function with a relaxed or otherwise notable
    // auth posture is named in supabase/config.toml; this one is absent, so it
    // takes the project default — which the PUBLIC anon key, shipped in the
    // booking app's bundle, satisfies.
    expect(CONFIG_TOML.includes("create-square-card-payment")).toBe(false);
    // Sanity that the file is the real one and the search would have found a hit.
    expect(CONFIG_TOML).toContain("square-webhook");
  });

  it.fails("should derive the charged amount from the payments row whenever paymentId is supplied", () => {
    // Remove the .fails marker once
    // supabase/functions/create-square-card-payment/index.ts:87 is fixed.
    //
    // CORRECT BEHAVIOUR: when settling an existing row the amount is a server
    // fact, not a request parameter. Either read `payments.amount` for that row
    // and charge it, or compare it to `totalAmount` and refuse a mismatch. The
    // adapter's own pre-flight (square-adapter.ts:783) is the natural place: it
    // already reads the row.
    const guardStart = ADAPTER.indexOf(
      "// Refuse to charge a row that is no longer owed.",
    );
    const guard = ADAPTER.slice(guardStart, guardStart + 900);
    expect(guard).toContain("amount");
  });
});

// ===========================================================================
// 3. THE IDEMPOTENCY SCOPE THE CLIENT SENDS AND THE SERVER DROPS
// ===========================================================================

// @usecase A caller separates two charges by passing idempotencyScope, as the
// prop's own doc-comment invites. The server never reads it, so the separation
// the caller believes it bought does not exist — and the next engineer to "wire
// the field through" silently changes the idempotency identity of a live money
// path.
describe("square card payment — the idempotencyScope both forms transmit", () => {
  const BOOKING_FORM = read("apps/booking/src/components/payments/SquareCardForm.tsx");
  const PORTAL_FORM = read("apps/portal/src/components/payments/SquareCardForm.tsx");

  it("PINS TODAY'S BEHAVIOUR: both card forms put idempotencyScope in the request body", () => {
    // apps/booking/src/components/payments/SquareCardForm.tsx:55,102,214 and
    // apps/portal/src/components/payments/SquareCardForm.tsx:61,108,220.
    for (const [name, src] of [["booking", BOOKING_FORM], ["portal", PORTAL_FORM]] as const) {
      expect(src, `${name} form dropped the prop`).toContain("idempotencyScope?: string;");
      expect(src, `${name} form dropped the doc-comment`).toContain(
        "/** Separates two genuinely different charges that share a reference + amount. */",
      );
      expect(src, `${name} form stopped invoking the function`).toContain(
        'supabase.functions.invoke("create-square-card-payment", {',
      );
      // It is inside the body object, next to paymentId.
      const bodyStart = src.indexOf('supabase.functions.invoke("create-square-card-payment", {');
      const body = src.slice(bodyStart, bodyStart + 500);
      expect(body, `${name} form stopped sending the scope`).toContain("idempotencyScope,");
      expect(body).toContain("totalAmount: amount,");
      expect(body).toContain("paymentId,");
    }
  });

  it("PINS TODAY'S BEHAVIOUR: the edge function destructures ten body fields and idempotencyScope is not one", () => {
    // create-square-card-payment/index.ts:36-48.
    const destrStart = CARD_FN.indexOf("const {\n      tenantId,");
    expect(destrStart, "the body destructure moved").toBeGreaterThan(-1);
    const destr = CARD_FN.slice(destrStart, CARD_FN.indexOf("} = body ?? {};", destrStart));
    for (const f of [
      "tenantId",
      "sourceId",
      "verificationToken",
      "totalAmount",
      "rentalId",
      "bookingId",
      "customerId",
      "targetCategories",
      "extensionId",
      "paymentId",
    ]) {
      expect(destr, `${f} left the destructure`).toContain(f);
    }
    expect(destr.includes("idempotencyScope")).toBe(false);
    // Nowhere else in the file either.
    expect(CARD_FN.includes("idempotencyScope")).toBe(false);
  });

  it("PINS TODAY'S BEHAVIOUR: the field exists on the LINK spec, so its absence here reads as an oversight", () => {
    // square-adapter.ts:98 — `idempotencyScope?: string;` on the checkout spec,
    // under a doc-comment explaining exactly when a caller must pass one, and
    // consumed at :341. The card spec has no such field.
    expect(ADAPTER).toContain("idempotencyScope?: string;");
    expect(ADAPTER).toContain("const scope = spec.idempotencyScope?.trim();");
  });

  it("PINS TODAY'S BEHAVIOUR: the card path keys on the single-use token instead, and says why", () => {
    // square-adapter.ts:765-773. This reasoning is almost certainly right — a
    // single-use token IS the correct identity for a card charge, and keying on
    // (reference, amount) wrongly refused a legitimate second charge. What is
    // missing is any record, in either the client or the function, that the
    // transmitted scope is deliberately unused.
    expect(ADAPTER).toContain("// KEYED ON THE CARD TOKEN, not on (reference, amount).");
    expect(ADAPTER).toContain("and it needs no caller to remember to pass a scope.");
    expect(ADAPTER).toContain("`card-${spec.sourceId}-${currency}-${spec.amountCents}`,");
  });

  it.fails("should either read the scope it is sent or record in source that the card path ignores it", () => {
    // Remove the .fails marker once
    // supabase/functions/create-square-card-payment/index.ts:36 is fixed.
    //
    // CORRECT BEHAVIOUR: a three-way mismatch between two clients and a server
    // is resolved in ONE of two ways — consume the field, or delete it from the
    // clients and leave a comment at the destructure saying the card path keys
    // on the token (square-adapter.ts:765-773) and needs no scope. Either
    // satisfies this; silently discarding it satisfies neither.
    const acknowledged =
      CARD_FN.includes("idempotencyScope") ||
      (!BOOKING_FORM.includes("idempotencyScope") && !PORTAL_FORM.includes("idempotencyScope"));
    expect(acknowledged).toBe(true);
  });
});

// ===========================================================================
// 4. WHOSE CLOCK STAMPS paid_at
// ===========================================================================

// @usecase A Square payment taken at 23:55 whose webhook is missed is recovered
// by the sweep after midnight and booked into the next day's revenue. The same
// collection lands on a different date depending on which of the two settlers
// won the race — a divergence no reconciliation can explain afterwards.
describe("square recovery — the clock that stamps a recovered payment", () => {
  it("PINS TODAY'S BEHAVIOUR: the sweep writes paid_at as its own now(), and discards Square's timestamp", () => {
    /**
     * DEFECT, supabase/functions/recover-pending-square-payments/index.ts:181.
     *
     * At :155 it declares the response shape it is about to fetch:
     *     squareFetch<{ payment?: { status?: string; updated_at?: string } }>
     * …reads only `.status` from it (:161), and then settles with
     *     paid_at: new Date().toISOString(),       // :181
     * The correct value was already in hand and was thrown away.
     */
    expect(RECOVER_SQUARE).toContain(
      'squareFetch<{ payment?: { status?: string; updated_at?: string } }>',
    );
    expect(RECOVER_SQUARE).toContain("paid_at: new Date().toISOString(),");
    // `updated_at` appears ONLY in that type annotation — it is never read.
    const updatedAtHits = RECOVER_SQUARE.split("updated_at").length - 1;
    // 1 = the type annotation at :155. 1 = `updated_at: new Date()...` at :182,
    // which is the ROW's audit column, not Square's timestamp. 2 total.
    expect(updatedAtHits).toBe(2);
    expect(RECOVER_SQUARE.includes("pRes.payment?.updated_at")).toBe(false);
  });

  it("shows both siblings preferring Square's own clock, and one of them saying why", () => {
    // square-webhook/index.ts:591 — the other settler of the same money.
    expect(SQUARE_WEBHOOK).toContain(
      "update.paid_at = isoOrNow(payment.updated_at ?? payment.created_at);",
    );
    expect(SQUARE_WEBHOOK).toContain(
      "// Prefer Square's own clock: a redelivered event hours later must not",
    );
    // square-adapter.ts:872 — the card path, same rule.
    expect(ADAPTER).toContain(
      "update.paid_at = payment.updated_at ?? payment.created_at ?? new Date().toISOString();",
    );
  });

  it("runs every minute, so the race between the two settlers is continuous", () => {
    // supabase/migrations/20260826130000_square_cron_jobs.sql — the recovery
    // sweep is scheduled '* * * * *', the same cadence as the Stripe twin.
    const cron = read("supabase/migrations/20260826130000_square_cron_jobs.sql");
    const jobStart = cron.indexOf("'recover-pending-square-payments',");
    expect(jobStart, "the recovery cron job was renamed or removed").toBeGreaterThan(-1);
    expect(cron.slice(jobStart, jobStart + 80)).toContain("'* * * * *'");
  });

  it.fails("should stamp paid_at from the Square payment's own updated_at or created_at", () => {
    // Remove the .fails marker once
    // supabase/functions/recover-pending-square-payments/index.ts:181 is fixed.
    //
    // CORRECT BEHAVIOUR: identical to square-webhook/index.ts:591 —
    // `payment.updated_at ?? payment.created_at`, falling back to now() only when
    // Square supplies neither (which also covers the paymentId===null path).
    expect(RECOVER_SQUARE).toMatch(/paid_at:[^,]*payment\??\.?\.?updated_at/);
  });
});

// ===========================================================================
// 5. SETTLING AN ORDER WITH NO TENDER PAYMENT ID
// ===========================================================================

// @usecase A recovered Square order whose tender carries no payment_id is banked
// as Completed with square_payment_id NULL. The documented payment-level
// cross-check never runs for it, and it is permanently unrefundable through the
// seam — process-refund can only record a manual ledger-only refund and an
// operator must find the money by hand in Square's dashboard.
describe("square recovery — orders whose tender has no payment id", () => {
  it("PINS TODAY'S BEHAVIOUR: the payment-level cross-check is skipped entirely when the tender id is null", () => {
    /**
     * DEFECT, supabase/functions/recover-pending-square-payments/index.ts:153-166.
     *
     *   const paymentId = order.tenders?.find((t) => t.payment_id)?.payment_id ?? null;
     *   if (paymentId) {
     *       ...fetch /v2/payments/{id}, map the status, `continue` unless Completed
     *   }
     *
     * The file's stated safety property (:36-38) is "Advances status FORWARD
     * only, and only to Completed, and only when Square says COMPLETED", with
     * this cross-check as the thing that stops an APPROVED authorisation being
     * banked. The `if` opts out of it for exactly the orders where the tender is
     * not resolvable.
     */
    expect(RECOVER_SQUARE).toContain(
      "const paymentId = order.tenders?.find((t) => t.payment_id)?.payment_id ?? null;",
    );
    expect(RECOVER_SQUARE).toContain("if (paymentId) {");
    expect(RECOVER_SQUARE).toContain(
      "// Cross-check against the payment's own status rather than trusting the",
    );
    expect(RECOVER_SQUARE).toContain(
      "//   * Advances status FORWARD only, and only to Completed, and only when Square",
    );
    // The mapped-status gate is INSIDE that conditional.
    const ifAt = RECOVER_SQUARE.indexOf("if (paymentId) {");
    const mappedAt = RECOVER_SQUARE.indexOf('if (mapped !== "Completed") {');
    expect(mappedAt).toBeGreaterThan(ifAt);
    // …and the settling update is AFTER the block closes.
    expect(RECOVER_SQUARE.indexOf('status: "Completed",\n            capture_status: "captured",'))
      .toBeGreaterThan(mappedAt);
  });

  it("PINS TODAY'S BEHAVIOUR: the handle is written only when a tender id existed, so the row can settle with it NULL", () => {
    // index.ts:176-183. `status: "Completed"` and `capture_status: "captured"`
    // are unconditional; `square_payment_id` is spread in only if paymentId.
    expect(RECOVER_SQUARE).toContain('status: "Completed",');
    expect(RECOVER_SQUARE).toContain('capture_status: "captured",');
    expect(RECOVER_SQUARE).toContain(
      "...(paymentId ? { square_payment_id: paymentId } : {}),",
    );
  });

  it("is then unrefundable through the seam, which answers with a success-shaped skip", async () => {
    // EXECUTABLE. A payments row exactly as the sweep leaves it — Completed, no
    // square_payment_id — driven through the real refund adapter with a stub
    // connection that IS active, so the skip cannot be blamed on connectivity.
    const routed = await refundSquarePayment(
      stubSupabase({
        data: [
          {
            access_token: "sq0atp-stub",
            location_id: "L_STUB",
            location_currency: "GBP",
            merchant_id: "M_STUB",
            square_mode: "test",
          },
        ],
        error: null,
      }),
      SQUARE_TENANT,
      {
        paymentRecord: {
          id: "22222222-2222-4222-8222-222222222222",
          status: "Completed",
          amount: 120,
          square_order_id: "ord_stub",
          square_payment_id: null, // what the sweep left behind
        },
      },
    );
    // square-adapter.ts:916-917 — skip("square_payment_id_missing").
    expect(routed.handled).toBe(true);
    expect(routed.skipped).toBe(true);
    expect(routed.reason).toBe("square_payment_id_missing");
    // handled:true with NO error flag — a 200-shaped answer for money that did
    // not move. That is the same shape as section 1's failure, one rail over.
    expect(routed.error).toBeFalsy();
  });

  it("leaves process-refund recording a ledger-only refund an operator must chase by hand", () => {
    // The consequence, in the caller that handles the skip correctly.
    const processRefund = read("supabase/functions/process-refund/index.ts");
    expect(processRefund).toContain("} else if (routed.skipped) {");
  });

  it.fails("should refuse to settle a row it cannot stamp a square_payment_id onto", () => {
    // Remove the .fails marker once
    // supabase/functions/recover-pending-square-payments/index.ts:153 is fixed.
    //
    // CORRECT BEHAVIOUR: no tender payment_id means the documented cross-check
    // cannot run and the resulting row cannot be refunded on the rail. Count it
    // `unchanged` (or as an error) and leave it Pending for a human, rather than
    // banking it. The `if (paymentId)` guard should become an early `continue`.
    const ifAt = RECOVER_SQUARE.indexOf("const paymentId = order.tenders");
    const tail = RECOVER_SQUARE.slice(ifAt, ifAt + 400);
    expect(tail).toMatch(/if\s*\(!paymentId\)/);
  });
});

// ===========================================================================
// 6. THE LOOKBACK WINDOW
// ===========================================================================

// @usecase A renter pays a three-day-old Square link — which is still payable,
// because Square links never expire — and that one webhook delivery is missed.
// Square offers no manual resend, and the only recovery sweep in the system
// stopped looking at that row 48 hours ago. Customer charged, rental shows
// Balance Due, nothing notices.
describe("square recovery — the 24-hour window borrowed from the Stripe twin", () => {
  it("PINS TODAY'S BEHAVIOUR: the sweep bounds itself to 24h, citing the Stripe recovery's reason", () => {
    /**
     * DEFECT, supabase/functions/recover-pending-square-payments/index.ts:52.
     *
     *   /** Matches the Stripe recovery's window, for the same reason: older rows
     *       are a reconciliation job, not a webhook miss. *\/
     *   const LOOKBACK_HOURS = 24;                                        // :53
     *   const cutoffIso = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000)... // :73
     *   .gte("created_at", cutoffIso)                                     // :83
     *
     * "Older rows are a reconciliation job" is TRUE for Stripe — nobody can pay a
     * dead session — and false here, on the reasoning this same file gives at
     * :16-17.
     */
    expect(RECOVER_SQUARE).toContain("const LOOKBACK_HOURS = 24;");
    expect(RECOVER_SQUARE).toContain(
      "Matches the Stripe recovery's window, for the same reason: older rows are a reconciliation job, not a webhook miss.",
    );
    expect(RECOVER_SQUARE).toContain(
      "const cutoffIso = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();",
    );
    expect(RECOVER_SQUARE).toContain('.gte("created_at", cutoffIso)');
  });

  it("PINS TODAY'S BEHAVIOUR: the same file's header states the premise that makes the window wrong", () => {
    // index.ts:16-17, in the WHY THIS EXISTS block.
    expect(RECOVER_SQUARE).toContain(
      "// anywhere that notices. Square makes it worse than the Stripe case: a Square",
    );
    expect(RECOVER_SQUARE).toContain("// payment link never expires, so the stale Pending row stays payable too.");
  });

  it("shows the Stripe twin using the identical literal, where it IS sound", () => {
    // recover-pending-stripe-payments/index.ts:48. A Checkout Session is dead
    // server-side after ~24h, which is a fact the rest of the system already
    // leans on (pinned in tests/integrations/stripe/checkout-health.test.ts).
    expect(RECOVER_STRIPE).toContain(
      "const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();",
    );
    // And the manifest records that the two rails differ on exactly this axis.
    expect(STRIPE_CAPABILITIES.supportsPaymentLinkExpiry).toBe(true);
    expect(SQUARE_CAPABILITIES.supportsPaymentLinkExpiry).toBe(false);
    // …with no way to ask for the missed event back.
    expect(STRIPE_CAPABILITIES.supportsEventReplay).toBe(true);
    expect(SQUARE_CAPABILITIES.supportsEventReplay).toBe(false);
  });

  it.fails("should not bound the Square sweep by the Stripe session lifetime", () => {
    // Remove the .fails marker once
    // supabase/functions/recover-pending-square-payments/index.ts:52 is fixed.
    //
    // CORRECT BEHAVIOUR: the window must be justified by SQUARE's own facts, not
    // copied from a rail whose links die on their own. Either widen it to cover
    // the life of a payable link, or derive it from
    // capabilities.supportsPaymentLinkExpiry / supportsEventReplay. Twenty-four
    // hours with the Stripe comment attached is the one thing it cannot stay.
    expect(RECOVER_SQUARE.includes("const LOOKBACK_HOURS = 24;")).toBe(false);
  });
});

// ===========================================================================
// 7. THE BINDING RULE, MEASURED
// ===========================================================================

/** Recursively list .ts/.tsx files under a repo-relative dir, skipping build output. */
function walk(relDir: string, out: string[] = []): string[] {
  const abs = root(relDir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === "dist" || e === ".turbo") continue;
    const rel = join(relDir, e);
    const st = statSync(root(rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
}

/** Production TS under the edge functions and the four apps. Tests excluded. */
const PRODUCTION_FILES = [
  ...walk("supabase/functions"),
  ...walk("apps/booking/src"),
  ...walk("apps/portal/src"),
  ...walk("apps/admin"),
  ...walk("apps/web"),
].filter((p) => !p.includes("__tests__") && !p.includes(".test."));

// @usecase capabilities.ts promises that provider #3 "fills in this table and
// every existing gate is already correct". If these censuses drift upward, that
// promise is being eroded one money function at a time — and a new provider
// becomes a re-audit of every file that spells the word "square".
describe("the capability manifest's binding rule, measured", () => {
  it("states the rule it is measured against", () => {
    const caps = read("supabase/functions/_shared/payments/capabilities.ts");
    expect(caps).toContain(
      " * BINDING RULE: every behavioural difference between processors lives HERE.",
    );
    expect(caps).toContain(
      " * because a CAPABILITY is false, never because `providerId === 'square'`.",
    );
    expect(caps).toContain(
      " * of them. Gating on a capability means provider #3 fills in this table and",
    );
  });

  it("names the five production modules that actually read the manifest", () => {
    // Hand-derived by grepping capabilitiesFor / SQUARE_CAPABILITIES /
    // STRIPE_CAPABILITIES / isCountrySupported across supabase/functions and
    // apps, excluding capabilities.ts itself and every test. Two of the five are
    // inside _shared/payments; three are outside it.
    expect(read("supabase/functions/_shared/payments/registry.ts")).toContain(
      'capabilities: capabilitiesFor("stripe"),',
    );
    expect(read("supabase/functions/_shared/payments/registry.ts")).toContain(
      'capabilities: capabilitiesFor("square"),',
    );
    expect(read("supabase/functions/_shared/payments/checkout.ts")).toContain(
      "const caps = capabilitiesFor(resolution.provider);",
    );
    expect(read("supabase/functions/_shared/payments/refund.ts")).toContain(
      'const caps = capabilitiesFor("square");',
    );
    expect(SQUARE_WEBHOOK).toContain(
      'const ACK_BUDGET_MS = capabilitiesFor("square").webhookAckBudgetMs;',
    );
    expect(read("supabase/functions/square-oauth-start/index.ts")).toContain(
      "if (!isCountrySupported(resolution.provider, resolution.country)) {",
    );
  });

  it("PINS TODAY'S BEHAVIOUR: at most 24 edge functions outside the seam gate on the provider NAME", () => {
    /**
     * Hand-derived census. The pattern is a comparison against the string
     * literal, in either quote style — `=== 'square'`, `=== "square"`, and the
     * negated forms — anywhere under supabase/functions EXCEPT
     * _shared/payments (where guard.ts and resolve.ts are allowed to know the
     * name, because resolving the provider is their job).
     *
     * The 24 files at the time of writing:
     *   cancel-rental-refund, charge-saved-card, create-hold-checkout,
     *   create-installment-checkout, create-preauth-checkout,
     *   create-sales-onboarding, create-square-card-payment,
     *   create-upfront-checkout, deduct-from-deposit, get-square-config,
     *   get-square-payment-request, installment-pay-link, pay-installment-early,
     *   place-deposit-hold, process-installment-payment, process-refund,
     *   process-scheduled-refund, refund-installment-payments, reject-rental,
     *   send-auto-extension-reminder, send-payg-manual-reminder, set-square-mode,
     *   sync-payment-intent, void-payment-link.
     *
     * A CEILING, not an equality: this number is debt, and the test exists to go
     * red when it GROWS. Lower the literal in the same commit that pays some
     * down.
     */
    const NAME_GATE = /(===|!==)\s*["']square["']/;
    const gated = PRODUCTION_FILES.filter(
      (p) => p.startsWith("supabase/functions") && !p.includes("_shared/payments"),
    ).filter((p) => NAME_GATE.test(read(p)));

    expect(
      gated.length,
      `provider-name gates outside the seam grew to ${gated.length}:\n${gated.join("\n")}`,
    ).toBeLessThanOrEqual(24);
    // The rule is violated TODAY. If this ever goes red downward, the binding
    // rule has actually been achieved and this file should be rewritten to say so.
    expect(gated.length).toBeGreaterThan(0);
  });

  it("PINS TODAY'S BEHAVIOUR: at most 18 of the 25 manifest fields have no production reader at all", () => {
    /**
     * The other half of the same debt. A capability nothing consults is a
     * comment with a type annotation: it cannot switch anything off, so the
     * behaviour it describes is encoded somewhere else — usually as a name gate
     * counted above, or as a hand-typed literal (see section 11).
     *
     * Hand-derived. The 18 unread at the time of writing:
     *   supportsHostedCheckout, supportsPaymentLinkExpiry, supportsCancelUrl,
     *   requiresLocationId, supportsManualCapture, supportsPartialCapture,
     *   maxPartialRefundsPerPayment, refundWindowDays, supportsUnlinkedRefund,
     *   refundsSettleAsynchronously, maxMetadataKeys, maxMetadataValueChars,
     *   maxIdempotencyKeyChars, webhookSignsNotificationUrl,
     *   webhookHasReplayWindow, supportsEventReplay, supportsApplicationFee,
     *   tokenExpiresDays.
     *
     * The seven that ARE read: supportsStoredCredential, canChargeOffSession,
     * supportsAuthorizationHold, supportsPartialRefund, webhookAckBudgetMs,
     * supportedCountries, and maxReferenceIdChars — the last of which survives
     * only inside a square-adapter.ts comment explaining the bug it caused.
     *
     * A CEILING. It should only come down.
     */
    const FIELDS = Object.keys(SQUARE_CAPABILITIES);
    expect(FIELDS.length, "the manifest gained or lost a field").toBe(25);

    const sources = PRODUCTION_FILES.filter(
      (p) => p !== "supabase/functions/_shared/payments/capabilities.ts",
    ).map((p) => read(p));

    const unread = FIELDS.filter((f) => !sources.some((s) => s.includes(f)));

    expect(
      unread.length,
      `capability fields with no production reader grew to ${unread.length}:\n${unread.join("\n")}`,
    ).toBeLessThanOrEqual(18);
    expect(unread.length).toBeGreaterThan(0);

    // Two spot pins so a rename cannot quietly satisfy the ceiling.
    expect(unread).toContain("supportsEventReplay");
    expect(unread).toContain("tokenExpiresDays");
    // And two that genuinely are load-bearing, so the census is not measuring
    // an empty manifest.
    expect(unread).not.toContain("supportsStoredCredential");
    expect(unread).not.toContain("supportedCountries");
  });

  it("shows one gate done the right way, so the census is a gap and not a style preference", () => {
    // _shared/payments/refund.ts:57-61 — the shape every one of the 24 could take.
    const refundSeam = read("supabase/functions/_shared/payments/refund.ts");
    expect(refundSeam).toContain('const caps = capabilitiesFor("square");');
    expect(refundSeam).toContain("!caps.supportsPartialRefund");
    // …reading a value that is genuinely true for Square, so the gate is live.
    expect(capabilitiesFor("square").supportsPartialRefund).toBe(true);
  });
});

// ===========================================================================
// 8. THE GUARDRAIL SCRIPT THAT IS NOT THERE
// ===========================================================================

// @usecase A reviewer reads the portal's Square hook — the file most likely to be
// copied as the pattern for new Square-aware UI — sees that raw provider-name
// comparisons are "banned by a script", and stops checking by hand. Nothing is
// enforcing the rule; section 7 counts what that has cost.
describe("the square guardrail script a comment claims enforces the binding rule", () => {
  it("PINS TODAY'S BEHAVIOUR: the comment names a script path that does not exist", () => {
    /**
     * DEFECT, apps/portal/src/hooks/use-square-connection.ts:38.
     *
     *   * `scripts/square-guardrails/check-predicates.mjs` bans raw provider-name
     *   * comparisons outside `supabase/functions/_shared/payments` so that
     *   * BEHAVIOURAL differences live in capabilities.ts instead ...
     */
    const hook = read("apps/portal/src/hooks/use-square-connection.ts");
    expect(hook).toContain("`scripts/square-guardrails/check-predicates.mjs` bans raw provider-name");
    expect(hook).toContain('const SQUARE_PROVIDER = "square";');

    expect(exists("scripts/square-guardrails"), "the guardrail directory now exists").toBe(false);
    expect(exists("scripts/square-guardrails/check-predicates.mjs")).toBe(false);
  });

  it("PINS TODAY'S BEHAVIOUR: nothing else in the repository mentions it either", () => {
    // Not wired into any npm script, and not referenced from any TS/TSX source
    // other than the comment itself — so it was never run in CI or a hook.
    const pkg = read("package.json");
    expect(pkg.includes("square-guardrails")).toBe(false);
    expect(pkg.includes("check-predicates")).toBe(false);

    const mentions = PRODUCTION_FILES.filter((p) => read(p).includes("square-guardrails"));
    expect(mentions).toEqual(["apps/portal/src/hooks/use-square-connection.ts"]);
  });

  it.fails("should ship the guardrail script the comment promises, or stop promising it", () => {
    // Remove the .fails marker once
    // apps/portal/src/hooks/use-square-connection.ts:38 is fixed.
    //
    // CORRECT BEHAVIOUR: either the script lands at the path named (and is wired
    // into package.json so it actually runs), or the paragraph is rewritten to
    // describe a convention rather than an enforcement. A comment that asserts
    // machine enforcement is how a reviewer decides not to look.
    const hook = read("apps/portal/src/hooks/use-square-connection.ts");
    const honest = exists("scripts/square-guardrails/check-predicates.mjs") ||
      !hook.includes("scripts/square-guardrails/check-predicates.mjs");
    expect(honest).toBe(true);
  });
});

// ===========================================================================
// 9. THE SQUARE FEATURE FLAGS FORCED AT CREATION
// ===========================================================================

// @usecase An operator on a Square tenant flips Installments on in portal
// settings. It saves instantly, no guard fires, and the plan is created. Every
// instalment after the first is an off-session charge against a card Square never
// vaulted: process-installment-payment `continue`s past it silently, so the plan
// simply never charges and the only trace is a console.error in a cron log.
describe("square installments — the creation-time invariant nothing reinforces", () => {
  const CREATE_TENANT = read("apps/admin/components/admin/CreateTenantDialog.tsx");
  const INSTALLMENT_SETTINGS = read("apps/portal/src/components/settings/InstallmentSettings.tsx");

  it("PINS TODAY'S BEHAVIOUR: tenant creation forces four flags off and claims that prevents re-enabling them", () => {
    /**
     * apps/admin/components/admin/CreateTenantDialog.tsx:117-134. The comment
     * makes the strongest possible form of the claim:
     *
     *   // ... Doing it here — instead of relying on a guard at money time — is
     *   // what keeps an operator from enabling installments in settings and
     *   // discovering at the first charge that Square never had the card.
     */
    expect(CREATE_TENANT).toContain(
      "// enabling installments in settings and discovering at the first",
    );
    expect(CREATE_TENANT).toContain("...(providerSelection.paymentProvider === 'square'");
    for (const flag of [
      "deposit_charge_enabled: true,",
      "installments_enabled: false,",
      "auto_extend_enabled: false,",
      "payg_auto_reminders_enabled: false,",
    ]) {
      expect(CREATE_TENANT, `${flag} left the creation-time block`).toContain(flag);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: the portal toggle that writes installments_enabled has no provider condition", () => {
    /**
     * DEFECT, the un-reinforced invariant.
     * apps/portal/src/components/settings/InstallmentSettings.tsx:127-145 — a
     * one-click, instant-save Switch that writes the very column creation forced
     * false, with the word "square" appearing nowhere in the file.
     */
    expect(INSTALLMENT_SETTINGS).toContain("await updateSettings({ installments_enabled: checked });");
    expect(
      /square/i.test(INSTALLMENT_SETTINGS),
      "InstallmentSettings now mentions Square — re-read the watchdog below",
    ).toBe(false);
  });

  it("PINS TODAY'S BEHAVIOUR: the money-time guards exist, and one of them is silent", () => {
    // create-installment-checkout/index.ts:153 refuses loudly with a 409.
    const createInstallment = read("supabase/functions/create-installment-checkout/index.ts");
    expect(createInstallment).toContain(
      "if ((tenant as { payment_provider?: string } | null)?.payment_provider === 'square') {",
    );
    expect(createInstallment).toContain("code: 'square_no_installments',");

    // process-installment-payment/index.ts:120 does NOT. It `continue`s, so a
    // plan that slipped through simply never charges, with no operator-visible
    // signal at all.
    const processInstallment = read("supabase/functions/process-installment-payment/index.ts");
    expect(processInstallment).toContain(
      "if ((tenant as { payment_provider?: string } | null)?.payment_provider === 'square') {",
    );
    const gateAt = processInstallment.indexOf(
      "if ((tenant as { payment_provider?: string } | null)?.payment_provider === 'square') {",
    );
    const tail = processInstallment.slice(gateAt, gateAt + 400);
    expect(tail).toContain("continue");
    expect(tail).toContain("console.error");

    // And the refund path treats the existence of such a plan as an anomaly to
    // be reported by a human.
    const refundInstallments = read("supabase/functions/refund-installment-payments/index.ts");
    expect(refundInstallments).toContain("An installment plan should not exist for this tenant");
  });

  it.fails("should refuse the settings toggle for a Square tenant, since creation-time forcing does not hold it", () => {
    // Remove the .fails marker once
    // apps/portal/src/components/settings/InstallmentSettings.tsx:144 is fixed.
    //
    // CORRECT BEHAVIOUR: the toggle is disabled (or the tab hidden) when the
    // tenant's provider cannot vault a card — properly, by reading
    // capabilities.supportsStoredCredential rather than comparing the provider
    // name, which is the binding rule section 7 measures. The same argument
    // applies to auto_extend_enabled and payg_auto_reminders_enabled, forced at
    // the same two sites and equally unreinforced.
    expect(/square|supportsStoredCredential|canChargeOffSession/i.test(INSTALLMENT_SETTINGS)).toBe(true);
  });
});

// ===========================================================================
// 10. THE AUTO-EXTENSION REMINDER'S PROVIDER GATE
// ===========================================================================

// @usecase An operator presses "send extension reminder" on a Square tenant's
// rental. The gate that refuses Square lives in the cron loop below, so this path
// builds a Stripe Checkout session instead: unpayable if the tenant is in test
// mode (the shared test Connect account), and settling into the Drive247 platform
// balance rather than the operator's if it is live and not onboarded.
describe("send-auto-extension-reminder — a Square gate on only one of two entry points", () => {
  it("PINS TODAY'S BEHAVIOUR: the manual branch returns before the sweep the gate lives in", () => {
    /**
     * DEFECT, supabase/functions/send-auto-extension-reminder/index.ts:426.
     *
     *   :392  if (body.rentalId) { ... const res = await sendForRental(...); return ... }
     *   :417  for (const r of (rentals as any[]) || []) {
     *   :426      if (r.tenants?.payment_provider === "square") { skipped++; continue; }
     *
     * The manual branch is ABOVE the loop and returns from it, so the gate is
     * unreachable on that path. The gate's own comment calls itself "Defence in
     * depth" against a rental-level flag the database does not constrain — but
     * it is the only defence, and it is not on the path an operator presses.
     */
    const manualAt = AUTO_EXTEND.indexOf("if (body.rentalId) {");
    const loopAt = AUTO_EXTEND.indexOf("for (const r of (rentals as any[]) || []) {");
    const gateAt = AUTO_EXTEND.indexOf('if (r.tenants?.payment_provider === "square") { skipped++; continue; }');

    expect(manualAt, "the manual branch moved").toBeGreaterThan(-1);
    expect(loopAt, "the cron sweep loop moved").toBeGreaterThan(-1);
    expect(gateAt, "the Square gate moved").toBeGreaterThan(-1);

    expect(manualAt, "the manual branch is no longer first").toBeLessThan(gateAt);
    expect(gateAt, "the gate is no longer inside the cron loop").toBeGreaterThan(loopAt);

    // The manual branch returns; it cannot fall through into the sweep.
    const manualBranch = AUTO_EXTEND.slice(manualAt, AUTO_EXTEND.indexOf("// ── Cron nudge sweep", manualAt));
    expect(manualBranch).toContain("const res = await sendForRental(supabase, rental, {");
    expect(manualBranch).toContain("return new Response(JSON.stringify(res), {");
    expect(manualBranch.includes("payment_provider")).toBe(false);

    // The gate's comment, claiming a depth it does not have.
    expect(AUTO_EXTEND).toContain("// Defence in depth. The rental-level auto_extend_enabled flag is a");
  });

  it("PINS TODAY'S BEHAVIOUR: the shared worker both entry points use knows nothing about providers", () => {
    // sendForRental (:97) calls stripeCtx(tenant) (:139), and stripeCtx (:43-51)
    // goes straight to Stripe with no provider comparison anywhere.
    const workerAt = AUTO_EXTEND.indexOf("async function sendForRental(");
    const ctxAt = AUTO_EXTEND.indexOf("async function stripeCtx(tenant: any): Promise<Ctx | null> {");
    expect(workerAt).toBeGreaterThan(-1);
    expect(ctxAt).toBeGreaterThan(-1);
    expect(AUTO_EXTEND).toContain("const ctx = await stripeCtx(tenant);");

    const ctx = AUTO_EXTEND.slice(ctxAt, AUTO_EXTEND.indexOf("\n}", ctxAt));
    expect(ctx).toContain("stripe = getStripeClientForAccount(platformAccount, mode);");
    expect(ctx).toContain("const acct = tenant ? getConnectAccountId(tenant) : null;");
    expect(ctx.includes("payment_provider"), "stripeCtx grew a provider branch").toBe(false);

    // The whole file gates on the provider name exactly once — in the loop.
    const hits = AUTO_EXTEND.split('payment_provider === "square"').length - 1;
    expect(hits).toBe(1);
  });

  it("PINS TODAY'S BEHAVIOUR: getConnectAccountId has no Square answer, only two wrong Stripe ones", () => {
    // _shared/stripe-client.ts:132-142. A Square tenant has no Connect account,
    // so a managed tenant in test mode gets the SHARED test Connect account and
    // a live-but-not-onboarded tenant gets null — commented, in source, as the
    // platform-balance case.
    const stripeClient = read("supabase/functions/_shared/stripe-client.ts");
    expect(stripeClient).toContain("    // All test tenants use the shared test Connect account");
    expect(stripeClient).toContain("return Deno.env.get('STRIPE_TEST_CONNECT_ACCOUNT_ID') || null;");
    expect(stripeClient).toContain("return null; // No routing - payment goes to platform");
  });

  it.fails("should refuse a Square tenant above sendForRental, so both entry points inherit it", () => {
    // Remove the .fails marker once
    // supabase/functions/send-auto-extension-reminder/index.ts:426 is fixed.
    //
    // CORRECT BEHAVIOUR: the refusal belongs inside sendForRental (or on the
    // resolution it performs), not in one of the two callers. Properly it reads
    // a capability rather than the provider name — auto-extend charges a stored
    // card, so capabilities.canChargeOffSession is the flag — but the minimum
    // fix is that the manual path cannot reach a Stripe client for a Square
    // tenant.
    const workerAt = AUTO_EXTEND.indexOf("async function sendForRental(");
    const worker = AUTO_EXTEND.slice(workerAt, AUTO_EXTEND.indexOf("\n}\n", workerAt));
    expect(/payment_provider|canChargeOffSession|resolvePaymentProvider/.test(worker)).toBe(true);
  });
});

// ===========================================================================
// 11. THE TOKEN LIFETIME, TYPED TWICE
// ===========================================================================

// @usecase The two copies of Square's 30-day token lifetime drift. The refresh
// cron's fallback writes a too-distant token_expires_at, its own selection window
// (`now + SQUARE_REFRESH_WINDOW_DAYS`) stops matching the row, and the tenant goes
// hard-offline at the real expiry — the launch-blocking failure the cron
// migration says this job exists to prevent.
describe("square token lifetime — the manifest value and the cron's hand-typed twin", () => {
  it("PINS TODAY'S BEHAVIOUR: the refresh cron hard-codes 30 days and never imports the manifest", () => {
    // refresh-square-tokens/index.ts:84, used at :371 (the log line) and :618
    // (the fallback expiry actually persisted).
    expect(REFRESH_TOKENS).toContain("const SQUARE_TOKEN_LIFETIME_DAYS = 30;");
    expect(REFRESH_TOKENS).toContain(
      "iso: new Date(Date.now() + SQUARE_TOKEN_LIFETIME_DAYS * MS_PER_DAY).toISOString(),",
    );
    // It imports from the seam — but square-oauth.ts, never capabilities.ts.
    expect(REFRESH_TOKENS).toContain(
      'import { refreshSquareToken, SQUARE_REFRESH_WINDOW_DAYS } from "../_shared/payments/square-oauth.ts";',
    );
    expect(REFRESH_TOKENS.includes("capabilities.ts"), "the cron now imports the manifest").toBe(false);
  });

  it("PINS TODAY'S BEHAVIOUR: the manifest states the same number, and no production file reads it", () => {
    // capabilities.ts:79-80 and :160. Executable — this is the real manifest.
    expect(SQUARE_CAPABILITIES.tokenExpiresDays).toBe(30);
    expect(STRIPE_CAPABILITIES.tokenExpiresDays).toBeNull();

    const readers = PRODUCTION_FILES.filter(
      (p) => p !== "supabase/functions/_shared/payments/capabilities.ts",
    ).filter((p) => read(p).includes("tokenExpiresDays"));
    expect(readers, `tokenExpiresDays gained a production reader: ${readers.join(", ")}`).toEqual([]);
  });

  it("locks the two copies together so a change to either goes red", () => {
    // The drift pin. `30` appears in exactly one place in the cron and one in
    // the manifest; this test is the only thing connecting them, so it must
    // compare them rather than assert each separately.
    const m = REFRESH_TOKENS.match(/const SQUARE_TOKEN_LIFETIME_DAYS = (\d+);/);
    expect(m, "the cron's lifetime constant was renamed").not.toBeNull();
    const cronDays = Number(m![1]);
    expect(
      cronDays,
      "refresh-square-tokens and capabilities.ts disagree about Square's token lifetime",
    ).toBe(SQUARE_CAPABILITIES.tokenExpiresDays);
    // Hand-check: 30 days x 24h x 60m x 60s x 1000ms = 2,592,000,000 ms. The
    // cron's selection window is 7 days = 604,800,000 ms, comfortably inside it,
    // which is what makes a single failed run non-fatal.
    expect(cronDays * 24 * 60 * 60 * 1000).toBe(2_592_000_000);
    const oauth = read("supabase/functions/_shared/payments/square-oauth.ts");
    const w = oauth.match(/SQUARE_REFRESH_WINDOW_DAYS\s*=\s*(\d+)/);
    expect(w, "the refresh window constant was renamed").not.toBeNull();
    expect(Number(w![1]) * 24 * 60 * 60 * 1000).toBe(604_800_000);
    expect(Number(w![1])).toBeLessThan(cronDays);
  });
});

// ===========================================================================
// 12. THE CURRENCY THE PAY PAGE SHOWS
// ===========================================================================

// @usecase A Square tenant's operator edits currency_code in settings after
// connecting. The pay page then renders "$120.00" for a GBP location, the renter
// enters a card, and the adapter refuses with square_currency_mismatch — an error
// about a currency the renter never chose and cannot change.
describe("the square pay page — which currency the renter is shown", () => {
  it("PINS TODAY'S BEHAVIOUR: get-square-payment-request reads the tenant column, not the connected location", () => {
    /**
     * DEFECT, supabase/functions/get-square-payment-request/index.ts:65.
     *
     *   .select("slug, company_name, currency_code")       // :53
     *   currency: String(tenant?.currency_code ?? "USD").toUpperCase(),   // :65
     *
     * It never reads square_connections at all, so it cannot know the location's
     * currency — which is the only currency the charge can be made in.
     */
    expect(PAY_REQUEST).toContain('.select("slug, company_name, currency_code")');
    expect(PAY_REQUEST).toContain('currency: String(tenant?.currency_code ?? "USD").toUpperCase(),');
    expect(PAY_REQUEST.includes("location_currency"), "it now reads the location currency").toBe(false);
    expect(PAY_REQUEST.includes("square_connections")).toBe(false);
  });

  it("shows its sibling get-square-config preferring the location, and saying why", () => {
    // get-square-config/index.ts:92-94. The same pay page calls BOTH functions,
    // and they disagree — which is what makes this an inconsistency rather than
    // a platform-wide convention.
    expect(SQUARE_CONFIG).toContain("// The location's currency, not the tenant's: Square bills in the");
    expect(SQUARE_CONFIG).toContain("// location's currency and will not convert.");
    expect(SQUARE_CONFIG).toContain(
      'currency: String(row.location_currency ?? tenant.currency_code ?? "USD").toUpperCase(),',
    );
  });

  it("PINS TODAY'S BEHAVIOUR: the adapter refuses the charge on exactly this drift, and documents it as reachable", () => {
    // square-adapter.ts:248-262 and resolveMoneyCurrency's mismatch branch. The
    // refusal is failed(), not skip() — a 409 the renter sees as a failure.
    expect(ADAPTER).toContain(" * ONE currency policy for BOTH money paths: the connected LOCATION decides.");
    expect(ADAPTER).toContain(
      " * The drift is reachable in production even though square-oauth-callback refuses",
    );
    expect(ADAPTER).toContain(
      " * currency_code in settings, and create-checkout-session derives its currency",
    );
    expect(ADAPTER).toContain('outcome: failed("square_currency_mismatch", 409, {');
    // EXECUTABLE: what a 409 mismatch outcome actually looks like to a caller.
    const mismatch = failed("square_currency_mismatch", 409, { requested: "USD", locationCurrency: "GBP" });
    expect(mismatch.error).toBe(true);
    expect(mismatch.httpStatus).toBe(409);
    expect(mismatch.skipped).toBeFalsy();
    // …as distinct from the skip and the success shapes used elsewhere here.
    expect(skip("square_not_connected").error).toBeFalsy();
    expect(servedBySquare({ provider: "square" }).skipped).toBeFalsy();
  });

  it("PINS TODAY'S BEHAVIOUR: the pay page renders the drifted figure as the price", () => {
    // apps/booking/src/app/checkout/[paymentId]/page.tsx — request.currency (from
    // get-square-payment-request) is what formats every amount the renter sees,
    // including the submit button's label.
    const page = read("apps/booking/src/app/checkout/[paymentId]/page.tsx");
    expect(page).toContain("{money(request.amount, request.currency)}");
    expect(page).toContain("submitLabel={`Pay ${money(request.amount, request.currency)}`}");
  });

  it.fails("should serve the connected location's currency, the way get-square-config does", () => {
    // Remove the .fails marker once
    // supabase/functions/get-square-payment-request/index.ts:65 is fixed.
    //
    // CORRECT BEHAVIOUR: read square_connections.location_currency for the
    // tenant's active connection and fall back to tenants.currency_code only when
    // it is absent — byte-for-byte what get-square-config/index.ts:94 already
    // does. Otherwise the one number the renter is asked to agree to is not the
    // number that will be charged.
    expect(PAY_REQUEST).toContain("location_currency");
  });
});
