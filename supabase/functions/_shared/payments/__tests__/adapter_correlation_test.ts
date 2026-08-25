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

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

import {
  buildSquarePaymentNote,
  createSquareCheckout,
  refundSquarePayment,
  SQUARE_NOTE_PREFIX,
  SQUARE_PAYMENT_NOTE_MAX,
  type SquareCheckoutSpec,
} from "../square-adapter.ts";
import { SQUARE_IDEMPOTENCY_MAX } from "../square-client.ts";
import type { ProviderResolution } from "../types.ts";

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
    assert(!out.error, `expected a served checkout, got: ${JSON.stringify(out.body)}`);
    assertEquals(cap.calls.length, 1, "exactly one Square call per checkout");
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
  assert(typeof key === "string" && key.length > 0, "every payment link must carry an idempotency key");
  return key as string;
}

// ---------------------------------------------------------------------------
// DEFECT 1 — correlation
// ---------------------------------------------------------------------------

Deno.test("correlation: quick_pay carries ONLY the three fields Square documents", async () => {
  // Verified against https://developer.squareup.com/reference/square/objects/QuickPay
  // Adding reference_id or metadata here is a 400, not a richer correlation — and
  // `order` is mutually exclusive with quick_pay, so it cannot be smuggled in.
  const body = await checkoutBody(BASE_SPEC);
  const quickPay = body.quick_pay as Record<string, unknown>;
  assertEquals(Object.keys(quickPay).sort(), ["location_id", "name", "price_money"]);
  assertEquals(quickPay.reference_id, undefined, "QuickPay has no reference_id field");
  assertEquals(quickPay.metadata, undefined, "QuickPay has no metadata field");
  assertEquals(body.order, undefined, "order is mutually exclusive with quick_pay");
});

Deno.test("correlation: the FULL reference reaches payment_note — no 40-char truncation", async () => {
  // THE REGRESSION. `payment_note` was clamped with capabilities.maxReferenceIdChars
  // (40), which belongs to ORDER.reference_id. This reference is 48 chars, so the
  // old code shipped a truncated id that still parsed as an id.
  const longReference = "rental-22222222-2222-2222-2222-222222222222-payg";
  assertEquals(longReference.length, 48, "the fixture must exceed the old 40-char clamp");

  const body = await checkoutBody({ ...BASE_SPEC, reference: { paymentId: longReference } });
  const note = String(body.payment_note ?? "");

  assert(note.includes(longReference), `payment_note lost part of the reference: ${note}`);
  assert(note.startsWith(SQUARE_NOTE_PREFIX), "the note is human-readable in the Square dashboard");
  assert(note.length <= SQUARE_PAYMENT_NOTE_MAX, "payment_note's own limit is 500");
  // The old behaviour, pinned so nobody reinstates it.
  assertNotEquals(note, longReference.slice(0, 40));
});

Deno.test("correlation: order_id is returned as the column the caller must persist", async () => {
  // PRIMARY correlation. At the moment the buyer pays we do not yet know the
  // square_payment_id, so square_order_id is the ONLY column square-webhook can
  // match on. If the caller does not write it, the collection lands as
  // "no local payments row" and the money is stranded.
  const cap = captureFetch();
  try {
    const out = await createSquareCheckout(stubSupabase(connectionRow()), RESOLUTION, BASE_SPEC);
    assertEquals(out.handled, true);
    assert(!out.error);
    const body = out.body!;
    assertEquals(body.squareOrderId, "ORDER_1", "named for the payments column it belongs in");
    assertEquals(body.orderId, "ORDER_1", "legacy field kept for callers already reading it");
    assertEquals((body.persist as Record<string, unknown>).square_order_id, "ORDER_1");
    assertEquals(body.url, "https://sq.link/PL_1");
  } finally {
    cap.restore();
  }
});

Deno.test("correlation: the returned referenceId is the full value, never a truncation", async () => {
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
    assertEquals(out.body!.referenceId, longReference);
  } finally {
    cap.restore();
  }
});

Deno.test("correlation: buildSquarePaymentNote clamps to 500, not to 40", () => {
  const huge = "x".repeat(900);
  const note = buildSquarePaymentNote(huge);
  assertEquals(note.length, SQUARE_PAYMENT_NOTE_MAX);
  assert(note.length > 40, "the old clamp would have produced 40 chars");
});

// ---------------------------------------------------------------------------
// DEFECT 2 — checkout idempotency
// ---------------------------------------------------------------------------

Deno.test("idempotency: a TRUE retry of the same money de-duplicates", async () => {
  const a = await idempotencyKeyFor(BASE_SPEC);
  const b = await idempotencyKeyFor(BASE_SPEC);
  assertEquals(a, b, "same reference + same amount + same currency must reuse the key");
});

Deno.test("idempotency: a CORRECTED amount mints a new key", async () => {
  // THE REGRESSION. With `chk-${paymentId}` both calls produced one key, so the
  // corrected link came back as 400 IDEMPOTENCY_KEY_REUSED — permanently, since
  // the key never varies. Nothing about that reference could ever be charged again.
  const original = await idempotencyKeyFor(BASE_SPEC);
  const corrected = await idempotencyKeyFor({ ...BASE_SPEC, amountCents: 7500 });
  assertNotEquals(original, corrected, "a changed amount MUST mint a new idempotency key");
});

Deno.test("idempotency: a different currency mints a new key", async () => {
  const gbp = await idempotencyKeyFor(BASE_SPEC, connectionRow());
  const usd = await idempotencyKeyFor(
    { ...BASE_SPEC, currency: "usd" },
    connectionRow({ location_currency: "USD" }),
  );
  assertNotEquals(gbp, usd);
});

Deno.test("idempotency: currency CASE is not a difference", async () => {
  const lower = await idempotencyKeyFor({ ...BASE_SPEC, currency: "gbp" });
  const upper = await idempotencyKeyFor({ ...BASE_SPEC, currency: "GBP" });
  assertEquals(lower, upper, "'gbp' and 'GBP' are the same money and must share a key");
});

Deno.test("idempotency: idempotencyScope separates two charges that share reference AND amount", async () => {
  // The residual collision the amount cannot break: two identical weekly PAYG
  // collections on one rental. Reachable because create-checkout-session passes a
  // RENTAL id as reference.paymentId.
  const first = await idempotencyKeyFor({ ...BASE_SPEC, idempotencyScope: "accrual-1" });
  const second = await idempotencyKeyFor({ ...BASE_SPEC, idempotencyScope: "accrual-2" });
  assertNotEquals(first, second, "a row-unique scope must break the collision");

  const retryOfFirst = await idempotencyKeyFor({ ...BASE_SPEC, idempotencyScope: "accrual-1" });
  assertEquals(first, retryOfFirst, "a scoped retry still de-duplicates");
});

Deno.test("idempotency: an EMPTY reference never collapses two charges into one link", async () => {
  // create-checkout-session passes String(referenceId ?? ''), so '' is reachable.
  // A stable key would make every equal-amount charge share `chk--GBP-5000`.
  // A spare unpaid payment link is recoverable; a collapsed link is a lost collection.
  const spec = { ...BASE_SPEC, reference: { paymentId: "" } };
  const a = await idempotencyKeyFor(spec);
  const b = await idempotencyKeyFor(spec);
  assertNotEquals(a, b, "with no identity at all, uniqueness beats de-duplication");
});

Deno.test("idempotency: the key respects Square's length ceiling", async () => {
  const key = await idempotencyKeyFor({
    ...BASE_SPEC,
    reference: { paymentId: "r".repeat(200) },
    idempotencyScope: "s".repeat(200),
  });
  // squareIdempotencyKey hashes rather than truncates, so long inputs stay unique.
  // Asserted against the exported constant, not a literal, so this test tracks
  // square-client.ts rather than duplicating its number.
  assert(key.length <= SQUARE_IDEMPOTENCY_MAX, `idempotency key too long: ${key.length}`);

  const other = await idempotencyKeyFor({
    ...BASE_SPEC,
    reference: { paymentId: "r".repeat(200) },
    idempotencyScope: "s".repeat(199) + "t",
  });
  assertNotEquals(key, other, "hashing must not collapse two long, distinct keys");
});

// ---------------------------------------------------------------------------
// DEFECT 3 — one currency policy, applied to both money paths
// ---------------------------------------------------------------------------

Deno.test("currency: checkout sends the LOCATION's currency, not the caller's casing", async () => {
  const body = await checkoutBody(BASE_SPEC);
  const money = (body.quick_pay as Record<string, unknown>).price_money as Record<string, unknown>;
  assertEquals(money.currency, "GBP");
  assertEquals(money.amount, 5000);
});

Deno.test("currency: a MISMATCH fails pre-flight, before any Square call", async () => {
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
    assertEquals(cap.calls.length, 0, "a known-bad currency must never reach Square");
    assertEquals(out.handled, true);
    assertEquals(out.error, true, "this is a failure, not a success-shaped skip");
    assertEquals(out.skipped, undefined);
    assertEquals(out.reason, "square_currency_mismatch");
    assertEquals(out.httpStatus, 409);
    assertEquals(out.body!.requested, "USD");
    assertEquals(out.body!.locationCurrency, "GBP");
  } finally {
    cap.restore();
  }
});

Deno.test("currency: an unknown location currency FAILS on checkout", async () => {
  const cap = captureFetch();
  try {
    const out = await createSquareCheckout(
      stubSupabase(connectionRow({ location_currency: null })),
      RESOLUTION,
      BASE_SPEC,
    );
    assertEquals(cap.calls.length, 0);
    assertEquals(out.error, true);
    assertEquals(out.reason, "square_location_currency_unknown");
    assertEquals(out.httpStatus, 409);
  } finally {
    cap.restore();
  }
});

Deno.test("currency: an unknown location currency FAILS on refund too — one policy", async () => {
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
    assertEquals(cap.calls.length, 0);
    assertEquals(out.error, true, "a refund that did not happen must not report success");
    assertEquals(out.skipped, undefined);
    assertEquals(out.reason, "square_location_currency_unknown");
    assertEquals(out.httpStatus, 409);
  } finally {
    cap.restore();
  }
});

Deno.test("currency: refund sends the location currency and the real MAJOR-unit amount", async () => {
  const cap = captureFetch({ refund: { id: "RFND_1", status: "PENDING" } });
  try {
    const out = await refundSquarePayment(
      stubSupabase(connectionRow({ location_currency: "GBP" })),
      RESOLUTION,
      // The real payments row shape: amount numeric in MAJOR units, no currency column.
      { paymentRecord: { id: "p1", payment_provider: "square", square_payment_id: "sqpmt_1", amount: 125.50 } },
    );
    assertEquals(cap.calls.length, 1);
    const money = cap.calls[0].body.amount_money as Record<string, unknown>;
    assertEquals(money, { amount: 12550, currency: "GBP" });
    assertEquals(out.body!.currency, "GBP");
    // A Square refund lands PENDING and settles via refund.updated.
    assertEquals(out.body!.status, "Pending");
    assertEquals(out.body!.settlesAsynchronously, true);
  } finally {
    cap.restore();
  }
});

Deno.test("currency: checkout and refund agree by construction on the same connection", async () => {
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

  assertEquals(checkoutCurrency, refundCurrency, "the two money paths must never disagree on currency");
  assertEquals(checkoutCurrency, "EUR");
});
