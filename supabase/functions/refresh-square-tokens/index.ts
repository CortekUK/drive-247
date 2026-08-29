/**
 * refresh-square-tokens — the 30-day expiry defence.
 *
 * WHY THIS FUNCTION EXISTS AT ALL
 *
 * Nothing in this codebase has ever needed to refresh a payment credential.
 * Stripe Connect hands us a permanent account id, stores no secret, and
 * addresses the merchant with a `Stripe-Account` header. Square has none of
 * those properties: the per-merchant OAuth ACCESS TOKEN *is* the addressing, and
 * it EXPIRES IN 30 DAYS. Expiry is a pure clock event — no row changes, no
 * webhook fires, nothing data-driven can notice it. Without this cron every
 * Square tenant stops taking money simultaneously and silently, 30 days after
 * they connect.
 *
 * SHAPE: cloned from `refresh-accounting-tokens` (pg_cron jobid 49, every 10
 * minutes), which is the proven production precedent for Vault-backed tokens +
 * `refresh_failure_count` + a status flip + a portal reminder. Read that file
 * alongside this one; the divergences below are deliberate and each is
 * explained where it occurs.
 *
 * DIVERGENCES FROM THE ACCOUNTING ORIGINAL — all load-bearing:
 *
 *  1. WINDOW IS 7 DAYS, NOT 15 MINUTES. Square advises refreshing at least every
 *     7 days regardless of activity. Waiting until near the 30-day expiry means
 *     ONE failed run strands the tenant with no second chance. Xero/Zoho tokens
 *     live an hour, so a 15-minute window there is the equivalent safety margin.
 *
 *  2. THE REFRESH TOKEN IS NOT ROTATED. Square code-flow refresh tokens do not
 *     expire and are not consumed on use, so the accounting original's
 *     "did another worker rotate it out from under us?" vault re-read is
 *     inapplicable here. The equivalent race is guarded differently — see
 *     `alreadyRefreshedConcurrently` below.
 *
 *  3. WE NEVER WRITE TO `tenants`. The accounting original flips
 *     `integration_xero`/`integration_zoho_books` on the tenant row. Doing that
 *     here would be an incident: `trg_auto_resolve_go_live_requests` is
 *     `AFTER UPDATE … FOR EACH ROW` with NO column list, so it fires on EVERY
 *     `tenants` write — including one per token refresh, every run, forever.
 *     Square connection state lives entirely in `square_connections`.
 *
 *  4. ONLY AUTH-CLASS FAILURES SPEND THE EXPIRY BUDGET. The original increments
 *     `refresh_failure_count` for every failure and only *expires* on an
 *     auth-class one. Under a mixed sequence (429, 429, 401) that expires a
 *     perfectly healthy merchant on the FIRST real auth error. Expiry is not
 *     recoverable without dragging the operator back through Square's consent
 *     screen, so rate limits and 5xx record `last_error` and leave the counter
 *     alone.
 *
 *  5. MISSING PLATFORM CREDENTIALS NEVER EXPIRE A CONNECTION. If
 *     SQUARE_LIVE_APP_SECRET is unset, that is OUR misconfiguration, not the
 *     merchant's. Counting it toward the budget would expire every live Square
 *     tenant at once and force all of them to re-consent. It is recorded as a
 *     skip with a visible `last_error` instead.
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
 *
 *  - It does NOT raise the expiry-PROXIMITY alert (plan item A-8). That alert
 *    must live outside this function: a cron that stops being scheduled produces
 *    zero refresh failures, so an alert raised from inside the refresher is
 *    exactly the signal that dies with it. The `cron_runs` heartbeat below is
 *    the in-function half — a run that never starts leaves no row, and a run
 *    that dies mid-loop leaves `finished_at` NULL.
 *
 *  - It never flips status to 'revoked'. A merchant-initiated revocation arrives
 *    as the `oauth.authorization.revoked` webhook, which owns that transition.
 *    Square's error code is preserved in `last_error` and in the reminder
 *    context so the two causes remain distinguishable.
 *
 * Idempotent and safe to fire repeatedly: a connection already outside the
 * refresh window is skipped without an API call.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { refreshSquareToken, SQUARE_REFRESH_WINDOW_DAYS } from "../_shared/payments/square-oauth.ts";
import { SquareError, SquareMode } from "../_shared/payments/types.ts";

const LOG = "[refresh-square-tokens]";
const JOB_NAME = "refresh-square-tokens";

/** Consecutive AUTH-class failures before the connection is declared dead. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Square's documented OAuth access-token lifetime, used only as a fallback. */
const SQUARE_TOKEN_LIFETIME_DAYS = 30;

/**
 * Soft wall-clock budget. The platform hard-kills a long invocation, and a hard
 * kill leaves `cron_runs.finished_at` NULL — indistinguishable from a crash. We
 * stop short of that and record `truncated`, so "there are more to do" reads
 * differently from "something broke".
 */
const DEADLINE_MS = 60_000;

const MS_PER_DAY = 86_400_000;

const REMINDER_RULE_CODE = "SQUARE_CONNECTION_EXPIRED";

/**
 * Loosely-typed client, deliberately.
 *
 * There is no generated `Database` type on the Deno side of this repo, so a
 * fully-typed client resolves every table's row type to `never` and turns every
 * insert/update in this file into a compile error — `refresh-accounting-tokens`
 * carries 8 of exactly those today. Relaxing the schema generic (the same answer
 * `refresh-deposit-holds` reaches for) keeps `.from` / `.rpc` / `.select`
 * method-level typing intact while letting the row shapes through, so this file
 * passes `deno check` clean.
 */
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, "public", any>;

interface ConnectionRow {
  id: string;
  tenant_id: string;
  square_mode: SquareMode;
  token_expires_at: string | null;
  refresh_failure_count: number | null;
  last_error: string | null;
  merchant_id: string | null;
}

interface Summary {
  /** Connections inside the refresh window that this run considered. */
  checked: number;
  /** Access tokens successfully renewed and persisted. */
  refreshed: number;
  /** Refresh attempts that returned an error. */
  failed: number;
  /** Not attempted: no platform credentials, already refreshed elsewhere, or out of time. */
  skipped: number;
  /** Subset of `failed` where the budget was spent and status flipped to 'expired'. */
  expired: number;
  /** True when the deadline cut the batch short — the next tick picks up the rest. */
  truncated: boolean;
  errors: string[];
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const startedAt = new Date();
  const deadline = startedAt.getTime() + DEADLINE_MS;

  const supabase: Db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const summary: Summary = {
    checked: 0,
    refreshed: 0,
    failed: 0,
    skipped: 0,
    expired: 0,
    truncated: false,
    errors: [],
  };

  // Heartbeat FIRST, so a run that dies mid-loop still leaves evidence
  // (finished_at stays NULL — that is the dead-man signal). A run that was never
  // scheduled leaves no row at all, which is the signal this whole function
  // exists to make detectable.
  let runId: string | null = null;
  {
    const { data, error } = await supabase
      .from("cron_runs")
      .insert({ job_name: JOB_NAME, started_at: startedAt.toISOString() })
      .select("id")
      .maybeSingle();
    if (error) console.error(`${LOG} could not open cron_runs row:`, error.message);
    runId = (data?.id as string | undefined) ?? null;
  }

  try {
    // Refresh anything expiring within the window. `token_expires_at IS NULL` on
    // an ACTIVE row is anomalous — Square always returns expires_at, so a null
    // means the callback stored none. Refreshing heals it: the response carries a
    // real expiry which we then persist.
    const cutoffMs = Date.now() + SQUARE_REFRESH_WINDOW_DAYS * MS_PER_DAY;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const { data: candidatesRaw, error: selectError } = await supabase
      .from("square_connections")
      .select("id, tenant_id, square_mode, token_expires_at, refresh_failure_count, last_error, merchant_id")
      .eq("status", "active")
      .or(`token_expires_at.is.null,token_expires_at.lt.${cutoffIso}`)
      // Soonest-to-expire first: if the deadline truncates the batch, the rows
      // closest to going dark are the ones that got served.
      .order("token_expires_at", { ascending: true, nullsFirst: true });

    if (selectError) throw new Error(`candidate select failed: ${selectError.message}`);

    const candidates = (candidatesRaw ?? []) as unknown as ConnectionRow[];
    summary.checked = candidates.length;

    for (const conn of candidates) {
      if (Date.now() > deadline) {
        // Everything from here on is simply not attempted this tick. The window
        // is 7 days wide and the cron runs every 10 minutes, so there are ~1000
        // further chances before anything actually expires.
        summary.truncated = true;
        summary.skipped += 1;
        continue;
      }

      // Per-connection isolation: one bad tenant must never abort the batch.
      try {
        await refreshOne(supabase, conn, cutoffMs, summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.failed += 1;
        summary.errors.push(`${conn.tenant_id}/${conn.square_mode}: ${message}`);
        console.error(`${LOG} unhandled error for ${conn.tenant_id}/${conn.square_mode}:`, message);
      }
    }

    console.log(
      `${LOG} checked=${summary.checked} refreshed=${summary.refreshed} ` +
        `failed=${summary.failed} skipped=${summary.skipped} expired=${summary.expired} ` +
        `truncated=${summary.truncated}`,
    );

    await closeRun(supabase, runId, {
      total_due: summary.checked,
      processed: summary.refreshed + summary.failed,
      succeeded: summary.refreshed,
      failed: summary.failed,
      truncated: summary.truncated,
    });

    return jsonResponse(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(`${LOG} fatal:`, err);
    await closeRun(supabase, runId, {
      total_due: summary.checked,
      processed: summary.refreshed + summary.failed,
      succeeded: summary.refreshed,
      failed: summary.failed,
      truncated: summary.truncated,
      error: message.slice(0, 1000),
    });
    return errorResponse(message, 500);
  }
});

// ---------------------------------------------------------------------------
// One connection
// ---------------------------------------------------------------------------

async function refreshOne(
  supabase: Db,
  conn: ConnectionRow,
  cutoffMs: number,
  summary: Summary,
): Promise<void> {
  const mode: SquareMode = conn.square_mode === "live" ? "live" : "test";
  const label = `${conn.tenant_id}/${mode}`;

  // Platform credentials for this MODE. Square runs two physically separate
  // environments whose credentials are not interchangeable, so sandbox and
  // production have distinct app ids and secrets.
  const creds = appCredsFor(mode);
  if (!creds) {
    // NOT a merchant failure — see divergence 5. Recorded so it is visible in the
    // connection row and the portal, but the expiry budget is untouched.
    summary.skipped += 1;
    summary.errors.push(`${label}: square_app_credentials_missing`);
    console.error(`${LOG} ${label}: SQUARE_${mode === "live" ? "LIVE" : "TEST"}_APP_ID/_APP_SECRET not set`);
    await supabase
      .from("square_connections")
      .update({ last_error: "square_app_credentials_missing (platform misconfiguration — merchant unaffected)" })
      .eq("id", conn.id);
    return;
  }

  // Decrypt the stored tokens. This RPC is SECURITY DEFINER over the Vault and
  // is the ONLY way raw tokens are ever read — they are never stored in a column
  // and are never logged.
  const { data: tokenData, error: tokenError } = await supabase.rpc("square_get_tokens", {
    p_tenant_id: conn.tenant_id,
    p_square_mode: mode,
  });
  if (tokenError) {
    summary.failed += 1;
    summary.errors.push(`${label}: square_get_tokens failed: ${tokenError.message}`);
    // Transient by assumption: a DB error says nothing about the merchant's grant.
    await recordFailure(supabase, conn, "transient", `square_get_tokens: ${tokenError.message}`);
    return;
  }

  const tokenRow = (Array.isArray(tokenData) ? tokenData[0] : tokenData) as
    | { access_token?: string | null; refresh_token?: string | null; token_expires_at?: string | null }
    | null
    | undefined;

  if (!tokenRow) {
    // The RPC filters on status='active' itself. No row means the connection was
    // deactivated between our SELECT and now — a benign race, NOT a reason to
    // expire anything.
    summary.skipped += 1;
    console.log(`${LOG} ${label}: connection no longer active — skipping`);
    return;
  }

  // Concurrency guard (divergence 2). Square does not rotate refresh tokens, so
  // the accounting original's "has the stored refresh token changed?" test cannot
  // detect an overlapping run. What DOES change on a successful refresh is the
  // expiry, so compare the freshly-read expiry against the window: if another
  // tick already pushed it out, this row is done.
  const rpcExpiryMs = tokenRow.token_expires_at ? Date.parse(tokenRow.token_expires_at) : NaN;
  if (Number.isFinite(rpcExpiryMs) && rpcExpiryMs > cutoffMs) {
    summary.skipped += 1;
    console.log(`${LOG} ${label}: refreshed concurrently — skipping`);
    return;
  }

  const refreshToken = tokenRow.refresh_token ?? "";
  if (!refreshToken) {
    // Terminal on the first hit: there is nothing to retry WITH, so spending the
    // budget would only delay telling the operator.
    summary.failed += 1;
    summary.expired += await expireConnection(supabase, conn, mode, "no_refresh_token");
    summary.errors.push(`${label}: no_refresh_token`);
    return;
  }

  let fresh: Awaited<ReturnType<typeof refreshSquareToken>>;
  try {
    fresh = await refreshSquareToken({
      mode,
      applicationId: creds.applicationId,
      applicationSecret: creds.applicationSecret,
      refreshToken,
    });
  } catch (err) {
    const { cls, detail } = classifyFailure(err);
    summary.failed += 1;
    summary.errors.push(`${label}: ${detail}`);
    console.error(`${LOG} ${label}: refresh failed (${cls}) — ${detail}`);

    const failures = await recordFailure(supabase, conn, cls, detail);
    if (cls === "auth" && failures >= MAX_CONSECUTIVE_FAILURES) {
      summary.expired += await expireConnection(supabase, conn, mode, detail);
    }
    return;
  }

  if (!fresh.accessToken) {
    // A 2xx with no access_token is the Zoho-shaped footgun the accounting
    // original was bitten by: everything downstream computes from undefined and
    // the throw gets swallowed, so the connection quietly stops refreshing.
    const detail = "square_refresh_200_missing_access_token";
    summary.failed += 1;
    summary.errors.push(`${label}: ${detail}`);
    const failures = await recordFailure(supabase, conn, "auth", detail);
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      summary.expired += await expireConnection(supabase, conn, mode, detail);
    }
    return;
  }

  const expiry = resolveExpiry(fresh.expiresAt);
  if (!expiry.trusted) {
    // Never persist an unusable expiry. A NULL or past value re-qualifies the row
    // on the very next tick, which would hammer Square's token endpoint every 10
    // minutes forever. Fall back to Square's documented 30-day lifetime and say
    // so loudly.
    console.warn(`${LOG} ${label}: unusable expires_at ${JSON.stringify(fresh.expiresAt)} — assuming ${SQUARE_TOKEN_LIFETIME_DAYS}d`);
  }

  const { error: storeError } = await supabase.rpc("square_store_tokens", {
    p_tenant_id: conn.tenant_id,
    p_square_mode: mode,
    p_access_token: fresh.accessToken,
    // Square code-flow refresh tokens do not expire and are not rotated;
    // refreshSquareToken echoes the old one back when the response omits it, so
    // this write is idempotent AND still persists a rotation if Square ever
    // starts doing one.
    p_refresh_token: fresh.refreshToken || refreshToken,
    p_expires_at: expiry.iso,
    // '__keep__' sentinel: this is a credential rotation, not a re-connection.
    // The RPC honours it and leaves merchant_id untouched. Passing the id from
    // the refresh response instead would overwrite good metadata with whatever
    // the token endpoint happened to echo.
    p_merchant_id: "__keep__",
    // NULL means "keep the existing value" for each of these in the RPC's UPDATE
    // branch (COALESCE / empty-array checks). The refresh response carries none of
    // them, and re-deriving them here would mean extra Square API calls per tick.
    p_location_id: null,
    p_location_currency: null,
    p_business_name: null,
    p_scopes: null,
    p_connected_by: null,
  });

  if (storeError) {
    // The refresh SUCCEEDED but the write did not. Do NOT touch the failure
    // budget: the merchant's grant is demonstrably healthy. The row keeps its old
    // expiry, so the next tick simply tries again — which is safe precisely
    // because Square's refresh token is not consumed by use.
    summary.failed += 1;
    summary.errors.push(`${label}: square_store_tokens failed: ${storeError.message}`);
    console.error(`${LOG} ${label}: token refreshed but NOT persisted:`, storeError.message);
    await supabase
      .from("square_connections")
      .update({ last_error: `square_store_tokens: ${storeError.message}`.slice(0, 460) })
      .eq("id", conn.id);
    return;
  }

  // square_store_tokens' UPDATE branch already resets refresh_failure_count to 0
  // and clears last_error, so success needs no follow-up write. The budget is for
  // CONSECUTIVE failures, and that reset is what makes it consecutive.
  summary.refreshed += 1;
  console.log(`${LOG} ${label}: refreshed, expires ${expiry.iso}${expiry.trusted ? "" : " (assumed)"}`);
}

// ---------------------------------------------------------------------------
// Platform credentials (memoised — safe to call inside the loop)
// ---------------------------------------------------------------------------

interface AppCreds {
  applicationId: string;
  applicationSecret: string;
}

/**
 * Module-scoped cache. Env vars cannot change within an isolate's lifetime —
 * rotating a Supabase secret restarts the function — so caching is sound, and it
 * makes "is this mode configured?" one decision rather than one per connection.
 */
const credsCache = new Map<SquareMode, AppCreds | null>();

function appCredsFor(mode: SquareMode): AppCreds | null {
  const cached = credsCache.get(mode);
  if (cached !== undefined) return cached;

  const prefix = mode === "live" ? "SQUARE_LIVE" : "SQUARE_TEST";
  const applicationId = Deno.env.get(`${prefix}_APP_ID`) ?? "";
  const applicationSecret = Deno.env.get(`${prefix}_APP_SECRET`) ?? "";
  // Empty string is as absent as undefined — the getWebhookSecretCandidates
  // empty-string footgun in stripe-client.ts is the house lesson here.
  const creds: AppCreds | null = applicationId && applicationSecret
    ? { applicationId, applicationSecret }
    : null;

  credsCache.set(mode, creds);
  return creds;
}

// ---------------------------------------------------------------------------
// Failure classification and bookkeeping
// ---------------------------------------------------------------------------

/**
 * `auth`      — Square rejected the grant. Spends the expiry budget.
 * `transient` — rate limit, 5xx, network, DB. Recorded, budget untouched.
 */
type FailureClass = "auth" | "transient";

function classifyFailure(err: unknown): { cls: FailureClass; detail: string } {
  if (err instanceof SquareError) {
    const detail = `square_refresh_${err.httpStatus} ${err.category}/${err.code}: ${err.message}`;
    // Square answers a dead or revoked grant with 400/401/403 on /oauth2/token.
    // 429 (RATE_LIMITED) and 5xx say nothing about the grant and must never
    // accumulate toward expiry — see divergence 4.
    const isAuth = err.httpStatus === 400 || err.httpStatus === 401 || err.httpStatus === 403;
    return { cls: isAuth ? "auth" : "transient", detail };
  }
  return { cls: "transient", detail: err instanceof Error ? err.message : String(err) };
}

/** Returns the connection's failure count AFTER this attempt. */
async function recordFailure(
  supabase: Db,
  conn: ConnectionRow,
  cls: FailureClass,
  detail: string,
): Promise<number> {
  const current = conn.refresh_failure_count ?? 0;
  const failures = cls === "auth" ? current + 1 : current;
  const suffix = cls === "auth"
    ? ` (failure ${failures}/${MAX_CONSECUTIVE_FAILURES})`
    : " (transient — expiry budget not spent)";

  const { error } = await supabase
    .from("square_connections")
    .update({ last_error: `${detail.slice(0, 440)}${suffix}`, refresh_failure_count: failures })
    .eq("id", conn.id);
  if (error) console.error(`${LOG} could not record failure for ${conn.tenant_id}:`, error.message);

  return failures;
}

/**
 * Declare the connection dead and tell the operator.
 *
 * Returns 1 when the status actually flipped, 0 otherwise, so the caller can add
 * it straight into the summary without a second source of truth.
 */
async function expireConnection(
  supabase: Db,
  conn: ConnectionRow,
  mode: SquareMode,
  reason: string,
): Promise<number> {
  const { error } = await supabase.rpc("square_clear_tokens", {
    p_tenant_id: conn.tenant_id,
    p_square_mode: mode,
    p_new_status: "expired",
    p_error: reason.slice(0, 500),
  });
  if (error) {
    console.error(`${LOG} could not expire ${conn.tenant_id}/${mode}:`, error.message);
    return 0;
  }

  console.error(`${LOG} EXPIRED ${conn.tenant_id}/${mode}: ${reason}`);
  // NOTE: no `tenants` write here — see divergence 3.
  await raiseReminder(supabase, conn.tenant_id, mode, reason);
  return 1;
}

/**
 * Portal reminder so the operator sees "reconnect Square" instead of discovering
 * it through failed checkouts.
 *
 * `due_on` and `remind_on` are NOT NULL with no default and no trigger to fill
 * them — verified against the live schema. The accounting original omits both,
 * which is why zero `accounting_connection_expired` rows exist in production
 * despite that code path shipping: every insert it ever attempted violated a not
 * -null constraint and was swallowed. The shape below is copied from
 * `raiseEsignCreditAlert`, the precedent that provably inserts.
 *
 * Best-effort by design: a failure here must never turn a handled expiry into an
 * unhandled throw.
 */
async function raiseReminder(
  supabase: Db,
  tenantId: string,
  mode: SquareMode,
  reason: string,
): Promise<void> {
  try {
    // Dedupe rather than spam. The candidate query filters status='active' and
    // square_clear_tokens has just flipped this row away from 'active', so this
    // path normally runs once — but a re-connect that fails again must reuse the
    // open reminder rather than stack a second one.
    const { data: existing } = await supabase
      .from("reminders")
      .select("id")
      .eq("rule_code", REMINDER_RULE_CODE)
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "sent"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const today = nowIso.split("T")[0];
    const context = { provider: "square", square_mode: mode, reason: reason.slice(0, 200) };
    const message =
      "Your Square connection has expired and payments will fail until it is restored. " +
      "Reconnect from Settings → Payments to resume taking payments.";

    if (existing) {
      await supabase
        .from("reminders")
        .update({ message, context, last_sent_at: nowIso, updated_at: nowIso })
        .eq("id", (existing as { id: string }).id);
      return;
    }

    await supabase.from("reminders").insert({
      rule_code: REMINDER_RULE_CODE,
      // 'Integration' + object_id = tenant_id matches the ESIGN_LOW_CREDIT rows
      // already in production, so the portal's reminder list renders it unchanged.
      object_type: "Integration",
      object_id: tenantId,
      title: "Square connection expired — payments will fail",
      message,
      due_on: today,
      remind_on: today,
      // 'critical', not 'warning': a dead processor is a full stop on revenue,
      // not a nudge.
      severity: "critical",
      status: "pending",
      context,
      tenant_id: tenantId,
    });
  } catch (err) {
    console.warn(`${LOG} could not raise reminder for ${tenantId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Turn Square's `expires_at` into something safe to persist.
 *
 * `trusted: false` means we could not believe the response and substituted
 * Square's documented 30-day lifetime. The one-hour floor catches a value that
 * parses but is already in (or near) the past, which would otherwise re-qualify
 * the row on the next tick and loop forever.
 */
function resolveExpiry(raw: string | null | undefined): { iso: string; trusted: boolean } {
  const parsed = raw ? Date.parse(raw) : NaN;
  const floor = Date.now() + 60 * 60 * 1000;
  if (Number.isFinite(parsed) && parsed > floor) {
    return { iso: new Date(parsed).toISOString(), trusted: true };
  }
  return {
    iso: new Date(Date.now() + SQUARE_TOKEN_LIFETIME_DAYS * MS_PER_DAY).toISOString(),
    trusted: false,
  };
}

async function closeRun(
  supabase: Db,
  runId: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;
  const { error } = await supabase
    .from("cron_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error(`${LOG} could not close cron_runs row:`, error.message);
}
