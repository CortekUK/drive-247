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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  refreshOneHold,
  applyDueHoldFilters,
  HOLD_REFRESH_COLUMNS,
  DEFAULT_BATCH_LIMIT,
  type RefreshOutcome,
} from "../_shared/deposit-hold-refresh.ts";

const JOB_NAME = "refresh-deposit-holds";

/**
 * Wall-clock budget for the rental loop. Supabase kills an edge function at
 * ~400s; we stop well short so the cron_runs row and the response are always
 * written. Anything left over is reported as `truncated` and picked up by the
 * next run — which is safe now that ordering is deterministic (oldest deadline
 * first).
 */
const LOOP_BUDGET_MS = 240_000;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

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
