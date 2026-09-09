// =============================================================================
// sandbox.ts — Layer 2 for Bonzah. The gates, and the SANDBOX-ONLY refusal.
//
// THE INSTRUCTION THIS IMPLEMENTS
// -------------------------------
//   "jo test develop kar rahe hain woh SANDBOX MEIN HI."
//   "Bonzah ki REAL PAYMENTS toh test cases mein karenge hi nahi."
//
// Bonzah is not Stripe. There is no `stripe_mode` equivalent that this process
// can read and no "test card" that makes a mistake free: a Bonzah policy is
// bought out of the operator's PREPAID BALANCE, and `POST /Bonzah/payment`
// spends it. There is no DELETE. So the ladder here is deliberately one rung
// stricter than the Stripe folder's:
//
//   D247_LIVE_TESTS=1                   inherited from helpers/live-call.ts,
//                                       WITH its production-Supabase refusal
//   D247_LIVE_ALLOW_WRITES=1            a quote is a write at a third party —
//                                       it creates a quote record at Bonzah
//   D247_LIVE_ALLOW_MONEY_MOVEMENT=1    only for bonzah-confirm-payment, which
//                                       actually draws the balance down
//   D247_LIVE_BONZAH_MODE=test          a human declaration, refused when unset
//
// plus, on every single HTTP call this module makes, a hostname check that
// refuses Bonzah's LIVE API outright. That check is not a flag and has no
// override: `bonzah.insillion.com` is production insurance for real renters.
//
// WHY THE URL DEFAULTS WHEN `D247_LIVE_FUNCTIONS_URL` MAY NOT
// -----------------------------------------------------------
// The spine's rule is "never infer a target", because there the only plausible
// default WAS production. Here the opposite holds: the only permitted target is
// the sandbox, the default IS the sandbox constant taken out of the shipped
// client, and anything else is refused. Defaulting is the fail-safe direction.
// =============================================================================

import { blankComments, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { liveStatus, liveWritesAllowed, type LiveTarget } from "../../helpers/live-call";
import { liftSharedClient, QUOTE_FN } from "./rate-card";

function env(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// The two Bonzah worlds, read out of the shipped client rather than retyped.
//
// `getBonzahApiUrl(mode)` is the single place the deployed functions choose an
// API host. Lifting it means this guard can never guard the wrong hostname:
// if someone repoints the sandbox, the refusal follows automatically.
// ---------------------------------------------------------------------------
const apiUrlFor = liftSharedClient<(mode: "test" | "live") => string>("getBonzahApiUrl").call;

export const BONZAH_SANDBOX_URL = apiUrlFor("test");
export const BONZAH_LIVE_URL = apiUrlFor("live");
export const BONZAH_SANDBOX_HOST = new URL(BONZAH_SANDBOX_URL).hostname;
export const BONZAH_LIVE_HOST = new URL(BONZAH_LIVE_URL).hostname;

/** Thrown, never returned. A refusal that can be caught and ignored is not one. */
export class BonzahLiveTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BonzahLiveTargetError";
  }
}

function liveRefusal(where: string, detail: string): BonzahLiveTargetError {
  return new BonzahLiveTargetError(
    [
      "",
      "  ############################################################",
      "  #  REFUSING TO CALL BONZAH'S LIVE INSURANCE API            #",
      "  ############################################################",
      "",
      `  ${where}: ${detail}`,
      "",
      `  The only permitted target is the sandbox, ${BONZAH_SANDBOX_HOST}.`,
      `  ${BONZAH_LIVE_HOST} issues REAL policies to REAL renters and spends a real`,
      "  prepaid balance. Nothing in this repository can cancel a policy or claw a",
      "  balance back.",
      "",
      '  "jo test develop kar rahe hain woh sandbox mein hi." There is no override',
      "  flag, and adding one is how this ends up in CI.",
      "",
    ].join("\n"),
  );
}

/**
 * Refuse anything that is not exactly the sandbox host.
 *
 * Exact hostname equality, not a substring test, and then a substring test as
 * well — for the same reason `mentionsProductionRef` exists in live-call.ts. A
 * false positive costs somebody a rename; a false negative sells a stranger an
 * insurance policy.
 */
export function assertBonzahSandboxUrl(url: string, where = "D247_LIVE_BONZAH_SANDBOX_URL"): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw liveRefusal(where, `"${url}" is not a URL, so it cannot be shown to be the sandbox.`);
  }
  if (parsed.hostname.toLowerCase() !== BONZAH_SANDBOX_HOST.toLowerCase()) {
    throw liveRefusal(where, `host is "${parsed.hostname}", not "${BONZAH_SANDBOX_HOST}".`);
  }
  if (url.toLowerCase().includes(BONZAH_LIVE_HOST.toLowerCase())) {
    throw liveRefusal(where, `the live host "${BONZAH_LIVE_HOST}" appears in "${url}".`);
  }
  return url.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

export interface BonzahSandboxCredentials {
  apiUrl: string;
  username: string;
  password: string;
}

export type SandboxGate =
  | { allowed: true; credentials: BonzahSandboxCredentials; target: LiveTarget }
  | { allowed: false; reason: string };

/**
 * Permission to create a QUOTE in Bonzah's sandbox.
 *
 * A quote is not a payment — `/Bonzah/quote` with `finalize: 1` reserves a
 * payment_id and spends nothing — so this stops at the WRITES rung. It still
 * needs that rung, because it does leave a record at a third party.
 *
 * `liveStatus()` is called even though this path never touches Supabase: it is
 * the one function carrying the production-database refusal, and inheriting it
 * rather than re-deriving it is the point. It also means one master switch
 * (`D247_LIVE_TESTS`) turns the whole Layer 2 of this suite on and off.
 */
export function bonzahSandboxGate(): SandboxGate {
  const status = liveStatus(); // throws on a production Supabase target
  if (!status.enabled) {
    return {
      allowed: false,
      reason:
        `${status.reason} The Bonzah maths still ran offline — see ` +
        "tests/integrations/bonzah/premium-maths.test.ts.",
    };
  }
  if (!liveWritesAllowed()) {
    return {
      allowed: false,
      reason:
        "D247_LIVE_ALLOW_WRITES is not 1. A Bonzah quote leaves a record at Bonzah, " +
        "so it needs the writes rung even though it moves no money.",
    };
  }

  const username = env("D247_LIVE_BONZAH_USERNAME");
  const password = env("D247_LIVE_BONZAH_PASSWORD");
  if (!username || !password) {
    return {
      allowed: false,
      reason:
        "D247_LIVE_BONZAH_USERNAME / D247_LIVE_BONZAH_PASSWORD are not set. These are " +
        "the SANDBOX credentials (bonzah.sb.insillion.com); they are never inferred and " +
        "never read from the app's own env.",
    };
  }

  // Refused here, before a socket exists, and refused again inside every call.
  const apiUrl = assertBonzahSandboxUrl(env("D247_LIVE_BONZAH_SANDBOX_URL") ?? BONZAH_SANDBOX_URL);
  return { allowed: true, credentials: { apiUrl, username, password }, target: status.target };
}

/** The flag alone — safe to evaluate at collection time, cannot throw. */
export function bonzahMoneyMovementRequested(): boolean {
  return env("D247_LIVE_ALLOW_MONEY_MOVEMENT") === "1";
}

export type MoneyGate =
  | { allowed: true; target: LiveTarget }
  | { allowed: false; reason: string };

function moneyRefusal(lines: string[]): BonzahLiveTargetError {
  return new BonzahLiveTargetError(
    [
      "",
      "  ############################################################",
      "  #  REFUSING TO BUY A REAL BONZAH POLICY                    #",
      "  ############################################################",
      "",
      ...lines.map((l) => `  ${l}`),
      "",
      "  bonzah-confirm-payment calls /Bonzah/payment, which spends the operator's",
      "  prepaid Bonzah balance and issues a policy. Neither can be undone from here.",
      "  Configure the run completely, or leave this case skipped — which is the",
      "  default and the correct state for CI.",
      "",
    ].join("\n"),
  );
}

/**
 * Permission to run `bonzah-confirm-payment`, which BUYS.
 *
 * Shaped like `liveMoneyGate()` in helpers/live-call.ts on purpose: "you did not
 * ask for this" is a skip, and everything past that point is a hard throw,
 * because half-configuring a run that spends money is worse than a red build.
 *
 * The last rung is the Bonzah analogue of `D247_LIVE_STRIPE_MODE`, and it
 * exists for the identical reason: `tenants.bonzah_mode` is a PER-TENANT column,
 * so a perfectly non-production Supabase project can hold a tenant wired to
 * Bonzah's live API — and bonzah-confirm-payment reads that column, not this
 * variable, when it decides which Bonzah account to spend. A human has to
 * assert it, and unset is refused rather than assumed.
 */
export function bonzahMoneyGate(): MoneyGate {
  if (!bonzahMoneyMovementRequested()) {
    return {
      allowed: false,
      reason:
        "Money-movement cases are off (D247_LIVE_ALLOW_MONEY_MOVEMENT is not 1). " +
        '"Bonzah ki real payments toh test cases mein karenge hi nahi" — this is the ' +
        "intended state. The contract half of this case still ran.",
    };
  }

  const status = liveStatus(); // carries the production-Supabase refusal
  if (!status.enabled) {
    throw moneyRefusal([
      "D247_LIVE_ALLOW_MONEY_MOVEMENT=1 but Layer 2 itself is off.",
      `  (${status.reason})`,
      "",
      "You have said a policy may be bought and then not said where. Set",
      "D247_LIVE_TESTS=1 with an explicit target, or unset the money flag.",
    ]);
  }
  if (!liveWritesAllowed()) {
    throw moneyRefusal([
      "D247_LIVE_ALLOW_MONEY_MOVEMENT=1 but D247_LIVE_ALLOW_WRITES is not 1.",
      "",
      "Buying a policy writes: bonzah_insurance_policies.status, policy_no, policy_id",
      "and the rental's insurance fields all change. Money movement is a strict",
      "superset of writing and cannot be granted while writing is withheld.",
    ]);
  }

  const declared = env("D247_LIVE_BONZAH_MODE");
  if (declared !== "test") {
    throw moneyRefusal([
      declared
        ? `D247_LIVE_BONZAH_MODE is "${declared}". Only "test" is accepted.`
        : "D247_LIVE_BONZAH_MODE is not set.",
      "",
      "The Supabase guards prove which DATABASE this run points at. They prove nothing",
      "about Bonzah: `tenants.bonzah_mode` is a per-tenant column, and",
      "getTenantBonzahCredentials reads it — not this variable — to choose between",
      `${BONZAH_SANDBOX_HOST} and ${BONZAH_LIVE_HOST}.`,
      "",
      "So this is a declaration, not a detection. Unset is refused: the failure",
      "direction of a wrong guess here is a real policy on somebody's real balance.",
    ]);
  }

  return { allowed: true, target: status.target };
}

// ---------------------------------------------------------------------------
// The sandbox call itself
// ---------------------------------------------------------------------------

/**
 * The top-level keys of `commonFields` in bonzah-create-quote.
 *
 * The parity test has to build a quote request by hand — it talks to Bonzah
 * directly, so there is no production code path to borrow. Deriving the KEY LIST
 * from the shipped function means the hand-built request cannot quietly stop
 * resembling what production sends: a field added to `commonFields` shows up as
 * a missing key on the next run.
 */
export function readQuoteCommonFieldKeys(): string[] {
  const src = blankComments(readEdgeFunctionSource(QUOTE_FN));
  const m = /\bconst\s+commonFields\s*:\s*[^=]+=\s*\{/.exec(src);
  if (!m) {
    throw new Error(
      `Could not find \`const commonFields\` in supabase/functions/${QUOTE_FN}/index.ts. ` +
        "That object is what the deployed function sends to /Bonzah/quote; without it " +
        "the parity test cannot check that its own request still looks like production's.",
    );
  }
  let depth = 0;
  let end = -1;
  const open = m.index + m[0].length - 1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = src.slice(open + 1, end);

  const keys: string[] = [];
  let nest = 0;
  let lineStart = 0;
  for (let i = 0; i <= block.length; i += 1) {
    const c = block[i];
    if (c === "{" || c === "(" || c === "[") nest += 1;
    else if (c === "}" || c === ")" || c === "]") nest -= 1;
    const isBreak = i === block.length || ((c === "," || c === "\n") && nest === 0);
    if (!isBreak) continue;
    const seg = block.slice(lineStart, i);
    lineStart = i + 1;
    const k = /^\s*["']?([A-Za-z_$][\w$]*)["']?\s*:/.exec(seg);
    if (k) keys.push(k[1]);
  }

  // Fields bolted on AFTER the literal — `commonFields.inspection_done =
  // 'Rental Agency'` when CDW is selected. They are part of the request Bonzah
  // rates on, so leaving them out would make the comparison in the parity test
  // report a difference that is not one.
  for (const m2 of src.matchAll(/\bcommonFields\s*\.\s*([A-Za-z_$][\w$]*)\s*=[^=]/g)) {
    if (!keys.includes(m2[1])) keys.push(m2[1]);
  }
  return keys;
}

export interface SandboxQuote {
  /** Bonzah's own binding figure, or null when it did not finalize one. */
  totalAmount: number | null;
  quoteId: string | null;
  paymentId: string | null;
  status: number | null;
  txt: string | null;
  /** The exact URL the quote was requested from, for the failure message. */
  url: string;
  raw: unknown;
}

async function bonzahPost(
  credentials: BonzahSandboxCredentials,
  path: string,
  body: unknown,
  token?: string,
): Promise<any> {
  // Re-checked on EVERY call, not only when the gate resolved. A helper that
  // trusts an earlier check is one refactor away from not being checked at all.
  const base = assertBonzahSandboxUrl(credentials.apiUrl, "the resolved Bonzah API URL");
  const url = `${base}${path}`;
  assertBonzahSandboxUrl(url, "the composed Bonzah request URL");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["in-auth-token"] = token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Bonzah sandbox returned non-JSON from ${path} (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Insillion auth. `status: 0` is success; anything else is a rejected login.
 *
 * Cached for the run, the way the shipped client caches it: a parity pass asks
 * for several quotes and there is no reason to re-authenticate for each one.
 */
const tokenCache = new Map<string, string>();

async function bonzahSandboxToken(credentials: BonzahSandboxCredentials): Promise<string> {
  const cached = tokenCache.get(credentials.username);
  if (cached) return cached;
  const data = await bonzahPost(credentials, "/auth", {
    email: credentials.username,
    pwd: credentials.password,
  });
  if (data?.status !== 0 || !data?.data?.token) {
    throw new Error(
      "Bonzah's SANDBOX rejected the credentials in D247_LIVE_BONZAH_USERNAME / " +
        `D247_LIVE_BONZAH_PASSWORD (status ${data?.status}, "${data?.txt ?? ""}").\n` +
        "  This is a fixture problem, not a pricing problem: nothing was quoted and " +
        "nothing was compared.",
    );
  }
  const token = data.data.token as string;
  tokenCache.set(credentials.username, token);
  return token;
}

export interface SandboxQuoteRequest {
  /** MM/DD/YYYY HH:mm:ss, the format formatDateForBonzah produces plus a time. */
  tripStart: string;
  tripEnd: string;
  pickupStateFull: string;
  coverage: { cdw: boolean; rcli: boolean; sli: boolean; pai: boolean };
}

/**
 * One finalized quote from Bonzah's sandbox.
 *
 * `finalize: 1` mirrors what bonzah-create-quote sends, because a non-finalized
 * quote does not carry `total_amount` and this test exists precisely to read
 * that number. Finalizing reserves a payment_id; it does NOT spend the balance
 * — that is `/Bonzah/payment`, which this module never calls.
 */
export async function bonzahSandboxQuote(
  credentials: BonzahSandboxCredentials,
  req: SandboxQuoteRequest,
): Promise<SandboxQuote> {
  const token = await bonzahSandboxToken(credentials);
  const body = buildSandboxQuoteBody(req);
  const raw = await bonzahPost(credentials, "/Bonzah/quote", body, token);
  const amount = raw?.data?.total_amount;
  return {
    totalAmount: amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null,
    quoteId: raw?.data?.quote_id ?? null,
    paymentId: raw?.data?.payment_id ?? null,
    status: typeof raw?.status === "number" ? raw.status : null,
    txt: typeof raw?.txt === "string" ? raw.txt : null,
    url: `${assertBonzahSandboxUrl(credentials.apiUrl)}/Bonzah/quote`,
    raw,
  };
}

/**
 * The exact body sent to /Bonzah/quote — built here so the live call and the
 * offline "does our request still look like production's" check cannot drift
 * apart. One definition, two readers.
 *
 * The renter details are deliberately synthetic and inert: an `.invalid`
 * address (RFC 2606 — it can never resolve), a placeholder phone and the same
 * "123 Main St" / 33101 defaults bonzah-create-quote itself falls back to. This
 * request prices a WINDOW; it is not meant to describe a person.
 */
export function buildSandboxQuoteBody(req: SandboxQuoteRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    product_id: "M000000000006",
    finalize: 1,
    source: "API",
    policy_booking_time_zone: "America/Los_Angeles",
    trip_start_date: req.tripStart,
    trip_end_date: req.tripEnd,
    pickup_state: req.pickupStateFull,
    pickup_country: "United States",
    drop_off_time: "Same",
    cdw_cover: req.coverage.cdw,
    rcli_cover: req.coverage.rcli,
    sli_cover: req.coverage.sli,
    pai_cover: req.coverage.pai,
    first_name: "Drive247",
    last_name: "SpineSuite",
    dob: "01/01/1990",
    pri_email_address: "spine-suite@drive-247.invalid",
    phone_no: "10000000000",
    address_line_1: "123 Main St",
    zip_code: "33101",
    residence_country: "United States",
    residence_state: req.pickupStateFull,
    license_no: "N/A",
    drivers_license_state: req.pickupStateFull,
  };
  // CDW is the one coverage Bonzah will not finalize without an inspection
  // declaration; bonzah-create-quote adds the same field under the same
  // condition.
  if (req.coverage.cdw) body.inspection_done = "Rental Agency";
  return body;
}

// ---------------------------------------------------------------------------
// Dates for a live quote
// ---------------------------------------------------------------------------

/**
 * A trip window `days` long, starting two days out.
 *
 * Bonzah refuses a policy that starts today in America/Los_Angeles, and the
 * deployed functions clamp to Pacific-tomorrow for exactly that reason. Two days
 * out clears the clamp from any timezone this test might run in, so a parity
 * failure is never just "the sandbox pushed the start date".
 *
 * Returned in Bonzah's MM/DD/YYYY format with the same 15:00:00 both ends that
 * bonzah-create-quote uses — equal times are what make the window a whole
 * number of 24h periods.
 */
export function sandboxTripWindow(days: number): { start: string; end: string; days: number } {
  const at = (offset: number) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${mm}/${dd}/${d.getUTCFullYear()} 15:00:00`;
  };
  return { start: at(2), end: at(2 + days), days };
}

/** Fixtures for the live cases that go through our own edge functions. */
export function bonzahFixture(name: string, why: string): string {
  const v = env(name);
  if (!v) {
    throw new Error(
      `${name} is not set.\n` +
        `  ${why}\n` +
        "  Fixtures are never inferred — see tests/integrations/bonzah/README.md.",
    );
  }
  return v;
}

export function bonzahFixtureOrNull(name: string): string | null {
  return env(name);
}
