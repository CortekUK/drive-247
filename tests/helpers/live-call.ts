// =============================================================================
// live-call.ts — Layer 2. The gated caller, and the production refusal.
//
// This is the "does it give me a 200" half of the suite. It makes real HTTP
// calls to real deployed edge functions, so before anything else it has to
// answer one question honestly: WHICH DATABASE AM I POINTED AT?
//
// V2_PLAN.md §0: "There is no staging. You are working on main, in the repo
// that deploys, against the production database that ~32 paying operators are
// running their businesses on right now."
//
// Two of the four onboarding functions are not read-only:
//   - signup-begin     calls `auth.admin.createUser` — it MINTS a real auth user
//   - signup-provision INSERTs a real tenant row
//
// So a suite that POSTs at them and asserts 200 is a machine for manufacturing
// junk operators on a live business database, once per CI run, for ever. That
// is why Layer 2 is:
//
//   OFF by default            — no env, no network, tests SKIP (never fail)
//   explicit about its target — you must name the URL; nothing is inferred
//   hard-refusing on prod     — pointing it at hviqoaokxvlancmftwuo throws
//
// Enabling it:
//   D247_LIVE_TESTS=1
//   D247_LIVE_FUNCTIONS_URL=https://<ref>.supabase.co/functions/v1
//   D247_LIVE_ANON_KEY=<anon key of that same project>      (recommended)
//   D247_LIVE_SESSION_JWT=<a signed-in signup user's access token>   (optional)
//   D247_LIVE_PROJECT_REF=<ref>   (required only for a non-*.supabase.co host)
// =============================================================================

/**
 * Production. Straight out of CLAUDE.md and .env.example — this is the project
 * ref the deployed apps use, and the one Layer 2 must never call.
 */
export const PRODUCTION_PROJECT_REFS: readonly string[] = ["hviqoaokxvlancmftwuo"];

/**
 * The Supabase branch clone `scripts/db-switch.mjs` already knows about. Named
 * here so "where am I allowed to point this?" has an answer in the code and not
 * only in someone's shell history. Not an allowlist — anything that is not
 * production is permitted; this is documentation.
 */
export const KNOWN_STAGING_PROJECT_REF = "ksmreaadhbirzakkxqrq";

/** Thrown, never returned. A refusal that could be ignored is not a refusal. */
export class ProductionTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionTargetError";
  }
}

export interface LiveTarget {
  functionsUrl: string;
  projectRef: string;
  anonKey: string | null;
  sessionJwt: string | null;
}

export type LiveStatus =
  | { enabled: true; target: LiveTarget }
  | { enabled: false; reason: string };

function env(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The project ref out of a Supabase host: `https://<ref>.supabase.co/...` or
 * `https://<ref>.functions.supabase.co`. Refs are 20 lowercase letters.
 */
export function projectRefFromUrl(url: string): string | null {
  // Lowercased first. Hostnames are case-insensitive in DNS, so
  // `https://HVIQOAOKXVLANCMFTWUO.supabase.co` reaches production exactly as
  // the lowercase form does — but `[a-z]{20}` would not have matched it, the
  // ref would have come back null, and the target would have been judged on
  // whatever D247_LIVE_PROJECT_REF happened to say instead.
  return /^https?:\/\/([a-z]{20})\.(?:functions\.)?supabase\.(?:co|in)\b/.exec(url.toLowerCase())?.[1] ?? null;
}

/**
 * The project ref out of an anon/service JWT payload.
 *
 * Second, independent guard. A custom domain or a proxy can hide the ref from
 * the URL entirely, but the key you authenticate with cannot lie about which
 * project issued it — `{"iss":"supabase","ref":"<project>","role":"anon"}`.
 * Decoded, never verified: we are reading a label, not trusting a claim.
 */
export function projectRefFromKey(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const ref = JSON.parse(json)?.ref;
    return typeof ref === "string" && ref ? ref : null;
  } catch {
    return null;
  }
}

export function isProductionRef(ref: string | null | undefined): boolean {
  return Boolean(ref) && PRODUCTION_PROJECT_REFS.includes(ref as string);
}

/**
 * Does a production ref appear ANYWHERE in this string?
 *
 * The two functions above answer "which project is this, canonically". This one
 * answers a blunter and more useful question, because the canonical parse has a
 * blind spot: it only recognises the ref in the FIRST host label. A ref that
 * turns up anywhere else —
 *
 *     https://db.hviqoaokxvlancmftwuo.supabase.co/functions/v1
 *     https://api.drive-247.com/hviqoaokxvlancmftwuo/functions/v1
 *
 * — parses as "unidentifiable", which is normally refused too, EXCEPT that
 * D247_LIVE_PROJECT_REF exists to resolve exactly that case. So a stale or
 * copy-pasted `D247_LIVE_PROJECT_REF=<staging>` was enough to wave a URL with
 * the production ref written on its face straight through. Substring, case
 * insensitive, checked before anything can be declared away.
 *
 * A false positive here costs someone a rename. A false negative costs 32
 * operators a junk tenant.
 */
export function mentionsProductionRef(text: string | null | undefined): string | null {
  if (!text) return null;
  const hay = text.toLowerCase();
  return PRODUCTION_PROJECT_REFS.find((ref) => hay.includes(ref)) ?? null;
}

/**
 * The decoded (never verified) payload of a JWT, as text.
 *
 * `projectRefFromKey` reads the `ref` claim, which anon/service keys carry. A
 * USER access token does not have one — it identifies its project through
 * `"iss": "https://<ref>.supabase.co/auth/v1"` instead. Handing the whole
 * payload to `mentionsProductionRef` catches both without having to enumerate
 * which claim GoTrue is putting the ref in this month.
 */
function jwtPayloadText(key: string | null): string | null {
  if (!key) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    return Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function refusal(
  where: string,
  ref: string,
  how = "resolves to project ref",
): ProductionTargetError {
  return new ProductionTargetError(
    [
      "",
      "  ############################################################",
      "  #  REFUSING TO RUN LIVE TESTS AGAINST PRODUCTION           #",
      "  ############################################################",
      "",
      `  ${where} ${how}  ${ref}`,
      "  That is the production Supabase project — the one ~32 paying operators",
      "  are running their businesses on right now (V2_PLAN.md §0).",
      "",
      "  Layer 2 calls signup-begin (which mints a real auth.users row) and",
      "  signup-provision (which creates a real tenant). Against this project",
      "  those are not tests; they are writes to a live business database.",
      "",
      "  Point D247_LIVE_FUNCTIONS_URL at a non-production project and re-run.",
      `  The branch clone in scripts/db-switch.mjs is ${KNOWN_STAGING_PROJECT_REF}.`,
      "",
      "  There is no override flag. Adding one is how this ends up in CI.",
      "",
    ].join("\n"),
  );
}

/**
 * Resolve the target, or explain why Layer 2 is not running.
 *
 * Ordering is deliberate. "Not enabled" is checked FIRST and returns a skip,
 * so the default `npm run test:spine` is green on a laptop with no env and no
 * network. Everything after that point is a hard throw, because at that point
 * somebody has explicitly asked for live calls and a half-configured live run
 * is a worse outcome than a red build.
 */
export function liveStatus(): LiveStatus {
  if (env("D247_LIVE_TESTS") !== "1") {
    return {
      enabled: false,
      reason:
        "Layer 2 is off (D247_LIVE_TESTS is not 1). Contract tests still ran — " +
        "see tests/README.md for how to enable live status checks.",
    };
  }

  const functionsUrl = env("D247_LIVE_FUNCTIONS_URL");
  if (!functionsUrl) {
    // NOT a skip. You asked for live tests and did not say where to send them;
    // guessing the target is precisely how a run lands on production.
    throw new ProductionTargetError(
      "\n  D247_LIVE_TESTS=1 but D247_LIVE_FUNCTIONS_URL is not set.\n" +
        "  Live tests never infer a target — no fallback to .env, no default project.\n" +
        "  Set D247_LIVE_FUNCTIONS_URL=https://<ref>.supabase.co/functions/v1 explicitly.\n",
    );
  }

  const anonKey = env("D247_LIVE_ANON_KEY");
  const sessionJwt = env("D247_LIVE_SESSION_JWT");

  // ---------------------------------------------------------------------
  // Guard 0: the production ref written ANYWHERE in what was supplied.
  //
  // Runs first, and deliberately before any ref is *resolved*, because the
  // resolution step has an escape hatch (D247_LIVE_PROJECT_REF) that this must
  // not be subject to. Nothing you can declare makes a URL with the production
  // ref in it a non-production URL.
  //
  // The JWTs are checked through their decoded payload, since the ref is
  // base64 in the middle of the token rather than plain text.
  // ---------------------------------------------------------------------
  const mentions: [string, string | null][] = [
    ["D247_LIVE_FUNCTIONS_URL", functionsUrl],
    ["D247_LIVE_PROJECT_REF", env("D247_LIVE_PROJECT_REF")],
    ["D247_LIVE_ANON_KEY (decoded)", jwtPayloadText(anonKey)],
    ["D247_LIVE_SESSION_JWT (decoded)", jwtPayloadText(sessionJwt)],
  ];
  for (const [where, value] of mentions) {
    const hit = mentionsProductionRef(value);
    if (hit) throw refusal(where, hit, "mentions production project ref");
  }

  const urlRef = projectRefFromUrl(functionsUrl);
  const keyRef = anonKey ? projectRefFromKey(anonKey) : null;
  const declaredRef = env("D247_LIVE_PROJECT_REF");

  // Both guards fire independently: a laundered URL is still caught by the key,
  // and a missing key is still caught by the URL. Guard 0 above already covers
  // the literal-substring cases; these stay because they are the canonical,
  // exact-match read of "which project is this".
  if (isProductionRef(urlRef)) throw refusal("D247_LIVE_FUNCTIONS_URL", urlRef as string);
  if (isProductionRef(keyRef)) throw refusal("D247_LIVE_ANON_KEY", keyRef as string);
  if (isProductionRef(declaredRef)) throw refusal("D247_LIVE_PROJECT_REF", declaredRef as string);

  const projectRef = urlRef ?? keyRef ?? declaredRef;
  if (!projectRef) {
    // An unidentifiable target is treated as unsafe, not as fine. A reverse
    // proxy in front of production would otherwise sail straight through.
    throw new ProductionTargetError(
      "\n  Cannot identify which Supabase project D247_LIVE_FUNCTIONS_URL points at.\n" +
        `  URL: ${functionsUrl}\n` +
        "  It is not a *.supabase.co host and no D247_LIVE_ANON_KEY was given, so the\n" +
        "  production check has nothing to check. Set D247_LIVE_ANON_KEY (its JWT\n" +
        "  carries the project ref) or D247_LIVE_PROJECT_REF to say so explicitly.\n" +
        "  Refusing rather than assuming: an unknown target may be production.\n",
    );
  }

  // The URL and the key must agree. Disagreement means one of the two env vars
  // is stale — the classic way to end up authenticating against one project
  // while calling another.
  if (urlRef && keyRef && urlRef !== keyRef) {
    throw new ProductionTargetError(
      `\n  D247_LIVE_FUNCTIONS_URL is project ${urlRef} but D247_LIVE_ANON_KEY was\n` +
        `  issued by project ${keyRef}. One of them is stale. Refusing to guess.\n`,
    );
  }

  return {
    enabled: true,
    target: {
      functionsUrl: functionsUrl.replace(/\/+$/, ""),
      projectRef,
      anonKey,
      sessionJwt,
    },
  };
}

/**
 * Does this run have permission to call an endpoint that CREATES rows?
 *
 * Separate from D247_LIVE_TESTS on purpose. The read-only probes are cheap and
 * safe to leave on; `signup-begin` and `signup-provision` leave permanent
 * residue on whatever project they touch, so they need a second, deliberate
 * "yes" — and they say so in their own test files.
 */
export function liveWritesAllowed(): boolean {
  return env("D247_LIVE_ALLOW_WRITES") === "1";
}

export interface LiveResponse {
  status: number;
  ok: boolean;
  json: any;
  text: string;
  ms: number;
}

/**
 * POST a JSON body at one edge function.
 *
 * `token` picks the bearer: the anon key for the one unauthenticated endpoint
 * (`signup-begin`), the session JWT for everything after it. Supabase's gateway
 * 401s a request with no `apikey` header before the function is ever invoked, so
 * both headers are always sent when a key is available.
 */
export async function liveCall(
  fn: string,
  body: unknown,
  opts: { token?: string | null; timeoutMs?: number } = {},
): Promise<LiveResponse> {
  const status = liveStatus();
  if (!status.enabled) {
    throw new Error(`liveCall("${fn}") reached with Layer 2 disabled: ${status.reason}`);
  }
  const { target } = status;
  const bearer = opts.token ?? target.sessionJwt ?? target.anonKey;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.anonKey) headers.apikey = target.anonKey;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${target.functionsUrl}/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body is itself a finding — an HTML error page from the
      // gateway means the function is not deployed at all.
    }
    return { status: res.status, ok: res.ok, json, text, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Error codes these functions return when the PAYLOAD is wrong, as opposed to
 * when the function is broken. Taken from the `signupError(...)` calls in
 * supabase/functions/signup-*.
 */
const PAYLOAD_SHAPED_CODES = new Set([
  "INVALID_BODY",
  "VALIDATION_FAILED",
  "EMAIL_INVALID",
  "EMAIL_DISPOSABLE",
  "WEAK_PASSWORD",
  "PLAN_UNKNOWN",
  "SLUG_INVALID",
  "SLUG_RESERVED",
  "SLUG_TAKEN",
  "TERMS_NOT_ACCEPTED",
  "FLEET_TOO_LARGE",
]);

export type FailureMode = "payload" | "function" | "none";

/**
 * Tell the team lead's two failure modes apart from a live response.
 *
 *   (a) "payload"  — a developer changed a field. The function is healthy and
 *                    said so precisely: 400 + a code that names a field.
 *   (b) "function" — the endpoint itself is wrong or unreachable: 401, 404,
 *                    405, 5xx, or a 400 with no field-shaped explanation.
 *                    "aap in anyway isse aage badh hi nahi paoge."
 */
export function classifyLive(res: LiveResponse): { mode: FailureMode; explain: string } {
  if (res.ok) return { mode: "none", explain: `${res.status} in ${res.ms}ms` };

  const code = typeof res.json?.code === "string" ? res.json.code : null;
  const field = res.json?.detail?.field ?? res.json?.field ?? null;

  if (res.status === 400 && (PAYLOAD_SHAPED_CODES.has(code ?? "") || field)) {
    return {
      mode: "payload",
      explain:
        `FAILURE MODE (a) — THE PAYLOAD IS WRONG, THE FUNCTION IS FINE.\n` +
        `  ${res.status} ${code ?? "(no code)"}${field ? ` on field \`${field}\`` : ""}\n` +
        `  The endpoint is up and rejected the body it was given. A developer changed\n` +
        `  a field; update the payload in the contract to match, and re-run.`,
    };
  }

  return {
    mode: "function",
    explain:
      `FAILURE MODE (b) — THE EDGE FUNCTION IS BROKEN OR UNREACHABLE.\n` +
      `  ${res.status} ${code ?? "(no code)"}\n` +
      `  ${res.text.slice(0, 400)}\n` +
      `  This is a real bug, not a stale test. The spine chain stops here — later\n` +
      `  steps are not run, because they cannot succeed if this one did not.`,
  };
}
