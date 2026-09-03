// =============================================================================
// signup-state — in-flight self-serve signup state, abuse controls and the
// machine-readable error envelope shared by every signup-* edge function.
//
// WHERE THE STATE LIVES
// ---------------------
// `auth.users.raw_app_meta_data.d247_signup`. No new table, no new column: this
// feature ships into an environment where DDL cannot be applied at all.
//
// It is `app_metadata`, NOT `user_metadata`, and that distinction is the whole
// security model. `user_metadata` is writable by the end user through
// `supabase.auth.updateUser()` — anyone could set `paid: true` on themselves.
// `app_metadata` is service-role-only.
//
// Even so, this blob is a RESUMABLE HINT, never proof. Every money decision
// (`signup-resume`, `signup-provision`) re-retrieves the subscription from
// Stripe before believing anything about payment. Stripe is the source of truth
// for money; the database is the source of truth for provisioning.
// =============================================================================

import { jsonResponse } from "./cors.ts";

export const SIGNUP_META_KEY = "d247_signup";
export const SIGNUP_META_VERSION = 1;

export type SignupStatus =
  | "account_created"
  | "payment_pending"
  | "paid"
  | "provisioning"
  | "provisioned"
  | "failed";

export type ProvisionMilestone =
  | "validated"
  | "payment_verified"
  | "brand_ready"
  | "workspace_created"
  | "account_linked"
  | "billing_ready"
  | "subscription_linked"
  | "site_published";

/**
 * Ordered, length exactly 8. The boot screen divides by this length, and
 * apps/web/src/components/onboarding/onboarding-types.ts declares the same
 * eight strings — renaming one side only breaks the progress bar silently.
 */
export const PROVISION_MILESTONES: ProvisionMilestone[] = [
  "validated",
  "payment_verified",
  "brand_ready",
  "workspace_created",
  "account_linked",
  "billing_ready",
  "subscription_linked",
  "site_published",
];

export interface SignupBusinessSnapshot {
  companyName: string;
  slug: string;
  location?: string;
  businessPhone?: string;
  fleetSize?: string;
  vehicleType?: string;
  businessColours?: string;
  logoUrl?: string;
  operatingSchedule?: {
    alwaysOpen?: boolean;
    days?: string[];
    opensAt?: string;
    closesAt?: string;
  };
}

export interface SignupMetadata {
  v: 1;
  status: SignupStatus;
  planId: string;
  fullName: string;
  email: string;
  /**
   * Stripe mode LOCKED at account creation. Read this rather than
   * SIGNUP_STRIPE_MODE on every later step: if the env var is flipped while a
   * signup is in flight, re-reading it would look the subscription up on the
   * wrong Stripe account, where it does not exist — which reads as "never paid".
   */
  mode: "test" | "live";
  createdAt: string;
  updatedAt: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  paymentAttempts?: number;
  paidAt?: string;
  business?: SignupBusinessSnapshot;
  /**
   * Set the moment `signup-provision` inserts the tenant row, and cleared when
   * it is promoted to `tenantId` (or rolled back).
   *
   * It exists because the tenant row is created LONG before the run finishes,
   * and an isolate that is killed in between (wall-clock limit, redeploy, OOM)
   * would otherwise leave a tenant nothing points at: the retry would restart
   * from scratch, find its own slug taken and hand a customer who has already
   * been charged a permanent "that web address is taken".
   *
   * It is deliberately NOT `tenantId`. `tenantId` means "provisioned, and safe
   * to hand the operator" — the idempotency short-circuit returns a success
   * response for it. A tenant that only got as far as this key may have no
   * owner account and no subscription row yet, so the retry inspects it and
   * either promotes it or discards it.
   */
  pendingTenantId?: string | null;
  tenantId?: string;
  slug?: string;
  portalUrl?: string;
  bookingUrl?: string;
  portalSignInUrl?: string | null;
  contentSeeded?: boolean;
  milestones?: ProvisionMilestone[];
  provisionAttempts?: number;
  /** ISO. A lock older than PROVISION_LOCK_MS is treated as stale and taken over. */
  provisionLockAt?: string | null;
  lastError?: { code: string; message: string; at: string } | null;
}

/**
 * How long a provisioning lock is honoured. Longer than the slowest observed
 * provision (8–25 s, dominated by the OpenAI palette call) but short enough
 * that a function killed mid-run does not strand the user forever: the retry
 * simply takes the lock over.
 */
export const PROVISION_LOCK_MS = 120_000;

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/** Read the signup blob off a GoTrue user object. Null when absent/foreign version. */
export function readSignupMeta(user: any): SignupMetadata | null {
  const raw = user?.app_metadata?.[SIGNUP_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  // A future version of this blob is not ours to interpret — treat it as absent
  // rather than half-reading a shape we do not know.
  if (raw.v !== SIGNUP_META_VERSION) return null;
  return raw as SignupMetadata;
}

/**
 * Read-modify-WRITE.
 *
 * GoTrue merges `app_metadata` SHALLOWLY, so writing `{ d247_signup: patch }`
 * REPLACES the whole blob with the patch — the first partial write would drop
 * the Stripe ids and the user could never be resumed. This helper therefore
 * always re-reads the current blob, merges in JS, and writes the complete
 * object back. `provider`/`providers` are preserved by GoTrue itself.
 *
 * Re-reading (rather than trusting an in-memory copy) is deliberate: it is the
 * only thing that makes a milestone write from a long-running provision safe
 * against any concurrent write.
 */
export async function writeSignupMeta(
  supabase: any,
  authUserId: string,
  patch: Partial<SignupMetadata>,
): Promise<SignupMetadata> {
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error) throw new Error(`Could not read signup metadata: ${error.message ?? error}`);

  const current = readSignupMeta(data?.user) ?? ({} as Partial<SignupMetadata>);
  const merged: SignupMetadata = {
    ...(current as SignupMetadata),
    ...patch,
    v: SIGNUP_META_VERSION,
    updatedAt: new Date().toISOString(),
  } as SignupMetadata;

  const { error: updateError } = await supabase.auth.admin.updateUserById(authUserId, {
    app_metadata: { [SIGNUP_META_KEY]: merged },
  });
  if (updateError) {
    throw new Error(`Could not write signup metadata: ${updateError.message ?? updateError}`);
  }
  return merged;
}

/**
 * Append a milestone, idempotently. This is what the boot screen polls, so it
 * must land as each SERVER step actually completes — never ahead of it.
 *
 * Never throws: a failed metadata write must not roll back a tenant that was
 * genuinely created. The consequence of a dropped milestone is a progress bar
 * that jumps, not a broken provision, and the final `status: "provisioned"`
 * write plus the HTTP response both still resolve the screen.
 */
export async function markMilestone(
  supabase: any,
  authUserId: string,
  milestone: ProvisionMilestone,
): Promise<void> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(authUserId);
    if (error) throw error;

    const current = readSignupMeta(data?.user);
    const existing = Array.isArray(current?.milestones) ? current!.milestones! : [];
    if (existing.includes(milestone)) return;

    await writeSignupMeta(supabase, authUserId, { milestones: [...existing, milestone] });
  } catch (e) {
    console.warn(`[signup-state] could not record milestone "${milestone}" (non-fatal):`, e);
  }
}

// ---------------------------------------------------------------------------
// Errors
//
// `code` is the contract the UI branches on; `error` is a human fallback for
// codes a given client build does not know yet. The union lives in
// apps/web/src/components/onboarding/onboarding-types.ts — kept as a plain
// string here so the server can add a code without a client deploy.
// ---------------------------------------------------------------------------
export type SignupErrorCode = string;

export function signupError(
  code: SignupErrorCode,
  message: string,
  status: number,
  detail?: Record<string, unknown>,
): Response {
  return jsonResponse({ error: message, code, ...(detail ? { detail } : {}) }, status);
}

// ---------------------------------------------------------------------------
// Abuse controls
// ---------------------------------------------------------------------------

/**
 * Explicitly a speed bump, not a wall — there are thousands of disposable
 * domains and this list is ~30. It exists because the email IS the login for a
 * paid portal, so a throwaway address guarantees a support ticket later.
 */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "yopmail.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "trashmail.com",
  "throwawaymail.com",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "fakeinbox.com",
  "maildrop.cc",
  "mintemail.com",
  "mytemp.email",
  "emailondeck.com",
  "moakt.com",
  "spamgourmet.com",
  "mailnesia.com",
  "tempr.email",
  "discard.email",
  "inboxbear.com",
  "byom.de",
  "burnermail.io",
  "mail-temporaire.fr",
  "harakirimail.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  return !!domain && DISPOSABLE_DOMAINS.has(domain);
}

/**
 * First hop of `x-forwarded-for`, else `cf-connecting-ip`, else null.
 *
 * The FIRST hop is the client; every later entry is a proxy we added. Reading
 * the last hop would rate-limit our own edge network as a single IP and lock
 * out every signup at once.
 *
 * A null IP SKIPS the IP rule rather than blocking — an unidentifiable caller
 * is not evidence of abuse, and blocking would take out anyone behind a proxy
 * that strips the header.
 */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0]?.trim();
  if (first) return first.slice(0, 100);
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  return cf ? cf.slice(0, 100) : null;
}

export interface ThrottleRule {
  /**
   * One of the scopes in the spec's abuse table: `signup_begin_ip`,
   * `signup_begin_email`, `signup_slug_check`, `signup_payment_intent`,
   * `signup_provision`. The `_ip` / `_email` suffix tells the ledger which
   * column `key` belongs in; anything else is keyed on the auth user id.
   */
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}

/**
 * Every column of `public.signup_attempts`, exactly as
 * supabase/migrations/20260802120000_add_signup_attempts.sql declares them.
 * `recordAttempt` filters its input to this set.
 */
const SIGNUP_ATTEMPT_COLUMNS = [
  "scope",
  "ip_address",
  "email",
  "auth_user_id",
  "plan_id",
  "outcome",
  "error_code",
  "stripe_customer_id",
  "stripe_subscription_id",
  "tenant_id",
  "metadata",
] as const;

/** Ledger the current isolate settled on, so we probe at most once per cold start. */
type Ledger = "signup_attempts" | "login_attempts" | "none";
let resolvedLedger: Ledger | null = null;

/**
 * PostgREST's "that relation does not exist" family.
 *
 * `42P01` is the Postgres code; PGRST205/PGRST202 are PostgREST's own schema
 * cache misses, which is what you actually get when the optional migration has
 * never been applied. Matching the message too covers older gateway versions.
 */
function isMissingRelation(err: any): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") return true;
  const msg = String(err.message ?? err.hint ?? "");
  return /could not find the table|does not exist|schema cache/i.test(msg);
}

/** Which `signup_attempts` column `key` belongs in, derived from the scope name. */
function keyColumn(scope: string): "ip_address" | "email" | "auth_user_id" {
  if (scope.endsWith("_ip")) return "ip_address";
  if (scope.endsWith("_email")) return "email";
  return "auth_user_id";
}

/** `signup_attempts.scope` — the base action, without the keying suffix. */
export function ledgerScope(scope: string): string {
  return scope.replace(/^signup_/, "").replace(/_(ip|email|user)$/, "");
}

/**
 * True when the caller is UNDER the limit (allowed to proceed).
 *
 * Ledger preference:
 *   1. `public.signup_attempts` — the optional migration. RLS on, service_role
 *      only, so it is a real control.
 *   2. `public.login_attempts` — exists today. Rows are written with
 *      `username = "signup:<scope>:<key>"` so they are visually distinct from
 *      real login attempts and can never confuse `auth-rate-limit`, which
 *      matches on the exact email. STOPGAP ONLY: that table has
 *      `RLS USING (true)` and `GRANT ALL TO anon`, so an anon-key holder can
 *      delete rows and walk straight past this.
 *   3. Neither reachable → FAIL CLOSED. `signup-begin` runs with
 *      `verify_jwt = false` and mass-creates confirmed `auth.users` rows with
 *      the service role, which bypasses GoTrue's own signup limits — so this is
 *      the ONLY thing standing between a script and permanently squatting
 *      arbitrary email addresses. An unmeasurable ledger is not evidence that
 *      a caller is under the limit, and `login_attempts` lives in the same
 *      database the rest of the request needs anyway: if it cannot be read, the
 *      signup was not going to succeed regardless. The refusal is deliberately
 *      NOT sticky — the next call re-reads, so one transient blip does not
 *      close the door for the life of the isolate.
 *
 * Only GATE rows (`outcome` 'allowed' / 'blocked') are counted, so the richer
 * `'ok'` / `'error'` audit rows written later in the same request never eat
 * into a caller's own budget.
 *
 * Never throws.
 */
export async function checkThrottle(supabase: any, rules: ThrottleRule[]): Promise<boolean> {
  const usable = rules.filter((r) => r && r.key && r.limit > 0);
  if (!usable.length) return true;

  for (const rule of usable) {
    const since = new Date(Date.now() - rule.windowMs).toISOString();
    let count: number | null = null;

    if (resolvedLedger === null || resolvedLedger === "signup_attempts") {
      try {
        const { count: c, error } = await supabase
          .from("signup_attempts")
          .select("id", { count: "exact", head: true })
          .eq("scope", ledgerScope(rule.scope))
          .eq(keyColumn(rule.scope), rule.key)
          .in("outcome", ["allowed", "blocked"])
          .gte("created_at", since);

        if (error) {
          if (!isMissingRelation(error)) throw error;
          if (resolvedLedger === null) {
            console.warn(
              "[signup-state] public.signup_attempts is absent — falling back to login_attempts. " +
                "Apply supabase/migrations/20260802120000_add_signup_attempts.sql for a real control.",
            );
          }
          resolvedLedger = "login_attempts";
        } else {
          resolvedLedger = "signup_attempts";
          count = c ?? 0;
        }
      } catch (e) {
        console.warn("[signup-state] signup_attempts throttle read failed:", e);
        resolvedLedger = "login_attempts";
      }
    }

    if (count === null) {
      if (resolvedLedger === "none") {
        // A previous call in this isolate could not WRITE the counter, so no
        // count read here can mean anything. Refuse rather than wave it through.
        console.error(
          `[signup-state] throttle counter is unwritable — failing CLOSED for ${rule.scope}`,
        );
        return false;
      }
      try {
        const { count: c, error } = await supabase
          .from("login_attempts")
          .select("id", { count: "exact", head: true })
          .eq("username", `signup:${rule.scope}:${rule.key}`)
          .gte("attempted_at", since);
        if (error) throw error;
        count = c ?? 0;
      } catch (e) {
        // Both ledgers are unreachable. Fail CLOSED — see the doc comment. The
        // ledger choice is deliberately left alone so the next call re-probes
        // instead of this isolate refusing every signup from here on.
        console.error("[signup-state] no usable throttle ledger — failing CLOSED:", e);
        return false;
      }
    }

    if (count !== null && count >= rule.limit) {
      console.warn(
        `[signup-state] throttled ${rule.scope} for "${rule.key}": ${count} >= ${rule.limit} in ${rule.windowMs}ms`,
      );
      return false;
    }
  }

  return true;
}

/**
 * Best-effort audit + counter row. Never throws, never blocks a signup.
 *
 * `row.outcome` drives whether this counts against the throttle:
 *   'allowed' | 'blocked'  → a GATE row; counted.
 *   'ok' | 'error'         → an OUTCOME row; recorded for support, not counted.
 *
 * The `login_attempts` fallback stores gate rows only — it is a counter, not an
 * audit log, and writing outcome rows there would pollute a table the login
 * screen also reads.
 */
export async function recordAttempt(supabase: any, row: Record<string, unknown>): Promise<void> {
  const outcome = String(row.outcome ?? "ok");
  const isGate = outcome === "allowed" || outcome === "blocked";

  if (resolvedLedger !== "login_attempts" && resolvedLedger !== "none") {
    // Only real columns may reach PostgREST — `throttleScope`/`throttleKey` are
    // routing hints for the login_attempts fallback below, not table columns,
    // and sending them would 400 the insert (which reads as "table missing"
    // and would wrongly demote the ledger for the rest of the isolate's life).
    const persisted: Record<string, unknown> = {};
    for (const col of SIGNUP_ATTEMPT_COLUMNS) {
      if (row[col] !== undefined) persisted[col] = row[col];
    }

    try {
      const { error } = await supabase.from("signup_attempts").insert(persisted);
      if (!error) {
        resolvedLedger = "signup_attempts";
        return;
      }
      if (!isMissingRelation(error)) throw error;
      resolvedLedger = "login_attempts";
    } catch (e) {
      if (resolvedLedger === null) {
        console.warn("[signup-state] could not write signup_attempts (non-fatal):", e);
      }
      resolvedLedger = "login_attempts";
    }
  }

  if (!isGate || resolvedLedger === "none") return;

  /*
   * Fallback counter — ONE ROW PER RULE, not one per request.
   *
   * `checkThrottle` counts `signup:<scope>:<key>` for each rule independently.
   * Writing a single row keyed on whichever identifier the caller happened to
   * pick therefore leaves every OTHER rule counting zero for ever: with one row
   * keyed on the IP, `signup_begin_email` always found 0 attempts and always
   * allowed, so an attacker rotating IPs faced no per-address limit at all.
   *
   * `throttleRules` is the supported shape. `throttleScope`/`throttleKey` are
   * kept for the single-rule callers, which are the majority.
   */
  const rules: { scope: string; key: string }[] = Array.isArray(row.throttleRules)
    ? (row.throttleRules as { scope?: unknown; key?: unknown }[]).map((r) => ({
      scope: String(r?.scope ?? row.scope ?? "signup"),
      key: String(r?.key ?? ""),
    }))
    : [{
      scope: String(row.throttleScope ?? row.scope ?? "signup"),
      key: String(row.throttleKey ?? ""),
    }];

  const usable = rules.filter((r) => r.key);
  if (!usable.length) return;

  const attemptedAt = new Date().toISOString();
  try {
    const { error } = await supabase.from("login_attempts").insert(
      usable.map((r) => ({
        username: `signup:${r.scope}:${r.key}`,
        ip_address: (row.ip_address as string) ?? null,
        success: outcome === "allowed",
        attempted_at: attemptedAt,
      })),
    );
    if (error) throw error;
  } catch (e) {
    // The counter cannot be incremented, so nothing downstream can be measured.
    // Recording that makes `checkThrottle` refuse rather than wave callers
    // through on a count it knows is meaningless.
    console.error("[signup-state] could not write login_attempts counter:", e);
    resolvedLedger = "none";
  }
}
