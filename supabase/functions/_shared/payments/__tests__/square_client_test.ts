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

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

import { SquareError } from "../types.ts";
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
} from "../square-client.ts";

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
Deno.test("defect 1: /oauth2/token never receives an injected idempotency_key", async () => {
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
      assertEquals(
        body.idempotency_key,
        undefined,
        "an injected idempotency_key corrupts Square's ObtainToken request",
      );
      // The rest of the credential exchange must survive intact.
      assertEquals(body.grant_type, "refresh_token");
      assertEquals(body.client_secret, "secret");
    });

    assert(
      lines.some((l) => l.includes("refusing to inject idempotency_key")),
      "the refusal must be logged, not silent",
    );
  });
});

Deno.test("defect 1: the whole /oauth2 namespace is idempotency-incapable", async () => {
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
        assertEquals(sentBody(captured)?.idempotency_key, undefined, `leaked into ${path}`);
      });
    }
  });
});

/** A real money write still gets its key — the fix must not disarm idempotency. */
Deno.test("defect 1: money writes DO still get the idempotency_key", async () => {
  await withFetch(() => ok({ payment_link: { id: "pl_1" } }), async (captured) => {
    await squareFetch({
      mode: "test",
      accessToken: "t",
      method: "POST",
      path: "/v2/online-checkout/payment-links",
      idempotencyKey: "chk-abc",
      body: { quick_pay: { name: "Rental" } },
    });
    assertEquals(sentBody(captured)?.idempotency_key, "chk-abc");
  });
});

/**
 * BEFORE: `SquareRequest` was one interface where every method could carry a
 * body, so this line compiled — and `fetch` then threw
 * `TypeError: Request with GET/HEAD method cannot have body` (measured on Deno
 * 1.30.3) before a byte left the machine. With the union, the @ts-expect-error
 * is required; without it, this file does not typecheck.
 */
Deno.test("defect 1: a GET cannot express a body at all (compile-time)", () => {
  // @ts-expect-error - a GET request must not be able to carry a body
  const req: SquareRequest = {
    mode: "test",
    accessToken: "t",
    method: "GET",
    path: "/v2/locations",
    body: { nope: true },
  };
  assertEquals(req.method, "GET");
});

/** ...and if one arrives anyway through a cast, it is dropped, not thrown. */
Deno.test("defect 1: a cast-in GET body is dropped rather than crashing fetch", async () => {
  await withCapturedLogs(async () => {
    await withFetch(() => ok({ locations: [] }), async (captured) => {
      await squareFetch({
        mode: "test",
        accessToken: "t",
        method: "GET",
        path: "/v2/locations",
        body: { smuggled: true },
      } as unknown as SquareRequest);
      assertEquals(captured[0].init.body, undefined, "a GET must reach fetch with no body");
    });
  });
});

// ---------------------------------------------------------------------------
// Precedence — which idempotency_key wins
// ---------------------------------------------------------------------------

/**
 * BEFORE: `{ idempotency_key: key, ...body }` — the BODY won, so a stray key in
 * the body silently defeated the clamped, collision-proof key from
 * squareIdempotencyKey() and could blow Square's 45-char cap on a money path.
 * The request-level field is the sanctioned channel and now wins.
 */
Deno.test("precedence: the request-level idempotency key beats a body key", async () => {
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
      assertEquals(sentBody(captured)?.idempotency_key, "rfnd-authoritative");
      assertEquals(sentBody(captured)?.payment_id, "p1");
    });
    assert(
      lines.some((l) => l.includes("overridden by the request-level key")),
      "silently overriding a caller's key would be its own defect",
    );
  });
});

Deno.test("precedence: a write with a key and no body still sends the key", async () => {
  await withFetch(() => ok({}), async (captured) => {
    await squareFetch({
      mode: "test",
      accessToken: "t",
      method: "POST",
      path: "/v2/refunds",
      idempotencyKey: "k1",
    });
    assertEquals(sentBody(captured)?.idempotency_key, "k1");
  });
});

Deno.test("precedence: a non-object body with a key throws instead of dropping it", async () => {
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
    assert(caught instanceof SquareError, "dropping idempotency on a money path must be loud");
    assertEquals((caught as SquareError).code, "IDEMPOTENCY_BODY_NOT_OBJECT");
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2 — the webhook verifier must fail closed, never throw
// ---------------------------------------------------------------------------

/**
 * BEFORE: crypto.subtle.importKey('raw', <empty>) rejects with
 * `DataError: Key length is zero`, and that rejection escaped. One blank
 * SQUARE_*_WEBHOOK_SIGNATURE_KEY therefore answered 500 to every event for every
 * Square tenant — and ~3 weeks of non-2xx makes Square disable the subscription.
 */
Deno.test("defect 2: an empty signature key returns false, it does not throw", async () => {
  await withCapturedLogs(async (lines) => {
    const url = "https://example.supabase.co/functions/v1/square-webhook";
    const body = JSON.stringify({ type: "payment.updated" });

    assertEquals(await verifySquareWebhook("", url, body, "c2ln"), false);
    assert(
      lines.some((l) => l.includes("empty or unset")),
      "a mis-set secret must be visible in the logs",
    );
  });
});

Deno.test("defect 2: an unset/undefined key and an empty URL also fail closed", async () => {
  await withCapturedLogs(async () => {
    const url = "https://example.supabase.co/functions/v1/square-webhook";
    assertEquals(
      await verifySquareWebhook(undefined as unknown as string, url, "{}", "c2ln"),
      false,
    );
    // An empty notification URL cannot reconstruct the signed message either.
    assertEquals(await verifySquareWebhook("key", "", "{}", "c2ln"), false);
  });
});

/** The happy path must be untouched by the fail-closed guards. */
Deno.test("defect 2: a genuine signature still verifies", async () => {
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
  assertEquals(await verifySquareWebhook(key, url, body, sig), true);
  assertEquals(await verifySquareWebhook(key, url, body, "AAAA"), false);
});

// ---------------------------------------------------------------------------
// DEFECT 3 — deadlines and 429s
// ---------------------------------------------------------------------------

/**
 * BEFORE: no AbortController anywhere, so this call hung until the platform
 * killed the invocation — indistinguishable from a crash, and fatal against a
 * 10s webhook ack budget. Against the old client this test sat for the stub's
 * full 1500ms and then failed on "expected a deadline error".
 */
Deno.test("defect 3: a hung Square call is aborted at its deadline", async () => {
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

    assert(caught instanceof SquareError, `expected a deadline error, got ${caught}`);
    assertStringIncludes((caught as Error).message, "deadline");
    assert(caught instanceof SquareTimeoutError);
    assert(elapsed < 1400, `deadline did not fire: waited ${elapsed}ms`);
  });
});

Deno.test("defect 3: a timeout is classed retryable", () => {
  const err = new SquareTimeoutError(500, "GET", "/v2/locations");
  assert(err instanceof SquareError, "existing `instanceof SquareError` catches must still fire");
  assertEquals(isRetryableSquareError(err), true);
  assertEquals(err.httpStatus, 504);
});

/**
 * BEFORE: a 429 was flattened into a generic SquareError with no wait attached,
 * so `retryAfterMs` was undefined and no caller could back off correctly.
 */
Deno.test("defect 3: a 429 surfaces as a distinct retryable error honouring Retry-After", async () => {
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
    assert(caught instanceof SquareError, "must stay instanceof SquareError for existing catches");
    assertEquals((caught as { retryAfterMs?: number }).retryAfterMs, 2000);
    assert(caught instanceof SquareRateLimitError);
    assertEquals((caught as SquareRateLimitError).category, "RATE_LIMIT_ERROR");
    assertEquals(isRetryableSquareError(caught), true);
  });
});

Deno.test("defect 3: a 429 with no Retry-After backs off conservatively", async () => {
  const stub = () =>
    Promise.resolve(new Response(JSON.stringify({ errors: [] }), { status: 429 }));

  await withFetch(stub, async () => {
    let caught: unknown;
    try {
      await squareFetch({ mode: "test", accessToken: "t", method: "GET", path: "/v2/locations" });
    } catch (err) {
      caught = err;
    }
    assert(caught instanceof SquareRateLimitError);
    // Square publishes no rate-limit numbers, so the fallback must not be tiny.
    assertEquals((caught as SquareRateLimitError).retryAfterMs, SQUARE_FALLBACK_RETRY_AFTER_MS);
    assert(SQUARE_FALLBACK_RETRY_AFTER_MS >= 1000);
  });
});

Deno.test("defect 3: Retry-After accepts both delta-seconds and an HTTP-date", () => {
  assertEquals(parseRetryAfterMs("3"), 3000);
  assertEquals(parseRetryAfterMs(null), null);
  assertEquals(parseRetryAfterMs("   "), null);
  assertEquals(parseRetryAfterMs("not-a-date"), null);
  const soon = new Date(Date.now() + 4000).toUTCString();
  const ms = parseRetryAfterMs(soon);
  assert(ms !== null && ms > 1000 && ms <= 5000, `unexpected http-date backoff: ${ms}`);
});

Deno.test("defect 3: a 4xx that is NOT a rate limit stays a plain SquareError", async () => {
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
    assert(caught instanceof SquareError);
    assertEquals(caught instanceof SquareRateLimitError, false);
    assertEquals((caught as SquareError).httpStatus, 400);
    assertEquals(isRetryableSquareError(caught), false);
    assertEquals(retryAfterMsFor(caught), null);
  });
});

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
Deno.test("defect 4: a malformed version falls back instead of poisoning every call", () => {
  for (const bad of ["2026-8-19", "August 2026", "20260819", "2026-08-19T00:00:00Z"]) {
    const report = inspectSquareVersion(bad);
    assertEquals(report.ok, false, `"${bad}" should have been rejected`);
    assertEquals(report.version, SQUARE_VERSION_DEFAULT);
    assert(report.warnings.length > 0, "a substituted version must be warned about");
  }
});

Deno.test("defect 4: an impossible calendar date is rejected", () => {
  const report = inspectSquareVersion("2026-02-31");
  assertEquals(report.ok, false);
  assertEquals(report.version, SQUARE_VERSION_DEFAULT);
});

Deno.test("defect 4: an unpublished future version warns but is NOT hard-failed", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const report = inspectSquareVersion("2031-01-01", now);
  assertEquals(report.version, "2031-01-01", "a wrong pin must not take an endpoint down");
  assertEquals(report.ok, true);
  assert(report.warnings.some((w) => w.includes("future")), "an unpublished pin must be loud");
});

Deno.test("defect 4: a long-stale version warns", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const report = inspectSquareVersion("2019-08-15", now);
  assertEquals(report.version, "2019-08-15");
  assert(report.warnings.length > 0);

  const prehistoric = inspectSquareVersion("2015-01-01", now);
  assert(prehistoric.warnings.some((w) => w.includes("predates")));
});

Deno.test("defect 4: the shipped pin is clean and unset falls back silently", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const shipped = inspectSquareVersion(SQUARE_VERSION_DEFAULT, now);
  assertEquals(shipped.ok, true);
  assertEquals(shipped.warnings, [], `the pinned default must not warn: ${shipped.warnings}`);

  for (const empty of [undefined, null, "", "   "]) {
    const report = inspectSquareVersion(empty, now);
    assertEquals(report.version, SQUARE_VERSION_DEFAULT);
    assertEquals(report.ok, true);
    assertEquals(report.warnings, []);
  }
});
