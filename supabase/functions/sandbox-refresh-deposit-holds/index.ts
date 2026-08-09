// SANDBOX driver for the chained-hold refresh — Dev Panel "Time Machine" ONLY.
//
// This is a strict, FAIL-CLOSED, SINGLE-RENTAL variant. Unlike the real cron it
// has NO global path: it REFUSES to run without a valid `only_rental_id` (UUID),
// and — when `SANDBOX_TEST_TENANT_ID` is configured — REFUSES any rental not
// owned by that one designated test tenant. A `preview: true` request performs
// ZERO writes / ZERO Stripe / ZERO RPC / ZERO email and just reports which
// rentals its due-criteria would match (used by route.ts for the blast-radius
// pre-check).
//
// The refresh LOGIC is no longer copied. It was a hand-maintained verbatim fork
// whose header claimed parity, and since there are no tests anywhere this
// sandbox is the de-facto verification path — so a fork meant staging
// green-lit code production no longer ran. Both drivers now import
// `refreshOneHold` and the shared due-criteria from
// `_shared/deposit-hold-refresh.ts`; the ONLY differences that remain here are
// the three genuine ones: the fail-closed guard, the tenant lock, and preview.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  refreshOneHold,
  applyDueHoldFilters,
  HOLD_REFRESH_COLUMNS,
} from "../_shared/deposit-hold-refresh.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_NAME = "sandbox-refresh-deposit-holds";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const SANDBOX_TENANT = Deno.env.get("SANDBOX_TEST_TENANT_ID") || null;
  // FAIL-CLOSED: without the designated-tenant env this sandbox must not run at all.
  if (!SANDBOX_TENANT) {
    return json({ success: false, error: "sandbox: SANDBOX_TEST_TENANT_ID is not configured" }, 412);
  }

  // ── FAIL-CLOSED scope parse — no valid single-rental id => refuse. ──────────
  // deno-lint-ignore no-explicit-any
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const onlyRentalId = typeof body?.only_rental_id === "string" ? body.only_rental_id.trim() : "";
  const preview = body?.preview === true;
  if (!UUID_RE.test(onlyRentalId)) {
    return json({ success: false, error: "sandbox: a valid only_rental_id (UUID) is required" }, 400);
  }

  let runId: string | null = null;

  try {
    console.log("[SandboxDepositRefresh] Starting deposit hold refresh check...");

    // ── TENANT-LOCK: resolve the target rental and confirm it belongs to the
    //    designated test tenant before doing anything else. ─────────────────
    const { data: target, error: targetErr } = await supabase
      .from("rentals").select("id, tenant_id").eq("id", onlyRentalId).maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ success: false, error: "sandbox: rental not found" }, 404);
    if (SANDBOX_TENANT && target.tenant_id !== SANDBOX_TENANT) {
      return json({ success: false, error: "sandbox: rental is not in the designated test tenant" }, 403);
    }

    const now = new Date();

    // ── Due-criteria query — the SAME shared predicate the production driver
    //    uses (so the harness cannot silently diverge), ALWAYS hard-scoped to
    //    the one rental id. There is no code path that omits that filter. ────
    // deno-lint-ignore no-explicit-any
    let refreshQuery: any = supabase.from("rentals").select(HOLD_REFRESH_COLUMNS);
    refreshQuery = applyDueHoldFilters(refreshQuery, { now });
    refreshQuery = refreshQuery
      .eq("id", onlyRentalId)
      .order("deposit_hold_expires_at", { ascending: true, nullsFirst: true })
      .limit(1);

    const { data: rentalsToRefresh, error: queryError } = await refreshQuery;

    if (queryError) {
      console.error("[SandboxDepositRefresh] Query error:", queryError);
      return json({ success: false, error: "Failed to query rentals" }, 500);
    }

    const batch = (rentalsToRefresh ?? []) as Record<string, unknown>[];
    const matchedRentalIds = batch.map((r) => r.id as string);

    // ── PREVIEW (blast-radius) — zero writes / zero Stripe, just report match. ─
    if (preview) return json({ success: true, preview: true, matchedRentalIds });

    if (batch.length === 0) {
      console.log("[SandboxDepositRefresh] No holds need refreshing");
      return json({ success: true, refreshed: 0, matchedRentalIds: [] });
    }

    // Defensive: scoped by unique id, so this must be exactly the target.
    if (batch.length !== 1 || batch[0].id !== onlyRentalId) {
      return json({ success: false, error: "sandbox: blast-radius assertion failed" }, 500);
    }

    // Heartbeat, same as production — the harness exercises the observability
    // path too, and a sandbox run that dies mid-flight leaves the same evidence.
    {
      const { data, error } = await supabase
        .from("cron_runs")
        .insert({ job_name: JOB_NAME, started_at: now.toISOString(), total_due: batch.length })
        .select("id")
        .maybeSingle();
      if (error) console.error("[SandboxDepositRefresh] Could not open cron_runs row:", error.message);
      runId = (data?.id as string) ?? null;
    }

    console.log("[SandboxDepositRefresh] Found", batch.length, "holds to refresh");

    const outcome = await refreshOneHold(supabase, batch[0], {
      logPrefix: "[SandboxDepositRefresh]",
      actor: "sandbox",
      now: new Date(),
    });

    const refreshed = outcome.result === "refreshed" ? 1 : 0;
    // 'config_unavailable' is counted separately from 'failed', exactly as in
    // production: it means the row was left UNTOUCHED because a tenant/Connect
    // configuration could not be resolved, not that a hold is in trouble.
    const skippedConfig = outcome.result === "config_unavailable" ? 1 : 0;
    const failed =
      outcome.result === "failed" ||
      outcome.result === "needs_review" ||
      outcome.result === "requires_action"
        ? 1
        : 0;

    if (runId) {
      const { error } = await supabase
        .from("cron_runs")
        .update({
          finished_at: new Date().toISOString(),
          processed: 1,
          succeeded: refreshed,
          failed,
          truncated: false,
        })
        .eq("id", runId);
      if (error) console.error("[SandboxDepositRefresh] Could not close cron_runs row:", error.message);
    }

    console.log("[SandboxDepositRefresh] Complete:", outcome.result, "-", outcome.message);

    return json({
      success: true,
      refreshed,
      failed,
      skippedConfig,
      total: 1,
      matchedRentalIds,
      results: [outcome],
      ...(failed ? { errors: [`${outcome.rentalId}: ${outcome.result} — ${outcome.message}`] } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[SandboxDepositRefresh] Error:", error);
    if (runId) {
      await supabase
        .from("cron_runs")
        .update({ finished_at: new Date().toISOString(), error: message })
        .eq("id", runId);
    }
    return json({ success: false, error: message }, 500);
  }
});
