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
 */

import { SquareError, SquareMode } from "./types.ts";

/**
 * Pinned API version. Square is date-versioned; leaving it unpinned means a
 * silent behaviour change on Square's schedule rather than ours.
 */
export const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") ?? "2026-08-19";

export function squareBaseUrl(mode: SquareMode): string {
  return mode === "live"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

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

export interface SquareRequest {
  mode: SquareMode;
  /** Per-merchant OAuth access token. Square has no Stripe-Account header — the
   *  token IS the merchant addressing. */
  accessToken: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

/**
 * One Square API call.
 *
 * Errors: Square returns `{ errors: [{ category, code, detail }] }`, structurally
 * unlike Stripe's single error object. We surface category+code rather than
 * flattening to a string so callers can branch on RATE_LIMITED / UNAUTHORIZED
 * without substring matching.
 */
export async function squareFetch<T = unknown>(req: SquareRequest): Promise<T> {
  const url = `${squareBaseUrl(req.mode)}${req.path}`;
  const headers: Record<string, string> = {
    "Square-Version": SQUARE_VERSION,
    "Authorization": `Bearer ${req.accessToken}`,
    "Content-Type": "application/json",
  };

  const payload = req.idempotencyKey && req.body && typeof req.body === "object"
    ? { idempotency_key: req.idempotencyKey, ...(req.body as Record<string, unknown>) }
    : req.body;

  const res = await fetch(url, {
    method: req.method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const first = (parsed as { errors?: Array<Record<string, string>> })?.errors?.[0];
    throw new SquareError(
      first?.detail ?? `Square ${req.method} ${req.path} failed with ${res.status}`,
      first?.category ?? "UNKNOWN",
      first?.code ?? String(res.status),
      res.status,
      parsed ?? text,
    );
  }
  return parsed as T;
}

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
 */
export async function verifySquareWebhook(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
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
}

/** Constant-time compare — a plain === leaks the signature one byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
