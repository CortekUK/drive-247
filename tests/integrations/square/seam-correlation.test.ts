/**
 * SQUARE ADAPTER AND CLIENT — correlation, idempotency, timeouts, versioning.
 *
 * PORTED from adapter_correlation_test.ts and square_client_test.ts.
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
import type { ProviderResolution } from "@fn/_shared/payments/types.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

import { SquareError } from "@fn/_shared/payments/types.ts";
import {
  inspectSquareVersion,
  isRetryableSquareError,
  parseRetryAfterMs,
  retryAfterMsFor,
  SQUARE_FALLBACK_RETRY_AFTER_MS,
  SQUARE_VERSION_DEFAULT,
  squareFetch,
  SquareRateLimitError,
  type SquareRequest,
  SquareTimeoutError,
  verifySquareWebhook,
} from "@fn/_shared/payments/square-client.ts";
import { SQUARE_IDEMPOTENCY_MAX } from "@fn/_shared/payments/square-client.ts";
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

import {
  buildSquarePaymentNote,
  createSquareCheckout,
  refundSquarePayment,
  SQUARE_NOTE_PREFIX,
  SQUARE_PAYMENT_NOTE_MAX,
  type SquareCheckoutSpec,
} from "@fn/_shared/payments/square-adapter.ts";

// --- from adapter_correlation_test.ts -------------------------------
/**
 * square-adapter — correlation, idempotency and currency.
 *
 * Run:  deno test --allow-net --allow-env supabase/functions/_shared/payments/__tests__/
 *
 * These pin three defects that were live in the adapter, all of which are
 * invisible until real money is involved:
 *
 *  1. CORRELATION. The quick_pay Order carries no machine-readable handle, and
 *     the code put the reference in `payment_note` clamped to 40 chars — the
 *     ORDER.reference_id limit, borrowed for a field whose own limit is 500. A
 *     reference longer than 40 chars was silently truncated into something that
 *     still looked like an id. Verified against Square's live reference:
 *     QuickPay has exactly {name, price_money, location_id} — no reference_id,
 *     no metadata — so the real correlation is the returned order_id, which the
 *     CALLER must persist onto payments.square_order_id.
 *
 *  2. IDEMPOTENCY. The key was `chk-${paymentId}`, a pure function of the
 *     reference. Square returns 400 IDEMPOTENCY_KEY_REUSED when a key is reused
 *     with changed data, and 200-with-the-ORIGINAL-resource when it is reused
 *     with identical data. So a corrected amount was permanently un-chargeable,
 *     and a second same-amount charge on the same reference silently returned
 *     the FIRST link and was never collected.
 *
 *  3. CURRENCY. Checkout took currency from the caller's spec while refund took
 *     it from the connected location. Square binds currency to the location and
 *     will not convert, so the two disagreeing meant one path could work while
 *     the other failed with INVALID_VALUE at money time.
 *
 * Every test drives the REAL adapter functions with a stubbed fetch, so the
 * assertions are about the bytes we would actually send to Square.
 */
// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const RESOLUTION: ProviderResolution = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  provider: "square",
  squareMode: "test",
  country: "GB",
};
/** The row square_get_tokens actually returns. */
function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "EAAA-test-token",
    refresh_token: "EQAA-test-refresh",
    token_expires_at: "2026-12-01T00:00:00Z",
    merchant_id: "MERCHANT1",
    location_id: "LOC1",
    location_currency: "GBP",
    square_mode: "test",
    scopes: ["PAYMENTS_WRITE"],
    status: "active",
    ...overrides,
  };
}
// deno-lint-ignore no-explicit-any
function stubSupabase(row: Record<string, unknown> | null): any {
  return {
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: row ? [row] : [], error: null }),
  };
}
interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}
/**
 * Replace global fetch, capture what the adapter sends, and hand back a canned
 * Square response. Nothing here touches the network.
 */
function captureFetch(responseBody: unknown = {
  payment_link: { id: "PL_1", url: "https://sq.link/PL_1", order_id: "ORDER_1" },
}) {
  const calls: CapturedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const BASE_SPEC: SquareCheckoutSpec = {
  amountCents: 5000,
  currency: "gbp", // callers pass Stripe's LOWER-CASE code
  description: "Rental payment",
  reference: { paymentId: "22222222-2222-2222-2222-222222222222" },
};
/** Run one checkout and return the single captured request body. */
async function checkoutBody(
  spec: SquareCheckoutSpec,
  row: Record<string, unknown> = connectionRow(),
): Promise<Record<string, unknown>> {
  const cap = captureFetch();
  try {
    const out = await createSquareCheckout(stubSupabase(row), RESOLUTION, spec);
    expect(!out.error, `expected a served checkout, got: ${JSON.stringify(out.body)}`).toBeTruthy();
    expect(cap.calls.length, "exactly one Square call per checkout").toEqual(1);
    return cap.calls[0].body;
  } finally {
    cap.restore();
  }
}
async function idempotencyKeyFor(
  spec: SquareCheckoutSpec,
  row: Record<string, unknown> = connectionRow(),
): Promise<string> {
  const body = await checkoutBody(spec, row);
  const key = body.idempotency_key;
  expect(typeof key === "string" && key.length > 0, "every payment link must carry an idempotency key").toBeTruthy();
  return key as string;
}
// ---------------------------------------------------------------------------
// DEFECT 1 — correlation
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// DEFECT 2 — checkout idempotency
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// DEFECT 3 — one currency policy, applied to both money paths
// ---------------------------------------------------------------------------

// --- from square_client_test.ts -------------------------------------
/**
 * square-client.ts — defect regression tests.
 *
 * Run:  deno test --allow-net --allow-env supabase/functions/_shared/payments/__tests__/
 *
 * EVERY TEST IN HERE FAILS AGAINST THE PREVIOUS square-client.ts. Most fail
 * behaviourally (wrong body on the wire, a throw where false was required, a
 * missing deadline); the version tests fail at compile time because the pure
 * validator they assert on did not exist. A test that cannot fail is worse than
 * no test, so each one is annotated with what it looked like before.
 */
// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------
interface Captured {
  url: string;
  init: RequestInit;
}
/** Swap globalThis.fetch, capture what squareFetch tried to send, always restore. */
async function withFetch(
  impl: (url: string, init: RequestInit) => Promise<Response>,
  run: (captured: Captured[]) => Promise<void>,
): Promise<void> {
  const captured: Captured[] = [];
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((input: any, init: any) => {
    captured.push({ url: String(input), init: init ?? {} });
    return impl(String(input), init ?? {});
  }) as typeof fetch;
  try {
    await run(captured);
  } finally {
    globalThis.fetch = original;
  }
}
function ok(body: unknown = {}): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}
/** Capture console.error/warn so a "loudly logged" claim is actually asserted. */
async function withCapturedLogs(run: (lines: string[]) => Promise<void>): Promise<void> {
  const lines: string[] = [];
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await run(lines);
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
}
function sentBody(captured: Captured[]): Record<string, unknown> | undefined {
  const raw = captured[0]?.init?.body;
  if (raw === undefined || raw === null) return undefined;
  return JSON.parse(String(raw)) as Record<string, unknown>;
}
// ---------------------------------------------------------------------------
// DEFECT 1 — idempotency_key must never reach a credential exchange
// ---------------------------------------------------------------------------
/**
 * BEFORE: `req.idempotencyKey && req.body` was the whole condition, so ANY
 * caller passing a key to /oauth2/token injected `idempotency_key` into the
 * ObtainToken body. This test asserted-false there.
 */
/** A real money write still gets its key — the fix must not disarm idempotency. */
/**
 * BEFORE: `SquareRequest` was one interface where every method could carry a
 * body, so this line compiled — and `fetch` then threw
 * `TypeError: Request with GET/HEAD method cannot have body` (measured on Deno
 * 1.30.3) before a byte left the machine. With the union, the @ts-expect-error
 * is required; without it, this file does not typecheck.
 */
/** ...and if one arrives anyway through a cast, it is dropped, not thrown. */
// ---------------------------------------------------------------------------
// Precedence — which idempotency_key wins
// ---------------------------------------------------------------------------
/**
 * BEFORE: `{ idempotency_key: key, ...body }` — the BODY won, so a stray key in
 * the body silently defeated the clamped, collision-proof key from
 * squareIdempotencyKey() and could blow Square's 45-char cap on a money path.
 * The request-level field is the sanctioned channel and now wins.
 */
// ---------------------------------------------------------------------------
// DEFECT 2 — the webhook verifier must fail closed, never throw
// ---------------------------------------------------------------------------
/**
 * BEFORE: crypto.subtle.importKey('raw', <empty>) rejects with
 * `DataError: Key length is zero`, and that rejection escaped. One blank
 * SQUARE_*_WEBHOOK_SIGNATURE_KEY therefore answered 500 to every event for every
 * Square tenant — and ~3 weeks of non-2xx makes Square disable the subscription.
 */
/** The happy path must be untouched by the fail-closed guards. */
// ---------------------------------------------------------------------------
// DEFECT 3 — deadlines and 429s
// ---------------------------------------------------------------------------
/**
 * BEFORE: no AbortController anywhere, so this call hung until the platform
 * killed the invocation — indistinguishable from a crash, and fatal against a
 * 10s webhook ack budget. Against the old client this test sat for the stub's
 * full 1500ms and then failed on "expected a deadline error".
 */
/**
 * BEFORE: a 429 was flattened into a generic SquareError with no wait attached,
 * so `retryAfterMs` was undefined and no caller could back off correctly.
 */
// ---------------------------------------------------------------------------
// DEFECT 4 — the pinned API version is a live input
// ---------------------------------------------------------------------------
/**
 * BEFORE: SQUARE_VERSION was `Deno.env.get(...) ?? default` with NO validation
 * at all (not even the format check the brief assumed). `2026-8-19` would have
 * been sent verbatim and 400'd every call; `2031-01-01` would have been accepted
 * in silence. There was no pure validator to assert on, so this whole block
 * fails to compile against the old file.
 */

describe("correlating a Square payment back to a rental", () => {
  it("quick_pay carries ONLY the three fields Square documents", async () => {
  // Verified against https://developer.squareup.com/reference/square/objects/QuickPay
  // Adding reference_id or metadata here is a 400, not a richer correlation — and
  // `order` is mutually exclusive with quick_pay, so it cannot be smuggled in.
  const body = await checkoutBody(BASE_SPEC);
  const quickPay = body.quick_pay as Record<string, unknown>;
  expect(Object.keys(quickPay).sort()).toEqual(["location_id", "name", "price_money"]);
  expect(quickPay.reference_id, "QuickPay has no reference_id field").toEqual(undefined);
  expect(quickPay.metadata, "QuickPay has no metadata field").toEqual(undefined);
  expect(body.order, "order is mutually exclusive with quick_pay").toEqual(undefined);
});

  it("the FULL reference reaches payment_note — no 40-char truncation", async () => {
  // THE REGRESSION. `payment_note` was clamped with capabilities.maxReferenceIdChars
  // (40), which belongs to ORDER.reference_id. This reference is 48 chars, so the
  // old code shipped a truncated id that still parsed as an id.
  const longReference = "rental-22222222-2222-2222-2222-222222222222-payg";
  expect(longReference.length, "the fixture must exceed the old 40-char clamp").toEqual(48);

  const body = await checkoutBody({ ...BASE_SPEC, reference: { paymentId: longReference } });
  const note = String(body.payment_note ?? "");

  expect(note.includes(longReference), `payment_note lost part of the reference: ${note}`).toBeTruthy();
  expect(note.startsWith(SQUARE_NOTE_PREFIX), "the note is human-readable in the Square dashboard").toBeTruthy();
  expect(note.length <= SQUARE_PAYMENT_NOTE_MAX, "payment_note's own limit is 500").toBeTruthy();
  // The old behaviour, pinned so nobody reinstates it.
  expect(note).not.toEqual(longReference.slice(0, 40));
});

  it("order_id is returned as the column the caller must persist", async () => {
  // PRIMARY correlation. At the moment the buyer pays we do not yet know the
  // square_payment_id, so square_order_id is the ONLY column square-webhook can
  // match on. If the caller does not write it, the collection lands as
  // "no local payments row" and the money is stranded.
  const cap = captureFetch();
  try {
    const out = await createSquareCheckout(stubSupabase(connectionRow()), RESOLUTION, BASE_SPEC);
    expect(out.handled).toEqual(true);
    expect(!out.error).toBeTruthy();
    const body = out.body!;
    expect(body.squareOrderId, "named for the payments column it belongs in").toEqual("ORDER_1");
    expect(body.orderId, "legacy field kept for callers already reading it").toEqual("ORDER_1");
    expect((body.persist as Record<string, unknown>).square_order_id).toEqual("ORDER_1");
    expect(body.url).toEqual("https://sq.link/PL_1");
  } finally {
    cap.restore();
  }
});

  it("the returned referenceId is the full value, never a truncation", async () => {
  const longReference = "rental-22222222-2222-2222-2222-222222222222-payg";
  const cap = captureFetch();
  try {
    const out = await createSquareCheckout(
      stubSupabase(connectionRow()),
      RESOLUTION,
      { ...BASE_SPEC, reference: { paymentId: longReference } },
    );
    // A caller could persist this. Handing back a shortened id would be worse
    // than handing back none.
    expect(out.body!.referenceId).toEqual(longReference);
  } finally {
    cap.restore();
  }
});

  it("buildSquarePaymentNote clamps to 500, not to 40", () => {
  const huge = "x".repeat(900);
  const note = buildSquarePaymentNote(huge);
  expect(note.length).toEqual(SQUARE_PAYMENT_NOTE_MAX);
  expect(note.length > 40, "the old clamp would have produced 40 chars").toBeTruthy();
});

});

describe("Square idempotency key derivation", () => {
  it("a TRUE retry of the same money de-duplicates", async () => {
  const a = await idempotencyKeyFor(BASE_SPEC);
  const b = await idempotencyKeyFor(BASE_SPEC);
  expect(a, "same reference + same amount + same currency must reuse the key").toEqual(b);
});

  it("a CORRECTED amount mints a new key", async () => {
  // THE REGRESSION. With `chk-${paymentId}` both calls produced one key, so the
  // corrected link came back as 400 IDEMPOTENCY_KEY_REUSED — permanently, since
  // the key never varies. Nothing about that reference could ever be charged again.
  const original = await idempotencyKeyFor(BASE_SPEC);
  const corrected = await idempotencyKeyFor({ ...BASE_SPEC, amountCents: 7500 });
  expect(original, "a changed amount MUST mint a new idempotency key").not.toEqual(corrected);
});

  it("a different currency mints a new key", async () => {
  const gbp = await idempotencyKeyFor(BASE_SPEC, connectionRow());
  const usd = await idempotencyKeyFor(
    { ...BASE_SPEC, currency: "usd" },
    connectionRow({ location_currency: "USD" }),
  );
  expect(gbp).not.toEqual(usd);
});

  it("currency CASE is not a difference", async () => {
  const lower = await idempotencyKeyFor({ ...BASE_SPEC, currency: "gbp" });
  const upper = await idempotencyKeyFor({ ...BASE_SPEC, currency: "GBP" });
  expect(lower, "'gbp' and 'GBP' are the same money and must share a key").toEqual(upper);
});

  it("idempotencyScope separates two charges that share reference AND amount", async () => {
  // The residual collision the amount cannot break: two identical weekly PAYG
  // collections on one rental. Reachable because create-checkout-session passes a
  // RENTAL id as reference.paymentId.
  const first = await idempotencyKeyFor({ ...BASE_SPEC, idempotencyScope: "accrual-1" });
  const second = await idempotencyKeyFor({ ...BASE_SPEC, idempotencyScope: "accrual-2" });
  expect(first, "a row-unique scope must break the collision").not.toEqual(second);

  const retryOfFirst = await idempotencyKeyFor({ ...BASE_SPEC, idempotencyScope: "accrual-1" });
  expect(first, "a scoped retry still de-duplicates").toEqual(retryOfFirst);
});

  it("an EMPTY reference never collapses two charges into one link", async () => {
  // create-checkout-session passes String(referenceId ?? ''), so '' is reachable.
  // A stable key would make every equal-amount charge share `chk--GBP-5000`.
  // A spare unpaid payment link is recoverable; a collapsed link is a lost collection.
  const spec = { ...BASE_SPEC, reference: { paymentId: "" } };
  const a = await idempotencyKeyFor(spec);
  const b = await idempotencyKeyFor(spec);
  expect(a, "with no identity at all, uniqueness beats de-duplication").not.toEqual(b);
});

  it("the key respects Square's length ceiling", async () => {
  const key = await idempotencyKeyFor({
    ...BASE_SPEC,
    reference: { paymentId: "r".repeat(200) },
    idempotencyScope: "s".repeat(200),
  });
  // squareIdempotencyKey hashes rather than truncates, so long inputs stay unique.
  // Asserted against the exported constant, not a literal, so this test tracks
  // square-client.ts rather than duplicating its number.
  expect(key.length <= SQUARE_IDEMPOTENCY_MAX, `idempotency key too long: ${key.length}`).toBeTruthy();

  const other = await idempotencyKeyFor({
    ...BASE_SPEC,
    reference: { paymentId: "r".repeat(200) },
    idempotencyScope: "s".repeat(199) + "t",
  });
  expect(key, "hashing must not collapse two long, distinct keys").not.toEqual(other);
});

});

describe("Square currency handling", () => {
  it("checkout sends the LOCATION's currency, not the caller's casing", async () => {
  const body = await checkoutBody(BASE_SPEC);
  const money = (body.quick_pay as Record<string, unknown>).price_money as Record<string, unknown>;
  expect(money.currency).toEqual("GBP");
  expect(money.amount).toEqual(5000);
});

  it("a MISMATCH fails pre-flight, before any Square call", async () => {
  // THE REGRESSION. The old code sent spec.currency straight through, so a tenant
  // whose currency_code drifted from its connected location got a Square 400
  // INVALID_VALUE naming neither currency. Nothing re-checks that pairing after
  // square-oauth-callback, and an operator can edit currency_code in settings.
  const cap = captureFetch();
  try {
    const out = await createSquareCheckout(
      stubSupabase(connectionRow({ location_currency: "GBP" })),
      RESOLUTION,
      { ...BASE_SPEC, currency: "usd" },
    );
    expect(cap.calls.length, "a known-bad currency must never reach Square").toEqual(0);
    expect(out.handled).toEqual(true);
    expect(out.error, "this is a failure, not a success-shaped skip").toEqual(true);
    expect(out.skipped).toEqual(undefined);
    expect(out.reason).toEqual("square_currency_mismatch");
    expect(out.httpStatus).toEqual(409);
    expect(out.body!.requested).toEqual("USD");
    expect(out.body!.locationCurrency).toEqual("GBP");
  } finally {
    cap.restore();
  }
});

  it("an unknown location currency FAILS on checkout", async () => {
  const cap = captureFetch();
  try {
    const out = await createSquareCheckout(
      stubSupabase(connectionRow({ location_currency: null })),
      RESOLUTION,
      BASE_SPEC,
    );
    expect(cap.calls.length).toEqual(0);
    expect(out.error).toEqual(true);
    expect(out.reason).toEqual("square_location_currency_unknown");
    expect(out.httpStatus).toEqual(409);
  } finally {
    cap.restore();
  }
});

  it("an unknown location currency FAILS on refund too — one policy", async () => {
  // THE REGRESSION. This was skip(), which is handled:true — a success-shaped 200.
  // The operator was told the refund had been issued while nothing was ever sent.
  // An ACTIVE connection with no location currency is a broken connection, not a
  // tenant mid-onboarding, and the two must not report the same way.
  const cap = captureFetch();
  try {
    const out = await refundSquarePayment(
      stubSupabase(connectionRow({ location_currency: "" })),
      RESOLUTION,
      { paymentRecord: { id: "p1", payment_provider: "square", square_payment_id: "sqpmt_1", amount: 125.50 } },
    );
    expect(cap.calls.length).toEqual(0);
    expect(out.error, "a refund that did not happen must not report success").toEqual(true);
    expect(out.skipped).toEqual(undefined);
    expect(out.reason).toEqual("square_location_currency_unknown");
    expect(out.httpStatus).toEqual(409);
  } finally {
    cap.restore();
  }
});

  it("refund sends the location currency and the real MAJOR-unit amount", async () => {
  const cap = captureFetch({ refund: { id: "RFND_1", status: "PENDING" } });
  try {
    const out = await refundSquarePayment(
      stubSupabase(connectionRow({ location_currency: "GBP" })),
      RESOLUTION,
      // The real payments row shape: amount numeric in MAJOR units, no currency column.
      { paymentRecord: { id: "p1", payment_provider: "square", square_payment_id: "sqpmt_1", amount: 125.50 } },
    );
    expect(cap.calls.length).toEqual(1);
    const money = cap.calls[0].body.amount_money as Record<string, unknown>;
    expect(money).toEqual({ amount: 12550, currency: "GBP" });
    expect(out.body!.currency).toEqual("GBP");
    // A Square refund lands PENDING and settles via refund.updated.
    expect(out.body!.status).toEqual("Pending");
    expect(out.body!.settlesAsynchronously).toEqual(true);
  } finally {
    cap.restore();
  }
});

  it("checkout and refund agree by construction on the same connection", async () => {
  const row = connectionRow({ location_currency: "EUR" });

  const checkout = await checkoutBody({ ...BASE_SPEC, currency: "eur" }, row);
  const checkoutCurrency =
    ((checkout.quick_pay as Record<string, unknown>).price_money as Record<string, unknown>).currency;

  const cap = captureFetch({ refund: { id: "RFND_1", status: "PENDING" } });
  let refundCurrency: unknown;
  try {
    await refundSquarePayment(stubSupabase(row), RESOLUTION, {
      paymentRecord: { id: "p1", payment_provider: "square", square_payment_id: "sqpmt_1", amount: 10 },
    });
    refundCurrency = (cap.calls[0].body.amount_money as Record<string, unknown>).currency;
  } finally {
    cap.restore();
  }

  expect(checkoutCurrency, "the two money paths must never disagree on currency").toEqual(refundCurrency);
  expect(checkoutCurrency).toEqual("EUR");
});

});

describe("Square client — which requests may carry an idempotency key", () => {
  it("/oauth2/token never receives an injected idempotency_key", async () => {
  await withCapturedLogs(async (lines) => {
    await withFetch(() => ok({ access_token: "a", refresh_token: "r" }), async (captured) => {
      await squareFetch({
        mode: "test",
        accessToken: "",
        method: "POST",
        path: "/oauth2/token",
        idempotencyKey: "should-never-be-sent",
        body: {
          client_id: "app",
          client_secret: "secret",
          grant_type: "refresh_token",
          refresh_token: "rt",
        },
      });

      const body = sentBody(captured)!;
      expect(body.idempotency_key, "an injected idempotency_key corrupts Square's ObtainToken request").toEqual(undefined);
      // The rest of the credential exchange must survive intact.
      expect(body.grant_type).toEqual("refresh_token");
      expect(body.client_secret).toEqual("secret");
    });

    expect(lines.some((l) => l.includes("refusing to inject idempotency_key")), "the refusal must be logged, not silent").toBeTruthy();
  });
});

  it("the whole /oauth2 namespace is idempotency-incapable", async () => {
  await withCapturedLogs(async () => {
    for (const path of ["/oauth2/token", "/oauth2/token/status", "/oauth2/revoke"]) {
      await withFetch(() => ok({}), async (captured) => {
        await squareFetch({
          mode: "test",
          accessToken: "t",
          method: "POST",
          path,
          idempotencyKey: "k",
          body: {},
        });
        expect(sentBody(captured)?.idempotency_key, `leaked into ${path}`).toEqual(undefined);
      });
    }
  });
});

  it("money writes DO still get the idempotency_key", async () => {
  await withFetch(() => ok({ payment_link: { id: "pl_1" } }), async (captured) => {
    await squareFetch({
      mode: "test",
      accessToken: "t",
      method: "POST",
      path: "/v2/online-checkout/payment-links",
      idempotencyKey: "chk-abc",
      body: { quick_pay: { name: "Rental" } },
    });
    expect(sentBody(captured)?.idempotency_key).toEqual("chk-abc");
  });
});

  it("a GET cannot express a body at all (compile-time)", () => {
  // @ts-expect-error - a GET request must not be able to carry a body
  const req: SquareRequest = {
    mode: "test",
    accessToken: "t",
    method: "GET",
    path: "/v2/locations",
    body: { nope: true },
  };
  expect(req.method).toEqual("GET");
});

  it("a cast-in GET body is dropped rather than crashing fetch", async () => {
  await withCapturedLogs(async () => {
    await withFetch(() => ok({ locations: [] }), async (captured) => {
      await squareFetch({
        mode: "test",
        accessToken: "t",
        method: "GET",
        path: "/v2/locations",
        body: { smuggled: true },
      } as unknown as SquareRequest);
      expect(captured[0].init.body, "a GET must reach fetch with no body").toEqual(undefined);
    });
  });
});

});

describe("Square idempotency seed precedence", () => {
  it("the request-level idempotency key beats a body key", async () => {
  await withCapturedLogs(async (lines) => {
    await withFetch(() => ok({}), async (captured) => {
      await squareFetch({
        mode: "test",
        accessToken: "t",
        method: "POST",
        path: "/v2/refunds",
        idempotencyKey: "rfnd-authoritative",
        body: { idempotency_key: "stale-from-caller", payment_id: "p1" },
      });
      expect(sentBody(captured)?.idempotency_key).toEqual("rfnd-authoritative");
      expect(sentBody(captured)?.payment_id).toEqual("p1");
    });
    expect(lines.some((l) => l.includes("overridden by the request-level key")), "silently overriding a caller's key would be its own defect").toBeTruthy();
  });
});

  it("a write with a key and no body still sends the key", async () => {
  await withFetch(() => ok({}), async (captured) => {
    await squareFetch({
      mode: "test",
      accessToken: "t",
      method: "POST",
      path: "/v2/refunds",
      idempotencyKey: "k1",
    });
    expect(sentBody(captured)?.idempotency_key).toEqual("k1");
  });
});

  it("a non-object body with a key throws instead of dropping it", async () => {
  await withFetch(() => ok({}), async () => {
    let caught: unknown;
    try {
      await squareFetch({
        mode: "test",
        accessToken: "t",
        method: "POST",
        path: "/v2/refunds",
        idempotencyKey: "k1",
        body: "raw-string",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof SquareError, "dropping idempotency on a money path must be loud").toBeTruthy();
    expect((caught as SquareError).code).toEqual("IDEMPOTENCY_BODY_NOT_OBJECT");
  });
});

});

describe("Square client — webhook verification fails closed", () => {
  it("an empty signature key returns false, it does not throw", async () => {
  await withCapturedLogs(async (lines) => {
    const url = "https://example.supabase.co/functions/v1/square-webhook";
    const body = JSON.stringify({ type: "payment.updated" });

    expect(await verifySquareWebhook("", url, body, "c2ln")).toEqual(false);
    expect(lines.some((l) => l.includes("empty or unset")), "a mis-set secret must be visible in the logs").toBeTruthy();
  });
});

  it("an unset/undefined key and an empty URL also fail closed", async () => {
  await withCapturedLogs(async () => {
    const url = "https://example.supabase.co/functions/v1/square-webhook";
    expect(await verifySquareWebhook(undefined as unknown as string, url, "{}", "c2ln")).toEqual(false);
    // An empty notification URL cannot reconstruct the signed message either.
    expect(await verifySquareWebhook("key", "", "{}", "c2ln")).toEqual(false);
  });
});

  it("a genuine signature still verifies", async () => {
  const key = "test-signature-key";
  const url = "https://example.supabase.co/functions/v1/square-webhook";
  const body = JSON.stringify({ type: "refund.updated" });
  const mac = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    new TextEncoder().encode(url + body),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(mac)));
  expect(await verifySquareWebhook(key, url, body, sig)).toEqual(true);
  expect(await verifySquareWebhook(key, url, body, "AAAA")).toEqual(false);
});

});

describe("Square client — timeouts, rate limits and retryability", () => {
  it("a hung Square call is aborted at its deadline", async () => {
  const stub = (_url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("{}", { status: 200 })), 1500);
      const signal = init.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The signal has been aborted", "AbortError"));
        }, { once: true });
      }
    });

  await withFetch(stub, async () => {
    const started = Date.now();
    let caught: unknown;
    try {
      await squareFetch({
        mode: "test",
        accessToken: "t",
        method: "GET",
        path: "/v2/locations",
        timeoutMs: 500, // clamped floor; well under the 1500ms stub
      });
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - started;

    expect(caught instanceof SquareError, `expected a deadline error, got ${caught}`).toBeTruthy();
    expect((caught as Error).message).toContain("deadline");
    expect(caught instanceof SquareTimeoutError).toBeTruthy();
    expect(elapsed < 1400, `deadline did not fire: waited ${elapsed}ms`).toBeTruthy();
  });
});

  it("a timeout is classed retryable", () => {
  const err = new SquareTimeoutError(500, "GET", "/v2/locations");
  expect(err instanceof SquareError, "existing `instanceof SquareError` catches must still fire").toBeTruthy();
  expect(isRetryableSquareError(err)).toEqual(true);
  expect(err.httpStatus).toEqual(504);
});

  it("a 429 surfaces as a distinct retryable error honouring Retry-After", async () => {
  const stub = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          errors: [{ category: "RATE_LIMIT_ERROR", code: "RATE_LIMITED", detail: "slow down" }],
        }),
        { status: 429, headers: { "retry-after": "2", "content-type": "application/json" } },
      ),
    );

  await withFetch(stub, async () => {
    let caught: unknown;
    try {
      await squareFetch({
        mode: "test",
        accessToken: "t",
        method: "POST",
        path: "/v2/refunds",
        idempotencyKey: "k",
        body: { payment_id: "p1" },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof SquareError, "must stay instanceof SquareError for existing catches").toBeTruthy();
    expect((caught as { retryAfterMs?: number }).retryAfterMs).toEqual(2000);
    expect(caught instanceof SquareRateLimitError).toBeTruthy();
    expect((caught as SquareRateLimitError).category).toEqual("RATE_LIMIT_ERROR");
    expect(isRetryableSquareError(caught)).toEqual(true);
  });
});

  it("a 429 with no Retry-After backs off conservatively", async () => {
  const stub = () =>
    Promise.resolve(new Response(JSON.stringify({ errors: [] }), { status: 429 }));

  await withFetch(stub, async () => {
    let caught: unknown;
    try {
      await squareFetch({ mode: "test", accessToken: "t", method: "GET", path: "/v2/locations" });
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof SquareRateLimitError).toBeTruthy();
    // Square publishes no rate-limit numbers, so the fallback must not be tiny.
    expect((caught as SquareRateLimitError).retryAfterMs).toEqual(SQUARE_FALLBACK_RETRY_AFTER_MS);
    expect(SQUARE_FALLBACK_RETRY_AFTER_MS >= 1000).toBeTruthy();
  });
});

  it("retry-After accepts both delta-seconds and an HTTP-date", () => {
  expect(parseRetryAfterMs("3")).toEqual(3000);
  expect(parseRetryAfterMs(null)).toEqual(null);
  expect(parseRetryAfterMs("   ")).toEqual(null);
  expect(parseRetryAfterMs("not-a-date")).toEqual(null);
  const soon = new Date(Date.now() + 4000).toUTCString();
  const ms = parseRetryAfterMs(soon);
  expect(ms !== null && ms > 1000 && ms <= 5000, `unexpected http-date backoff: ${ms}`).toBeTruthy();
});

  it("a 4xx that is NOT a rate limit stays a plain SquareError", async () => {
  const stub = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          errors: [{ category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE", detail: "bad" }],
        }),
        { status: 400 },
      ),
    );

  await withFetch(stub, async () => {
    let caught: unknown;
    try {
      await squareFetch({ mode: "test", accessToken: "t", method: "GET", path: "/v2/locations" });
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof SquareError).toBeTruthy();
    expect(caught instanceof SquareRateLimitError).toEqual(false);
    expect((caught as SquareError).httpStatus).toEqual(400);
    expect(isRetryableSquareError(caught)).toEqual(false);
    expect(retryAfterMsFor(caught)).toEqual(null);
  });
});

});

describe("Square client — the API version pin", () => {
  it("a malformed version falls back instead of poisoning every call", () => {
  for (const bad of ["2026-8-19", "August 2026", "20260819", "2026-08-19T00:00:00Z"]) {
    const report = inspectSquareVersion(bad);
    expect(report.ok, `"${bad}" should have been rejected`).toEqual(false);
    expect(report.version).toEqual(SQUARE_VERSION_DEFAULT);
    expect(report.warnings.length > 0, "a substituted version must be warned about").toBeTruthy();
  }
});

  it("an impossible calendar date is rejected", () => {
  const report = inspectSquareVersion("2026-02-31");
  expect(report.ok).toEqual(false);
  expect(report.version).toEqual(SQUARE_VERSION_DEFAULT);
});

  it("an unpublished future version warns but is NOT hard-failed", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const report = inspectSquareVersion("2031-01-01", now);
  expect(report.version, "a wrong pin must not take an endpoint down").toEqual("2031-01-01");
  expect(report.ok).toEqual(true);
  expect(report.warnings.some((w) => w.includes("future")), "an unpublished pin must be loud").toBeTruthy();
});

  it("a long-stale version warns", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const report = inspectSquareVersion("2019-08-15", now);
  expect(report.version).toEqual("2019-08-15");
  expect(report.warnings.length > 0).toBeTruthy();

  const prehistoric = inspectSquareVersion("2015-01-01", now);
  expect(prehistoric.warnings.some((w) => w.includes("predates"))).toBeTruthy();
});

  it("the shipped pin is clean and unset falls back silently", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const shipped = inspectSquareVersion(SQUARE_VERSION_DEFAULT, now);
  expect(shipped.ok).toEqual(true);
  expect(shipped.warnings, `the pinned default must not warn: ${shipped.warnings}`).toEqual([]);

  for (const empty of [undefined, null, "", "   "]) {
    const report = inspectSquareVersion(empty, now);
    expect(report.version).toEqual(SQUARE_VERSION_DEFAULT);
    expect(report.ok).toEqual(true);
    expect(report.warnings).toEqual([]);
  }
});

});
