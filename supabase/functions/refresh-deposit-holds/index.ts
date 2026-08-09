// Keep security-deposit authorizations alive across a long rental by CHAINING
// them: before each authorization expires, cancel it and place a replacement on
// the saved card. A single card authorization can never exceed ~30 days (Visa
// is 29d18h; accounts without extended authorization — GMT's included — get the
// ~5-7 day network default), so a 90-120 day rental needs 4-18 links and the
// RELIABILITY OF EACH LINK is the whole engineering problem.
//
// This file is only the DRIVER: which rentals are due, in what order, how many
// per run, and the run's heartbeat. Every per-rental decision lives in
// `_shared/deposit-hold-refresh.ts`, which `sandbox-refresh-deposit-holds`
// imports too — the two were hand-maintained verbatim forks, so the Time
// Machine was green-lighting logic production no longer ran.
//
// Driver-level fixes over the old version:
//   * ORDERED and LIMITED. The old loop was serial and unbounded; Supabase edge
//     functions die at 150s idle / 400s wall clock, stranding rows in
//     'refreshing' that nothing reaps.
//   * NULL-safe due filter. `.lt()` against a NULL deposit_hold_expires_at
//     yields NULL, not true, so rows with no known expiry were invisible.
//   * Picks up 'failed' rows whose backoff has elapsed. Failure is no longer
//     terminal, so the driver has to be the thing that retries — but ONLY the
//     'failed' rows that evidence a real prior authorization (a PaymentIntent
//     or a deposit_hold_placed_at stamp). The Stripe webhooks write the same
//     'failed' status when the FIRST placement never succeeded, and those rows
//     are not this engine's to touch. See HOLD_HISTORY_PREDICATE.
//   * Rental lifecycle is now a terminal-status DENY list rather than an
//     ('Active','Pending') allow list, so a status nobody enumerated cannot
//     silently end a chain.
//   * Writes a cron_runs heartbeat so "no alerts" can be told apart from "the
//     job is dead".
//   * ALERTS. Every non-healthy outcome now raises an operator bell — inside the
//     engine for anything that writes a status, and in this file for the two
//     things only the driver can see: an engine that threw (breaking its own
//     return-don't-throw contract) and the per-tenant `config_unavailable`
//     aggregate. Before this, a chain that died on day 45 of a 90-day rental was
//     discovered when the car came back.
//
// AUTH: `verify_jwt = false` in config.toml (pg_cron carries no user JWT), so
// the API gateway lets anonymous requests through and the check in THIS file is
// the only gate. It accepts either:
//   * `x-platform-secret` — what pg_cron sends, validated by the
//     `platform_verify_secret(p_secret)` DB RPC, or
//   * `Authorization: Bearer <super-admin user JWT>` — manual dispatch from the
//     portal/admin UI.
// Anything else is 401. This function accepts a caller-supplied
// `only_rental_id` and applies it as a filter, and a refresh is DESTRUCTIVE (it
// cancels the live authorisation before placing its replacement), so an
// unauthenticated caller who merely knew a rental UUID could previously force a
// cancel-and-reauthorize on a live hold. Deliberately NOT the service-role
// bearer: a valid production service_role JWT is committed in plaintext at
// supabase/migrations/20260520170000_schedule_tesla_sync_cron.sql and is pending
// rotation, so it is not a credential anything new should trust.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  refreshOneHold,
  applyDueHoldFilters,
  HOLD_REFRESH_COLUMNS,
  DEFAULT_BATCH_LIMIT,
  MAX_HOLD_ATTEMPTS,
  type RefreshOutcome,
} from "../_shared/deposit-hold-refresh.ts";
import {
  notifyDepositHoldFailure,
  notifyDepositHoldConfigBlocked,
} from "../_shared/deposit-hold-notify.ts";

const JOB_NAME = "refresh-deposit-holds";

/**
 * Wall-clock budget for the rental loop. Supabase kills an edge function at
 * ~400s; we stop well short so the cron_runs row and the response are always
 * written. Anything left over is reported as `truncated` and picked up by the
 * next run — which is safe now that ordering is deterministic (oldest deadline
 * first).
 */
const LOOP_BUDGET_MS = 240_000;

const LOG = "[DEPOSIT-REFRESH]";

/**
 * The only gate on this endpoint (see the AUTH note in the file header).
 *
 * Accepts EITHER the platform secret (pg_cron) OR a super-admin user JWT
 * (manual dispatch). Mirrors `onboarding-daily-digest` and
 * `platform-rental-notify` rather than inventing a scheme, so there is exactly
 * one internal-caller credential to rotate.
 *
 * Fails SAFE: every error path — a missing env var, an RPC error, a GoTrue
 * outage, a failed app_users lookup — returns false. An outage that made this
 * return true would expose a destructive money path.
 *
 * @param supabase a SERVICE-ROLE client. `platform_verify_secret` is
 *   service-role-only, and the app_users lookup must not be filtered by RLS.
 */
// deno-lint-ignore no-explicit-any
async function isAuthorizedCaller(req: Request, supabase: any): Promise<boolean> {
  // 1. Platform secret — the cron path. Validated by a DB RPC so the secret
  //    itself never has to be present in this function's environment.
  const secret = req.headers.get("x-platform-secret");
  if (secret) {
    try {
      const { data: ok, error } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
      if (error) console.error(LOG, "platform_verify_secret rpc failed:", error.message);
      else if (ok === true) return true;
    } catch (err) {
      console.error(LOG, "platform_verify_secret rpc threw:", err);
    }
  }

  // 2. Super-admin user JWT — the manual-dispatch path.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    console.error(LOG, "SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot verify a user JWT; denying.");
    return false;
  }

  let userId: string | null = null;
  try {
    const authClient = createClient(supabaseUrl, anonKey);
    // NOTE: the anon key and the service-role key are themselves valid project
    // JWTs, but neither carries a `sub`, so getUser() yields no user for them.
    // That is what stops a bare apikey — or the leaked service_role key — from
    // walking through this branch.
    const { data, error } = await authClient.auth.getUser(token);
    if (error) {
      console.warn(LOG, "JWT rejected:", error.message);
      return false;
    }
    userId = data?.user?.id ?? null;
  } catch (err) {
    console.error(LOG, "getUser threw:", err);
    return false;
  }
  if (!userId) return false;

  // Filter on is_super_admin in the query and take the first row rather than
  // .single(): a principal with more than one app_users row would otherwise
  // make .single() error and lock a legitimate super admin out.
  const { data: rows, error: lookupError } = await supabase
    .from("app_users")
    .select("id")
    .eq("auth_user_id", userId)
    .eq("is_super_admin", true)
    .limit(1);
  if (lookupError) {
    console.error(LOG, "app_users lookup failed:", lookupError.message);
    return false;
  }
  return (rows?.length ?? 0) > 0;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Before the cron_runs heartbeat and before the body is read: an unauthorised
  // caller must not be able to write heartbeat rows either.
  if (!(await isAuthorizedCaller(req, supabase))) {
    console.warn(LOG, "Unauthorized call rejected");
    return errorResponse("Unauthorized", 401);
  }

  const startedAt = new Date();
  const startedMs = Date.now();
  let runId: string | null = null;

  try {
    console.log("[DEPOSIT-REFRESH] Starting deposit hold refresh check...");

    // Optional sandbox scoping. When `only_rental_id` is supplied (by the Time
    // Machine sandbox control), the refresh is restricted to that ONE rental so
    // a manual dispatch can never touch another tenant's holds. Absent (the
    // production cron) = unchanged global behaviour: process all due holds.
    let onlyRentalId: string | null = null;
    let batchLimit = DEFAULT_BATCH_LIMIT;
    try {
      const reqBody = await req.json();
      onlyRentalId = typeof reqBody?.only_rental_id === "string" ? reqBody.only_rental_id : null;
      const requested = Number(reqBody?.limit);
      if (Number.isFinite(requested) && requested > 0) batchLimit = Math.min(Math.floor(requested), 100);
    } catch { /* no/invalid body — global cron run */ }

    // Heartbeat row first, so a run that dies mid-loop still leaves evidence
    // (finished_at stays NULL — that is the dead-man signal).
    {
      const { data, error } = await supabase
        .from("cron_runs")
        .insert({ job_name: JOB_NAME, started_at: startedAt.toISOString() })
        .select("id")
        .maybeSingle();
      if (error) console.error("[DEPOSIT-REFRESH] Could not open cron_runs row:", error.message);
      runId = (data?.id as string) ?? null;
    }

    const now = new Date();

    // How many are due in total, independent of the batch we are about to take.
    // Without this a truncated run is indistinguishable from a quiet night.
    let totalDue: number | null = null;
    {
      // deno-lint-ignore no-explicit-any
      let countQuery: any = supabase.from("rentals").select("id", { count: "exact", head: true });
      countQuery = applyDueHoldFilters(countQuery, { now });
      if (onlyRentalId) countQuery = countQuery.eq("id", onlyRentalId);
      const { count, error } = await countQuery;
      if (error) console.error("[DEPOSIT-REFRESH] Count query failed:", error.message);
      totalDue = count ?? null;
    }

    // deno-lint-ignore no-explicit-any
    let refreshQuery: any = supabase.from("rentals").select(HOLD_REFRESH_COLUMNS);
    refreshQuery = applyDueHoldFilters(refreshQuery, { now });
    if (onlyRentalId) refreshQuery = refreshQuery.eq("id", onlyRentalId);
    // Oldest deadline first, and rows whose expiry we do NOT know (NULL — which
    // now includes every link that failed to place a replacement, i.e. an
    // UNSECURED rental) sort ahead of everything else.
    refreshQuery = refreshQuery
      .order("deposit_hold_expires_at", { ascending: true, nullsFirst: true })
      .limit(batchLimit);

    const { data: rentalsToRefresh, error: queryError } = await refreshQuery;

    if (queryError) {
      console.error("[DEPOSIT-REFRESH] Query error:", queryError);
      await closeRun(supabase, runId, { total_due: totalDue, error: queryError.message });
      return errorResponse("Failed to query rentals", 500);
    }

    const batch = (rentalsToRefresh ?? []) as Record<string, unknown>[];

    if (batch.length === 0) {
      console.log("[DEPOSIT-REFRESH] No holds need refreshing");
      await closeRun(supabase, runId, {
        total_due: totalDue ?? 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        truncated: false,
      });
      return jsonResponse({ success: true, refreshed: 0, failed: 0, total: 0, totalDue: totalDue ?? 0 });
    }

    console.log("[DEPOSIT-REFRESH] Found", batch.length, "holds to process (total due:", totalDue, ")");

    let refreshed = 0;
    let failed = 0;
    let skippedConfig = 0;
    let processed = 0;
    let truncated = (totalDue ?? batch.length) > batch.length;
    const errors: string[] = [];
    const results: RefreshOutcome[] = [];

    // One tenant row per batch, not per rental.
    const tenantCache = new Map<string, Record<string, unknown> | null>();

    // Rentals the engine left UNTOUCHED because a tenant/Stripe configuration
    // could not be resolved, grouped by tenant so one broken Connect account
    // raises one bell rather than one per rental.
    const configBlocked = new Map<string, { rentalIds: string[]; message: string }>();

    for (const rental of batch) {
      if (Date.now() - startedMs > LOOP_BUDGET_MS) {
        // Stop cleanly rather than being killed mid-Stripe-call with a row
        // parked in 'refreshing'. The remainder is genuinely still due and the
        // next run takes it in the same deterministic order.
        console.warn("[DEPOSIT-REFRESH] Wall-clock budget reached; stopping after", processed, "rentals");
        truncated = true;
        break;
      }

      // refreshOneHold's contract is that it returns rather than throws, but one
      // rental must never be able to take the rest of the batch down with it —
      // the old loop shared a single catch and a single tenantCache, so one
      // systemic fault at 03:00 could reach every live hold in one pass.
      let outcome: RefreshOutcome;
      try {
        outcome = await refreshOneHold(supabase, rental, {
          logPrefix: "[DEPOSIT-REFRESH]",
          actor: "cron",
          tenantCache,
          now: new Date(),
        });
      } catch (rentalErr) {
        const message = rentalErr instanceof Error ? rentalErr.message : String(rentalErr);
        console.error("[DEPOSIT-REFRESH] Engine threw for rental", rental.id, rentalErr);
        outcome = {
          rentalId: String(rental.id),
          result: "needs_review",
          message: `engine threw: ${message}`,
          untouched: false,
        };
        // ALERT — exit 3 of 3 outside the engine's finish() funnel. The engine's
        // contract is that it returns rather than throws, so reaching here means
        // that contract broke: nothing inside it can have written a status, and
        // the row is left in whatever state the throw interrupted (very likely
        // 'refreshing', which the driver never re-selects). Without this the
        // rental is invisible until somebody opens it.
        //
        // notifyDepositHoldFailure never throws, so it is safe in this catch.
        await notifyDepositHoldFailure({
          rental,
          result: "needs_review",
          status: "needs_review",
          message: `engine threw: ${message}`,
          errorMessage: message,
          errorCode: "engine_threw",
          // The throw could have happened anywhere — before the incumbent was
          // cancelled, or after a replacement was created. We cannot tell, so
          // the alert makes no claim about whether the renter is still secured.
          moneyState: "unknown",
          // Matches the seq the engine would have claimed the row with, so an
          // alert it managed to raise before dying dedupes against this one.
          attemptSeq: Number(rental.deposit_hold_attempt_seq ?? 0) + 1,
          maxAttempts: MAX_HOLD_ATTEMPTS,
          detail:
            "The refresh engine itself threw, so the hold status may not have been written at all — " +
            "check this rental's hold state against Stripe.",
          source: "cron",
          supabase,
        });
      }
      processed++;
      results.push(outcome);

      if (outcome.result === "refreshed") {
        refreshed++;
      } else if (outcome.result === "config_unavailable") {
        // NOT a failure. These are the rows the engine deliberately left
        // UNTOUCHED because the tenant row or the Connect account could not be
        // resolved — no hold is in trouble, a configuration is. Counting them
        // in `failed` meant one mis-configured tenant reported a non-zero
        // failure count on every run forever, which trains whoever watches
        // cron_runs.failed to ignore it — eroding the exact dead-man signal
        // this driver exists to provide.
        skippedConfig++;
        console.warn(`[DEPOSIT-REFRESH] ${outcome.rentalId}: config unavailable — ${outcome.message}`);
        // …but "no hold is in trouble" is only true for THIS run. The row was
        // left untouched, so its authorization is not being renewed and will
        // lapse on the network's own schedule. Collected per TENANT because the
        // cause is one configuration, not N rentals — see the aggregated alert
        // after the loop.
        {
          const tid = String(rental.tenant_id ?? "");
          if (tid) {
            const entry = configBlocked.get(tid) ?? { rentalIds: [], message: outcome.message };
            entry.rentalIds.push(outcome.rentalId);
            configBlocked.set(tid, entry);
          }
        }
      } else if (
        outcome.result === "failed" ||
        outcome.result === "needs_review" ||
        outcome.result === "requires_action"
      ) {
        // 'released', 'skipped', 'lost_race' and 'chain_expired' are correct
        // outcomes, not failures — counting them would make the dead-man alert
        // cry wolf every time an auto-extend rental comes through.
        failed++;
        errors.push(`${outcome.rentalId}: ${outcome.result} — ${outcome.message}`);
      }
    }

    // ── The one non-per-rental bell. ──────────────────────────────────────────
    // `config_unavailable` is not a hold failure, which is why it stays out of
    // `failed` — but it IS a silent death: those authorizations simply stop
    // being renewed. One aggregated, day-deduped alert per affected tenant is
    // the difference between "the operator finds out" and "the counter on
    // cron_runs goes up and nobody reads it". Never throws.
    for (const [tid, entry] of configBlocked) {
      await notifyDepositHoldConfigBlocked({
        tenantId: tid,
        rentalIds: entry.rentalIds,
        sampleMessage: entry.message,
        source: "cron",
        now,
      });
    }

    // Read-only heads-up: rows parked in 'refreshing' by a run that was killed
    // mid-flight. This driver deliberately does NOT reap them — deciding whether
    // such a row's authorization exists requires probing Stripe, which belongs
    // to the reconciler, and guessing here is exactly how a renter ends up with
    // two live holds. Surfacing the count is what lets anyone notice.
    let stuckRefreshing = 0;
    {
      const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("rentals")
        .select("id", { count: "exact", head: true })
        .eq("deposit_hold_status", "refreshing")
        .lt("deposit_hold_status_changed_at", staleBefore);
      stuckRefreshing = count ?? 0;
      if (stuckRefreshing > 0) {
        console.warn("[DEPOSIT-REFRESH]", stuckRefreshing, "rental(s) stuck in 'refreshing' for over an hour");
      }
    }

    console.log(
      "[DEPOSIT-REFRESH] Complete. Refreshed:", refreshed,
      "Failed:", failed,
      "Skipped (config):", skippedConfig,
      "Processed:", processed,
      "Truncated:", truncated
    );

    await closeRun(supabase, runId, {
      total_due: totalDue ?? batch.length,
      processed,
      succeeded: refreshed,
      failed,
      truncated,
    });

    return jsonResponse({
      success: true,
      // Legacy response keys preserved — the Time Machine UI and existing
      // dispatch tooling read these.
      refreshed,
      failed,
      total: batch.length,
      totalDue: totalDue ?? batch.length,
      processed,
      truncated,
      // Rows left untouched because a tenant/Connect configuration could not be
      // resolved. Deliberately kept OUT of `failed` — see the loop above.
      skippedConfig,
      stuckRefreshing,
      results,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DEPOSIT-REFRESH] Error:", error);
    await closeRun(supabase, runId, { error: message });
    return errorResponse(message, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function closeRun(supabase: any, runId: string | null, patch: Record<string, unknown>) {
  if (!runId) return;
  const { error } = await supabase
    .from("cron_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("[DEPOSIT-REFRESH] Could not close cron_runs row:", error.message);
}
