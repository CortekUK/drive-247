/**
 * revenue-optimiser-anomaly-check — Spec §13.
 *
 * 6-hourly cron. Three detectors run in sequence; each writes rows into
 * `revenue_optimiser_anomalies`. Detectors are idempotent: each fires once
 * per source-row by checking for an existing open anomaly first.
 *
 *   D1. Large-swing pending recs   (|delta| > 25% of current price)
 *   D2. Apply-then-revert <24h     (operator distrust signal)
 *   D3. Tenant utilisation drop    (post-apply 7d utilisation < pre-apply by
 *                                   the tenant's auto_pause_threshold_percent;
 *                                   also pauses the fleet when configured)
 *
 * Notes:
 *  - The "tenant utilisation drop" detector pauses autopilot when
 *    `auto_pause_on_utilization_drop` is true on revenue_optimiser_settings.
 *    Pausing = update revenue_optimiser_settings.mode = 'recommendations'
 *    and writes an `autopilot_paused_fleet` anomaly.
 *  - Notifications via Resend are best-effort; failures don't abort the run.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

/** Pending recs above this delta% are flagged for super-admin review. */
const LARGE_SWING_PERCENT = 25;
/** Apply→revert window for "distrust" anomaly. */
const APPLY_REVERT_WINDOW_HOURS = 24;
/** Lookback for utilisation-drop detection. */
const UTILISATION_LOOKBACK_DAYS = 7;
/** Hold any open anomaly for 24h before re-firing the same one. */
const ANOMALY_DEDUPE_HOURS = 24;

interface Summary {
  large_swing_flagged: number;
  apply_revert_flagged: number;
  utilisation_drop_flagged: number;
  fleet_paused: number;
  errors: string[];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const summary: Summary = {
      large_swing_flagged: 0,
      apply_revert_flagged: 0,
      utilisation_drop_flagged: 0,
      fleet_paused: 0,
      errors: [],
    };

    await detectLargeSwings(supabase, summary);
    await detectApplyRevert(supabase, summary);
    await detectUtilisationDrop(supabase, summary);

    return jsonResponse(summary);
  } catch (err) {
    console.error("revenue-optimiser-anomaly-check error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// D1. Large-swing pending recommendations
// ───────────────────────────────────────────────────────────────────────────

async function detectLargeSwings(supabase: SupabaseClient, summary: Summary) {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recs } = await supabase
    .from("pricing_recommendations")
    .select("id, tenant_id, vehicle_id, tier, current_price, recommended_price")
    .eq("status", "pending")
    .gte("created_at", cutoff);
  for (const r of (recs ?? []) as Array<{ id: string; tenant_id: string; vehicle_id: string; tier: string; current_price: number; recommended_price: number }>) {
    const cur = Number(r.current_price);
    const rec = Number(r.recommended_price);
    if (cur <= 0) continue;
    const pct = Math.abs(rec - cur) / cur * 100;
    if (pct < LARGE_SWING_PERCENT) continue;
    if (await alreadyOpen(supabase, "large_swing", r.tenant_id, r.id)) continue;

    try {
      await supabase.from("revenue_optimiser_anomalies").insert({
        tenant_id: r.tenant_id,
        vehicle_id: r.vehicle_id,
        recommendation_id: r.id,
        anomaly_type: "large_swing",
        severity: pct >= 40 ? "critical" : "warning",
        summary: `Recommendation moves ${r.tier} rate ${formatPct(pct, rec, cur)} (${formatMoney(cur)} → ${formatMoney(rec)})`,
        details: {
          tier: r.tier,
          current_price: cur,
          recommended_price: rec,
          delta_percent: Math.round(pct * 10) / 10,
        },
      });
      summary.large_swing_flagged++;
    } catch (err) {
      summary.errors.push(`large_swing/${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// D2. Apply-then-revert within 24h (operator distrust signal)
// ───────────────────────────────────────────────────────────────────────────

async function detectApplyRevert(supabase: SupabaseClient, summary: Summary) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: reverts } = await supabase
    .from("pricing_recommendations")
    .select("id, tenant_id, vehicle_id, tier, applied_at, reverted_at, applied_source")
    .eq("status", "reverted")
    .gte("reverted_at", since);

  for (const r of (reverts ?? []) as Array<{ id: string; tenant_id: string; vehicle_id: string; tier: string; applied_at: string | null; reverted_at: string | null; applied_source: string | null }>) {
    if (!r.applied_at || !r.reverted_at) continue;
    const appliedMs = new Date(r.applied_at).getTime();
    const revertedMs = new Date(r.reverted_at).getTime();
    const hours = (revertedMs - appliedMs) / 3600_000;
    if (hours >= APPLY_REVERT_WINDOW_HOURS) continue;
    if (await alreadyOpen(supabase, "apply_then_revert", r.tenant_id, r.id)) continue;

    try {
      await supabase.from("revenue_optimiser_anomalies").insert({
        tenant_id: r.tenant_id,
        vehicle_id: r.vehicle_id,
        recommendation_id: r.id,
        anomaly_type: "apply_then_revert",
        severity: "warning",
        summary: `Applied via ${r.applied_source ?? "manual"} then reverted ${hours.toFixed(1)}h later`,
        details: {
          tier: r.tier,
          applied_at: r.applied_at,
          reverted_at: r.reverted_at,
          hours_to_revert: Math.round(hours * 10) / 10,
        },
      });
      summary.apply_revert_flagged++;
    } catch (err) {
      summary.errors.push(`apply_revert/${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// D3. Tenant utilisation drop post-apply
// ───────────────────────────────────────────────────────────────────────────

async function detectUtilisationDrop(supabase: SupabaseClient, summary: Summary) {
  // For each tenant with autopilot on + auto_pause_on_utilization_drop true:
  // measure the past 7d fleet utilisation vs the *prior* 7d. If drop exceeds
  // the threshold, raise an anomaly and (per config) pause autopilot.
  const { data: settingsRaw } = await supabase
    .from("revenue_optimiser_settings")
    .select("tenant_id, mode, enabled, auto_pause_on_utilization_drop, auto_pause_threshold_percent")
    .eq("enabled", true);
  const tenants = (settingsRaw ?? []) as Array<{
    tenant_id: string; mode: string; auto_pause_on_utilization_drop: boolean; auto_pause_threshold_percent: number;
  }>;

  const now = Date.now();
  const recentStart = new Date(now - UTILISATION_LOOKBACK_DAYS * 86_400_000).toISOString();
  const priorStart = new Date(now - 2 * UTILISATION_LOOKBACK_DAYS * 86_400_000).toISOString();
  const priorEnd = recentStart;

  for (const s of tenants) {
    try {
      // Count rentals (proxy for utilisation) in each window
      const [{ count: recentCount }, { count: priorCount }] = await Promise.all([
        supabase.from("rentals")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", s.tenant_id)
          .gte("start_date", recentStart.slice(0, 10)),
        supabase.from("rentals")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", s.tenant_id)
          .gte("start_date", priorStart.slice(0, 10))
          .lt("start_date", priorEnd.slice(0, 10)),
      ]);
      const recent = Number(recentCount ?? 0);
      const prior = Number(priorCount ?? 0);
      if (prior === 0) continue;  // Can't compute a meaningful drop
      const dropPct = ((prior - recent) / prior) * 100;
      const threshold = Number(s.auto_pause_threshold_percent ?? 20);
      if (dropPct < threshold) continue;
      if (await alreadyOpenTenant(supabase, "utilisation_drop", s.tenant_id)) continue;

      await supabase.from("revenue_optimiser_anomalies").insert({
        tenant_id: s.tenant_id,
        anomaly_type: "utilisation_drop",
        severity: dropPct >= threshold * 1.5 ? "critical" : "warning",
        summary: `Fleet utilisation dropped ${dropPct.toFixed(1)}% over the last ${UTILISATION_LOOKBACK_DAYS} days`,
        details: {
          recent_bookings: recent,
          prior_bookings: prior,
          drop_percent: Math.round(dropPct * 10) / 10,
          threshold_percent: threshold,
        },
      });
      summary.utilisation_drop_flagged++;

      // Auto-pause autopilot fleet-wide
      if (s.auto_pause_on_utilization_drop && s.mode === "autopilot") {
        await supabase
          .from("revenue_optimiser_settings")
          .update({ mode: "recommendations" })
          .eq("tenant_id", s.tenant_id);
        await supabase.from("revenue_optimiser_anomalies").insert({
          tenant_id: s.tenant_id,
          anomaly_type: "autopilot_paused_fleet",
          severity: "critical",
          summary: `Autopilot paused — utilisation dropped ${dropPct.toFixed(1)}% (threshold ${threshold}%)`,
          details: { drop_percent: Math.round(dropPct * 10) / 10, threshold_percent: threshold },
        });
        summary.fleet_paused++;
      }
    } catch (err) {
      summary.errors.push(`utilisation/${s.tenant_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Dedupe rules:
 *   - `open` anomaly within 24h → skip (don't spam the inbox)
 *   - `resolved` anomaly within 24h → skip (operator closed it recently)
 *   - `acknowledged` anomaly older than ACK_REFIRE_DAYS → ALLOW re-fire (the
 *     ack-then-ignored case where the underlying condition didn't go away)
 *   - `acknowledged` anomaly within ACK_REFIRE_DAYS → skip
 */
const ACK_REFIRE_DAYS = 7;

async function alreadyOpen(
  supabase: SupabaseClient, type: string, tenantId: string, recId: string,
): Promise<boolean> {
  const ackCutoff = new Date(Date.now() - ACK_REFIRE_DAYS * 86_400_000).toISOString();
  const dedupeCutoff = new Date(Date.now() - ANOMALY_DEDUPE_HOURS * 3600_000).toISOString();
  const { data } = await supabase
    .from("revenue_optimiser_anomalies")
    .select("id, status, acknowledged_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("recommendation_id", recId)
    .eq("anomaly_type", type)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  if (data.status === "open" && data.created_at >= dedupeCutoff) return true;
  if (data.status === "resolved" && data.created_at >= dedupeCutoff) return true;
  if (data.status === "acknowledged") {
    // Re-fire only if the ack is stale enough to suggest "ignored, condition persists"
    return (data.acknowledged_at ?? data.created_at) > ackCutoff;
  }
  return false;
}

async function alreadyOpenTenant(
  supabase: SupabaseClient, type: string, tenantId: string,
): Promise<boolean> {
  const ackCutoff = new Date(Date.now() - ACK_REFIRE_DAYS * 86_400_000).toISOString();
  const dedupeCutoff = new Date(Date.now() - ANOMALY_DEDUPE_HOURS * 3600_000).toISOString();
  const { data } = await supabase
    .from("revenue_optimiser_anomalies")
    .select("id, status, acknowledged_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("anomaly_type", type)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  if (data.status === "open" && data.created_at >= dedupeCutoff) return true;
  if (data.status === "resolved" && data.created_at >= dedupeCutoff) return true;
  if (data.status === "acknowledged") {
    return (data.acknowledged_at ?? data.created_at) > ackCutoff;
  }
  return false;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function formatPct(pct: number, rec: number, cur: number): string {
  return `${rec > cur ? "+" : "−"}${pct.toFixed(1)}%`;
}
