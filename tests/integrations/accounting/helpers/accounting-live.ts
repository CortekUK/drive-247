// =============================================================================
// accounting-live.ts — Layer 2 plumbing for the accounting OAuth surface.
//
// WHAT THIS IS NOT
// ----------------
// It is NOT a second production guard. `liveStatus()` in tests/helpers/live-call.ts
// is the only thing in this repository allowed to answer "which database am I
// pointed at", and every function below calls it first and inherits its throw.
// Nothing here can widen a target, declare a target, or excuse one — there is
// deliberately no env var read in this file that could.
//
// WHY IT EXISTS AT ALL
// --------------------
// Two things the shared `liveCall()` cannot do, both structural rather than
// cosmetic:
//
//   1. GET. `liveCall` POSTs a JSON body. The two callbacks are REDIRECT
//      TARGETS: they 405 anything that is not a GET, and their inputs are query
//      parameters. A POST at them measures the method guard and nothing else.
//
//   2. Not following redirects. The callbacks answer with a 302 whose
//      `Location` carries the whole verdict (`reason=invalid_state`). Node's
//      fetch follows that by default, straight out to a tenant's portal
//      hostname — so the test would assert against a Next.js page instead of
//      against the edge function, and would additionally send traffic at a
//      real operator's portal. `redirect: "manual"` is load-bearing.
//
// WHAT THE ACCOUNTING SURFACE CANNOT DO, AND WHY THERE IS NO MONEY RUNG HERE
// --------------------------------------------------------------------------
// The Stripe folder needs a third gate because `refunds.create` moves money at
// a third party with no undo. Nothing in these four functions can move a
// penny: `*-oauth-start` writes one short-lived nonce row, and the callbacks
// exchange an OAuth code and store tokens. The irreversible thing here is a
// CONSENT GRANT and a set of tokens, not a balance.
//
// So this folder uses two rungs, not three, and says so rather than importing
// `liveMoneyGate()` to look rigorous. Inventing a money gate for a surface that
// cannot move money teaches the next reader that the gates are decoration.
// The gate that DOES matter here is D247_LIVE_ALLOW_WRITES, because the one
// happy-path case persists rows in `accounting_oauth_state`.
// =============================================================================

import { liveStatus, type LiveTarget } from "../../../helpers/live-call";

function env(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * A nonce that cannot be in `accounting_oauth_state`.
 *
 * The all-zero UUID is a valid UUID — so it survives the column's type — and it
 * is never produced by `gen_random_uuid()`. That combination is what makes the
 * unknown-state live case reach the real lookup and come back `invalid_state`
 * rather than being rejected earlier by Postgres as malformed input.
 *
 * A REAL nonce must never be used in these tests. A valid nonce is the single
 * thing standing between an anonymous caller and the token exchange, and
 * anything holding one can drive the callback for real.
 */
export const NON_EXISTENT_NONCE = "00000000-0000-0000-0000-000000000000";

/** An authorization code that cannot be redeemed. Never reached in Layer 2. */
export const UNREDEEMABLE_CODE = "drive247-suite-not-a-real-code";

export interface LiveHttpResponse {
  status: number;
  ok: boolean;
  /** 302 `Location`, or null. */
  location: string | null;
  json: any;
  text: string;
  ms: number;
}

/**
 * One HTTP call at one edge function, on the target `liveStatus()` approved.
 *
 * `auth` is explicit per call and has no default that sends credentials:
 *
 *   "none"   what a provider's redirect looks like — no Authorization, no
 *            apikey. The only faithful way to call a `verify_jwt = false`
 *            callback, and the way that proves the config is still false.
 *   "anon"   the project's anon key. Gets past the gateway so the FUNCTION's
 *            own auth check is what answers, which is the whole point of the
 *            "unauthenticated start is refused" case.
 *   "portal" a real admin session (D247_LIVE_PORTAL_JWT).
 */
export async function accountingLiveFetch(
  fn: string,
  opts: {
    method: "GET" | "POST";
    query?: Record<string, string>;
    body?: unknown;
    auth: "none" | "anon" | "portal";
    timeoutMs?: number;
  },
): Promise<LiveHttpResponse> {
  const status = liveStatus();
  if (!status.enabled) {
    throw new Error(
      `accountingLiveFetch("${fn}") reached with Layer 2 disabled: ${status.reason}`,
    );
  }
  const target: LiveTarget = status.target;

  const url = new URL(`${target.functionsUrl}/${fn}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {};
  if (opts.auth === "anon") {
    if (!target.anonKey) throw new Error('accountingLiveFetch auth:"anon" with no D247_LIVE_ANON_KEY');
    headers.apikey = target.anonKey;
    headers.Authorization = `Bearer ${target.anonKey}`;
  } else if (opts.auth === "portal") {
    const jwt = portalJwt();
    if (!jwt) throw new Error('accountingLiveFetch auth:"portal" with no D247_LIVE_PORTAL_JWT');
    if (target.anonKey) headers.apikey = target.anonKey;
    headers.Authorization = `Bearer ${jwt}`;
  }
  if (opts.method === "POST") headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const startedAt = Date.now();
  try {
    const res = await fetch(url.toString(), {
      method: opts.method,
      headers,
      body: opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
      // See the header. Never follow — the Location IS the answer, and following
      // it would send this test's traffic at a real tenant's portal.
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON is itself a finding: an HTML gateway error page means the
      // function is not deployed on this project at all.
    }
    return {
      status: res.status,
      ok: res.ok,
      location: res.headers.get("location"),
      json,
      text,
      ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `reason` a callback answered with, from EITHER shape it can answer in.
 *
 * Both callbacks funnel every outcome through one `redirect()` helper, and that
 * helper has two exits:
 *
 *   302 + Location: /settings?...&reason=invalid_state   when a portal origin
 *                                                        is known
 *   400 + { reason: "invalid_state", ... }               when it is not
 *
 * Which one a given request gets is NOT a property of the request. It depends
 * on whether a portal origin happens to be known to the running isolate — see
 * the README's finding 2. A test that demanded one shape would be flaky for a
 * reason that has nothing to do with the guard it is testing, so this reads the
 * verdict out of whichever arrived and the tests assert on the verdict.
 */
export function callbackReason(res: LiveHttpResponse): string | null {
  if (res.location) {
    const q = res.location.includes("?") ? res.location.slice(res.location.indexOf("?") + 1) : "";
    const reason = new URLSearchParams(q).get("reason");
    if (reason) return reason;
  }
  if (typeof res.json?.reason === "string") return res.json.reason;
  return null;
}

/** A one-line description of what a callback did, for failure messages. */
export function describeCallback(res: LiveHttpResponse): string {
  const reason = callbackReason(res) ?? "(no reason found)";
  const where = res.location ? `302 -> ${res.location}` : `${res.status} ${res.text.slice(0, 200)}`;
  return `${where}   [reason=${reason}]`;
}

/**
 * An admin/head_admin session token for the target project.
 *
 * NOT the same token as `D247_LIVE_SESSION_JWT`, which the spine uses for a
 * half-provisioned signup user. The start functions look the caller up in
 * `app_users` and refuse anyone who is not admin, head_admin or a super admin,
 * so a signup-era token would only ever prove the 403 path.
 *
 * Never inferred, never defaulted: the case that uses it writes a row.
 */
export function portalJwt(): string | null {
  return env("D247_LIVE_PORTAL_JWT");
}

/** The second rung, read from the shared vocabulary rather than redefined. */
export function liveWritesRequested(): boolean {
  return env("D247_LIVE_ALLOW_WRITES") === "1";
}

/**
 * Everything the one write case needs, or a sentence saying what is missing.
 *
 * Shaped like `liveMoneyGate()`: "you did not ask for this" is a SKIP; asking
 * for it and half-configuring it is a hard error. A run that says it may write
 * and then cannot say as whom is not a run to guess at.
 */
export type WriteGate =
  | { allowed: true; jwt: string }
  | { allowed: false; reason: string };

export function accountingWriteGate(): WriteGate {
  if (!liveWritesRequested()) {
    return {
      allowed: false,
      reason:
        "Writes are off (D247_LIVE_ALLOW_WRITES is not 1). This case persists rows in " +
        "accounting_oauth_state. The contract half of it still ran — see " +
        "tests/integrations/accounting/README.md.",
    };
  }
  // Inherited, not re-implemented. This is the call carrying the production
  // refusal, so a write run aimed at the production ref dies here.
  const status = liveStatus();
  if (!status.enabled) {
    throw new Error(
      "\n  D247_LIVE_ALLOW_WRITES=1 but Layer 2 itself is off.\n" +
        `  (${status.reason})\n` +
        "  You have said rows may be written and then not said where. Set\n" +
        "  D247_LIVE_TESTS=1 with an explicit target, or unset D247_LIVE_ALLOW_WRITES.\n",
    );
  }
  const jwt = portalJwt();
  if (!jwt) {
    return {
      allowed: false,
      reason:
        "D247_LIVE_PORTAL_JWT is not set. The happy path needs a signed-in admin or " +
        "head_admin of a tenant on the target project; without one this case can only " +
        "reach the 401 that the unauthenticated case already covers.",
    };
  }
  return { allowed: true, jwt };
}
