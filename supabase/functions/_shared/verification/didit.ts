// feat-003: Didit, the free standard check (spec 07). One Drive247 account for every company (D21).
// The key is read here only, inside edge functions, and never returned or logged (spec 07.5).

const BASE = "https://verification.didit.me";

export interface DiditSession {
  session_id: string;
  url: string;
  status: string;
  expires_at?: string;
}

export class DiditUnavailable extends Error {}

function apiKey(): string {
  const key = Deno.env.get("DIDIT_API_KEY");
  if (!key) throw new DiditUnavailable("Didit is not set up on this server");
  return key;
}

export function workflowId(): string {
  const id = Deno.env.get("DIDIT_WORKFLOW_ID");
  if (!id) throw new DiditUnavailable("Didit workflow is not set up on this server");
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A call to Didit, retrying a 429 after Retry-After: at most 3 tries and 10 seconds in all (spec 07.4). */
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "x-api-key": apiKey(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.status !== 429) return { status: res.status, data };
    const wait = Math.min(Number(res.headers.get("retry-after") ?? "1") * 1000, 5000);
    if (attempt >= 3 || Date.now() - started + wait > 10_000) {
      throw new DiditUnavailable("Didit is busy, try again in a minute");
    }
    await sleep(wait);
  }
}

export interface CreateSessionInput {
  sessionId: string;      // our session id: Didit's vendor_data (spec 07.2)
  tenantId: string;       // multi_account_segment: duplicate faces are compared inside one company
  customerId: string;
  callback: string;
  secondsLeft: number;    // until our own expiry; Didit accepts 3600 to 2419200
  language?: string;
  /** Test outcome. Only ever sent with a sandbox key (sk_test_); ignored on live. */
  sandboxScenario?: string;
}

export function isSandbox(): boolean {
  return (Deno.env.get("DIDIT_API_KEY") ?? "").startsWith("sk_test_");
}

export async function createSession(input: CreateSessionInput): Promise<DiditSession> {
  const { status, data } = await call("POST", "/v3/session/", {
    workflow_id: workflowId(),
    vendor_data: input.sessionId,
    multi_account_segment: input.tenantId,
    metadata: { tenant_id: input.tenantId, customer_id: input.customerId, session_id: input.sessionId },
    callback: input.callback,
    session_expiration_time: Math.max(3600, Math.min(2419200, Math.floor(input.secondsLeft))),
    ...(input.language ? { language: input.language } : {}),
    ...(input.sandboxScenario && isSandbox() ? { sandbox_scenario: input.sandboxScenario } : {}),
  });
  if (status !== 200 && status !== 201) {
    console.error("[didit] create session failed", status, typeof data === "string" ? data.slice(0, 200) : data?.detail);
    throw new DiditUnavailable("Didit could not start the check");
  }
  return { session_id: data.session_id, url: data.url, status: data.status, expires_at: data.expires_at };
}

export async function getDecision(diditSessionId: string): Promise<any | null> {
  const { status, data } = await call("GET", `/v3/session/${encodeURIComponent(diditSessionId)}/decision/`);
  if (status === 404) return null;
  if (status !== 200) throw new DiditUnavailable(`Didit decision read failed (${status})`);
  return data;
}

/** Deleting an unfinished check when it is replaced (spec 05.8). A failure is logged, never fatal. */
export async function deleteSession(diditSessionId: string): Promise<boolean> {
  try {
    const { status } = await call("DELETE", `/v3/session/${encodeURIComponent(diditSessionId)}/delete/`);
    return status === 200 || status === 204 || status === 404;
  } catch (e) {
    console.error("[didit] delete failed", String(e));
    return false;
  }
}

// ── Webhook signature (spec 07.6), exactly as Didit documents it ─────────────

function shortenFloats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shortenFloats(x)]));
  }
  if (typeof v === "number" && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
  return v;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
  }
  return v;
}

export function canonicalBody(parsed: unknown): string {
  return JSON.stringify(sortKeys(shortenFloats(parsed)));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when the body is signed with our webhook secret and its SIGNED `timestamp` is within 300 seconds.
 * The unsigned X-Timestamp header is never used (a replayed body could carry a fresh one).
 */
export async function verifyWebhook(parsed: any, signatureV2: string, nowSeconds = Date.now() / 1000): Promise<boolean> {
  const secret = Deno.env.get("DIDIT_WEBHOOK_SECRET");
  if (!secret || !signatureV2) return false;
  const expected = await hmacHex(secret, canonicalBody(parsed));
  if (!sameText(expected, signatureV2.trim().toLowerCase())) return false;
  const ts = Number(parsed?.timestamp);
  return Number.isFinite(ts) && ts > 0 && Math.abs(nowSeconds - ts) <= 300;
}

/** Exposed for the eval, which signs its own test webhooks with the same rule. */
export const _forTests = { hmacHex };
