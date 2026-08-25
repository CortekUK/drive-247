/**
 * Square API client — dependency-free raw fetch.
 *
 * DO NOT import the official `square` npm SDK. Three measured reasons:
 *   1. Its WebhooksHelper.verifySignature returns a Promise. A forgotten `await`
 *      silently accepts EVERY forged webhook while reading like a real check.
 *   2. Its crypto shim require()s node:crypto, unavailable in Deno's default
 *      module mode, and falls back to `window.crypto` which Deno 2 removed.
 *   3. Money amounts are BigInt, which does not JSON.stringify without a custom
 *      replacer — a footgun in every log line and every DB write.
 * Everything we need is four REST calls and ~12 lines of WebCrypto.
 *
 * MODE IS A BASE URL, NOT A KEY. This is the deepest structural difference from
 * Stripe. Square runs two physically separate environments and states that
 * credentials from one cannot be used with the other. Mode therefore fans out to
 * the base URL, access token, application id, application secret, OAuth authorize
 * URL, webhook subscription and its signature key — 8 switch points versus
 * Stripe's 1-2.
 *
 * FOUR THINGS IN HERE ARE FAILURE-MODE DECISIONS, NOT STYLE. Read them before
 * editing:
 *   - idempotency_key injection is scoped by REQUEST SHAPE and by PATH, so a
 *     credential exchange can never acquire one (see squareFetch).
 *   - verifySquareWebhook FAILS CLOSED (returns false); it never throws, because
 *     a 500 spends Square's auto-disable budget for every Square tenant at once.
 *   - every call carries a deadline, because the webhook ack budget is 10s and a
 *     hung socket has no natural end.
 *   - the pinned API version is checked at module load and warned about, never
 *     enforced, because a bad pin must degrade rather than take an endpoint down.
 */

import { SquareError, SquareMode } from "./types.ts";

/** Deno.env.get throws without --allow-env; a missing permission must not take
 *  down module load for every importer of this file. */
function readEnv(name: string): string | undefined {
  try {
    const v = Deno.env.get(name);
    return v === undefined || v === null || v.trim() === "" ? undefined : v.trim();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Pinned API version
// ---------------------------------------------------------------------------

/**
 * The version this integration was written and tested against.
 *
 * Square is date-versioned and CHANGES BEHAVIOUR PER VERSION, so leaving it
 * unpinned means a silent behaviour change on Square's schedule rather than ours.
 * The flip side is that the pin itself is now a live input: a typo (`2026-8-19`)
 * or a date Square has never published makes Square reject or silently reinterpret
 * every request, and nothing in the old code said a word about it.
 */
export const SQUARE_VERSION_DEFAULT = "2026-08-19";

/**
 * Oldest version we consider plausible. Square's first dated release is
 * 2019-08-15; anything before that is certainly a typo rather than a deliberate
 * pin to an old API.
 */
const SQUARE_VERSION_FLOOR = "2019-08-15";

/** A version dated further ahead than this has not been published yet. */
const SQUARE_VERSION_FUTURE_TOLERANCE_DAYS = 45;

/** Square deprecates dated versions roughly a year out; warn well before that. */
const SQUARE_VERSION_STALE_DAYS = 550;

export interface SquareVersionReport {
  /** The value that will actually be sent in the Square-Version header. */
  version: string;
  /** False when the configured value was unusable and the default was substituted. */
  ok: boolean;
  /** Human-readable problems. Non-empty does NOT imply the value was rejected. */
  warnings: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Validate a Square-Version pin. PURE, so it is testable without touching the
 * environment or module load order.
 *
 * A malformed value falls back to the built-in default: sending `2026-8-19`
 * guarantees a 400 on every single call, which is strictly worse than running on
 * the version this code was written against. A WELL-FORMED but implausible date
 * is used as given and merely warned about — an operator may be deliberately
 * pinning an older version during a migration, and hijacking that decision at
 * runtime would be its own outage.
 */
export function inspectSquareVersion(
  raw: string | undefined | null,
  now: Date = new Date(),
): SquareVersionReport {
  const warnings: string[] = [];
  if (raw === undefined || raw === null || raw.trim() === "") {
    return { version: SQUARE_VERSION_DEFAULT, ok: true, warnings };
  }

  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {
      version: SQUARE_VERSION_DEFAULT,
      ok: false,
      warnings: [
        `SQUARE_VERSION "${value}" is not a YYYY-MM-DD date; falling back to ${SQUARE_VERSION_DEFAULT}. ` +
          `An unparseable version header is rejected by Square on every request.`,
      ],
    };
  }

  // Date.parse accepts "2026-02-31" and rolls it over, so re-render and compare.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return {
      version: SQUARE_VERSION_DEFAULT,
      ok: false,
      warnings: [
        `SQUARE_VERSION "${value}" is not a real calendar date; falling back to ${SQUARE_VERSION_DEFAULT}.`,
      ],
    };
  }

  const ageDays = Math.floor((now.getTime() - parsed.getTime()) / DAY_MS);
  if (value < SQUARE_VERSION_FLOOR) {
    warnings.push(
      `SQUARE_VERSION "${value}" predates Square's first dated release (${SQUARE_VERSION_FLOOR}). ` +
        `This is almost certainly a typo; requests will fail.`,
    );
  } else if (ageDays < -SQUARE_VERSION_FUTURE_TOLERANCE_DAYS) {
    warnings.push(
      `SQUARE_VERSION "${value}" is ${-ageDays} days in the future — Square has not published it yet. ` +
        `Requests will fail until that date.`,
    );
  } else if (ageDays > SQUARE_VERSION_STALE_DAYS) {
    warnings.push(
      `SQUARE_VERSION "${value}" is ${ageDays} days old and is at or past Square's deprecation horizon. ` +
        `Behaviour may already differ from what this integration was tested against.`,
    );
  }

  return { version: value, ok: true, warnings };
}

/** Checked once, at module load, so a bad pin is visible in the logs of the very
 *  first invocation rather than only in a confusing 400 an hour later. */
export const SQUARE_VERSION_REPORT: SquareVersionReport = inspectSquareVersion(
  readEnv("SQUARE_VERSION"),
);

for (const warning of SQUARE_VERSION_REPORT.warnings) {
  console.error(`[square-client] ${warning}`);
}

/** Pinned API version actually sent on the wire. */
export const SQUARE_VERSION = SQUARE_VERSION_REPORT.version;

export function squareBaseUrl(mode: SquareMode): string {
  return mode === "live"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** Square's idempotency_key cap on /v2/payments is 45 chars — shorter than Stripe's 255. */
export const SQUARE_IDEMPOTENCY_MAX = 45;

/**
 * Clamp a key to Square's limit WITHOUT losing uniqueness.
 *
 * Truncation alone would collide: our natural keys share long prefixes
 * (`rental-<uuid>-installment-<n>`), so two different operations can truncate to
 * the same 45 chars and Square would return the FIRST operation's result for the
 * second — a silent wrong-amount charge. So we keep a readable prefix and append
 * a hash of the full key.
 */
export async function squareIdempotencyKey(raw: string): Promise<string> {
  if (raw.length <= SQUARE_IDEMPOTENCY_MAX) return raw;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const suffix = hex.slice(0, 16);
  return `${raw.slice(0, SQUARE_IDEMPOTENCY_MAX - suffix.length - 1)}-${suffix}`;
}

/**
 * Endpoints that REJECT or ignore `idempotency_key`.
 *
 * /oauth2/token is the one that matters: ObtainToken and the refresh grant take a
 * fixed parameter set, and the whole OAuth namespace (token, token/status,
 * revoke) is outside the idempotent-write model. An injected key there is at best
 * ignored and at worst turns a credential exchange into a 400 — and a failed
 * refresh strands a live merchant's payments 30 days later, far from the change
 * that caused it.
 */
const IDEMPOTENCY_INCAPABLE_PATH = /^\/oauth2(\/|$)/;

export function pathAcceptsIdempotencyKey(path: string): boolean {
  return !IDEMPOTENCY_INCAPABLE_PATH.test(path);
}

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

interface SquareRequestCommon {
  mode: SquareMode;
  /** Per-merchant OAuth access token. Square has no Stripe-Account header — the
   *  token IS the merchant addressing. */
  accessToken: string;
  path: string;
  /** Deadline for headers AND body. Defaults to SQUARE_DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Caller-owned cancellation, combined with the deadline above. */
  signal?: AbortSignal;
}

/**
 * A read. Structurally incapable of carrying a body or an idempotency key:
 * `fetch` throws `TypeError: Request with GET/HEAD method cannot have body`
 * (measured on Deno 1.30.3), so a GET that acquired one used to 500 the caller
 * before a single byte left the machine.
 */
export interface SquareGetRequest extends SquareRequestCommon {
  method: "GET";
  body?: never;
  idempotencyKey?: never;
}

/** A write. The only shape that can request idempotency-key injection. */
export interface SquareWriteRequest extends SquareRequestCommon {
  method: "POST" | "PUT" | "DELETE";
  body?: unknown;
  /**
   * THE INJECTION SWITCH — explicit, opt-in, and expressible nowhere else.
   *
   * Setting this (and only this) adds `idempotency_key` to the JSON body. It was
   * previously inferred from "has a body and has a key", which meant any future
   * OAuth caller that happened to pass one would silently corrupt a token
   * request. Requests on idempotency-incapable paths drop it (loudly) rather
   * than throw — see squareFetch.
   */
  idempotencyKey?: string;
}

export type SquareRequest = SquareGetRequest | SquareWriteRequest;

// ---------------------------------------------------------------------------
// Deadlines and rate limiting
// ---------------------------------------------------------------------------

/**
 * Square's webhook ack budget is 10 SECONDS; a non-2xx or a timeout counts
 * against the auto-disable budget that kills the subscription for EVERY Square
 * tenant at once. The old client had no deadline at all, so one hung socket held
 * the invocation until the platform killed it — the worst possible shape of
 * failure, because it is indistinguishable from a crash and produces no log.
 */
export const SQUARE_DEFAULT_TIMEOUT_MS = 6_000;

/** For calls made while a webhook ack is outstanding — leaves room to respond. */
export const SQUARE_WEBHOOK_TIMEOUT_MS = 3_000;

const SQUARE_MIN_TIMEOUT_MS = 500;
const SQUARE_MAX_TIMEOUT_MS = 30_000;

/**
 * Backoff to advertise when Square rate-limits us WITHOUT a Retry-After header.
 *
 * Square publishes no rate-limit numbers and sends no X-RateLimit-* headers, so
 * there is nothing to compute from. Guessing low turns one 429 into a burst of
 * them; the conservative direction is the safe one.
 */
export const SQUARE_FALLBACK_RETRY_AFTER_MS = 5_000;

function resolveTimeoutMs(requested?: number): number {
  const envValue = readEnv("SQUARE_TIMEOUT_MS");
  const envMs = envValue === undefined ? undefined : Number(envValue);
  const candidate = requested ??
    (envMs !== undefined && Number.isFinite(envMs) && envMs > 0 ? envMs : SQUARE_DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(candidate) || candidate <= 0) return SQUARE_DEFAULT_TIMEOUT_MS;
  return Math.min(SQUARE_MAX_TIMEOUT_MS, Math.max(SQUARE_MIN_TIMEOUT_MS, Math.round(candidate)));
}

/** `Retry-After` is either delta-seconds or an HTTP-date. Both appear in the wild. */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) return null;
    return Math.min(SQUARE_MAX_TIMEOUT_MS * 2, Math.max(0, seconds * 1000));
  }

  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.min(SQUARE_MAX_TIMEOUT_MS * 2, Math.max(0, when - Date.now()));
}

/**
 * A 429. Distinct from a generic SquareError because the correct response is
 * different in kind: a rate limit is a "come back later", not a "this failed".
 * Still a SquareError, so every existing `catch (err) { if (err instanceof
 * SquareError) ... }` in the adapter keeps working unchanged.
 */
export class SquareRateLimitError extends SquareError {
  readonly retryable = true;
  constructor(
    message: string,
    category: string,
    code: string,
    /** Honoured from Retry-After when Square sends one, else a conservative default. */
    readonly retryAfterMs: number,
    raw?: unknown,
  ) {
    super(message, category, code, 429, raw);
    this.name = "SquareRateLimitError";
  }
}

/** The deadline fired. Retryable: nothing says the request failed, only that we
 *  stopped waiting — which is exactly why a caller must not treat it as "no charge
 *  was made" without checking. */
export class SquareTimeoutError extends SquareError {
  readonly retryable = true;
  constructor(readonly timeoutMs: number, method: string, path: string) {
    super(
      `Square ${method} ${path} exceeded its ${timeoutMs}ms deadline`,
      "TIMEOUT",
      "REQUEST_TIMEOUT",
      504,
      null,
    );
    this.name = "SquareTimeoutError";
  }
}

/** True for failures where retrying later is meaningful. */
export function isRetryableSquareError(err: unknown): boolean {
  if (err instanceof SquareRateLimitError || err instanceof SquareTimeoutError) return true;
  return err instanceof SquareError && err.httpStatus >= 500;
}

/** Suggested wait before a retry, or null when retrying is pointless. */
export function retryAfterMsFor(err: unknown): number | null {
  if (err instanceof SquareRateLimitError) return err.retryAfterMs;
  if (isRetryableSquareError(err)) return SQUARE_FALLBACK_RETRY_AFTER_MS;
  return null;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * Build the JSON body actually sent.
 *
 * PRECEDENCE IS EXPLICIT AND DELIBERATE: the request-level `idempotencyKey` WINS
 * over an `idempotency_key` already present in the body. It used to lose — the
 * old spread was `{ idempotency_key, ...body }` — which meant a stray body key
 * silently defeated the clamped, collision-proof key from squareIdempotencyKey()
 * and could exceed Square's 45-char cap on a money path. The request field is the
 * sanctioned channel; anything else is a mistake, and it is logged as one.
 */
function buildPayload(req: SquareRequest): unknown {
  // Destructured up front: inside a `method === 'GET'` narrowing, `body?: never`
  // collapses the whole request object to `never` and even `req.path` stops
  // typechecking.
  const { method, path } = req;
  const body: unknown = (req as SquareWriteRequest).body;
  const key = (req as SquareWriteRequest).idempotencyKey;

  if (method === "GET") {
    if (body !== undefined) {
      // Only reachable through a cast — the type forbids it. Drop rather than let
      // fetch throw TypeError before the request exists.
      console.error(
        `[square-client] dropping body on GET ${path}; Square reads take query params, not bodies`,
      );
    }
    return undefined;
  }

  if (key === undefined || key === "") return body;

  if (!pathAcceptsIdempotencyKey(path)) {
    // Never throw: this path is OAuth, there is no money on it, and a live token
    // refresh must not die because a caller passed an irrelevant argument.
    console.error(
      `[square-client] refusing to inject idempotency_key into ${path}; ` +
        `Square's OAuth endpoints do not accept one and it would corrupt the credential exchange`,
    );
    return body;
  }

  if (body === undefined) return { idempotency_key: key };

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    // A money-path write asked for idempotency and we cannot honour it. Dropping
    // it silently is how double charges happen, so this one DOES throw.
    throw new SquareError(
      `Cannot inject idempotency_key into a non-object body for ${method} ${path}`,
      "CLIENT_MISUSE",
      "IDEMPOTENCY_BODY_NOT_OBJECT",
      0,
      null,
    );
  }

  const fields = body as Record<string, unknown>;
  if ("idempotency_key" in fields && fields.idempotency_key !== key) {
    console.warn(
      `[square-client] body.idempotency_key on ${path} overridden by the request-level key`,
    );
  }
  return { ...fields, idempotency_key: key };
}

interface RawResult {
  res: Response;
  text: string;
}

/** fetch + body read under ONE deadline. Aborting after the response resolves but
 *  before the body is read would leave a half-consumed stream, so the timer spans
 *  both and is cleared in `finally` (a leaked timer holds the isolate open). */
async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  method: string,
  path: string,
  external?: AbortSignal,
): Promise<RawResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let forward: (() => void) | undefined;
  if (external) {
    if (external.aborted) controller.abort();
    else {
      forward = () => controller.abort();
      external.addEventListener("abort", forward, { once: true });
    }
  }

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    if (timedOut) throw new SquareTimeoutError(timeoutMs, method, path);
    throw err;
  } finally {
    clearTimeout(timer);
    if (forward && external) external.removeEventListener("abort", forward);
  }
}

/**
 * One Square API call.
 *
 * Errors: Square returns `{ errors: [{ category, code, detail }] }`, structurally
 * unlike Stripe's single error object. We surface category+code rather than
 * flattening to a string so callers can branch on RATE_LIMITED / UNAUTHORIZED
 * without substring matching. A 429 additionally arrives as SquareRateLimitError
 * carrying a wait, and a blown deadline as SquareTimeoutError — both still
 * `instanceof SquareError`, so existing catch blocks are unaffected.
 */
export async function squareFetch<T = unknown>(req: SquareRequest): Promise<T> {
  const url = `${squareBaseUrl(req.mode)}${req.path}`;
  const headers: Record<string, string> = {
    "Square-Version": SQUARE_VERSION,
    "Authorization": `Bearer ${req.accessToken}`,
    "Content-Type": "application/json",
  };

  const payload = buildPayload(req);
  const timeoutMs = resolveTimeoutMs(req.timeoutMs);

  const { res, text } = await fetchWithDeadline(
    url,
    {
      method: req.method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    },
    timeoutMs,
    req.method,
    req.path,
    req.signal,
  );

  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const first = (parsed as { errors?: Array<Record<string, string>> })?.errors?.[0];
    const category = first?.category ?? "UNKNOWN";
    const code = first?.code ?? String(res.status);
    const message = first?.detail ?? `Square ${req.method} ${req.path} failed with ${res.status}`;

    if (res.status === 429 || code === "RATE_LIMITED" || category === "RATE_LIMIT_ERROR") {
      const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after")) ??
        SQUARE_FALLBACK_RETRY_AFTER_MS;
      throw new SquareRateLimitError(message, category, code, retryAfterMs, parsed ?? text);
    }

    throw new SquareError(message, category, code, res.status, parsed ?? text);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

/**
 * Verify a Square webhook signature.
 *
 * CRITICAL DIFFERENCE FROM STRIPE: Square signs `notification_url + raw_body`,
 * so the URL the request arrived at is part of the signed message. The URL must
 * be the EXACT string registered on the subscription — a trailing slash, a
 * different host, or a proxy rewrite all produce a valid-looking mismatch.
 *
 * The signature key is used as a raw UTF-8 string and is NOT base64-decoded
 * first. A widely-repeated forum answer says otherwise; that answer concerns the
 * deprecated SHA-1 `x-square-signature` scheme, not this one.
 *
 * There is no timestamp in the signature, so unlike Stripe there is NO replay
 * window. Replay protection must come from event-id dedupe, not from this check.
 *
 * FAILS CLOSED, NEVER THROWS. crypto.subtle.importKey('raw', <empty>) rejects
 * with `DataError: Key length is zero` (measured, Deno 1.30.3). Letting that
 * escape means one blank SQUARE_*_WEBHOOK_SIGNATURE_KEY answers 500 to every
 * event for every Square tenant — and ~3 weeks of non-2xx makes Square disable
 * the shared subscription. A signature we cannot check is a signature that did
 * not verify, which is `false`, plus a log line.
 */
export async function verifySquareWebhook(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  if (typeof signatureKey !== "string" || signatureKey.length === 0) {
    console.error(
      "[square-client] webhook signature key is empty or unset; failing verification closed",
    );
    return false;
  }
  if (!notificationUrl) {
    console.error(
      "[square-client] webhook notification URL is empty; the signed message cannot be reconstructed",
    );
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(signatureKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(notificationUrl + rawBody),
    );
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return timingSafeEqual(expected, signatureHeader);
  } catch (err) {
    // Unusable key material, a WebCrypto quirk, anything at all: the answer is
    // still "not verified". The key itself is never logged.
    console.error(
      "[square-client] webhook signature verification failed to run:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/** Constant-time compare — a plain === leaks the signature one byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
