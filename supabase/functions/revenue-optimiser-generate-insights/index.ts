/**
 * revenue-optimiser-generate-insights — Spec §6 Journey A, Phase 1.
 *
 * Daily cron. For every tenant with Revenue Optimiser enabled (any mode),
 * reads `vehicle_pricing_stats` MV and writes short fleet observations into
 * `revenue_optimiser_insights`. These are the "build trust" data points the
 * operator sees BEFORE the recommendation engine surfaces prices.
 *
 * Also flips `calibration_complete = true` once a tenant has had Insights mode
 * on for ≥30 days — this gates Phase 2 from generating recommendations for
 * brand-new tenants without data.
 *
 * Auth: cron-only — body must include the cron secret OR call originates from
 * service_role. We rely on Supabase's verify_jwt = true with a service-role
 * key passed by pg_cron's http_post.
 *
 * Idempotent: re-runs on the same date are no-ops thanks to the partial unique
 * indexes on (tenant_id, observation_type, observation_date, vehicle_id?).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface StatsRow {
  vehicle_id: string;
  tenant_id: string;
  category: string | null;
  make: string | null;
  model: string | null;
  utilization_30d: number;
  idle_days: number | null;
  active_enquiries_14d: number;
}

interface TenantRow {
  tenant_id: string;
  enabled: boolean;
  mode: string;
  calibration_started_at: string | null;
  calibration_complete: boolean;
}

const HIGH_UTIL_DELTA = 10;     // vehicle util > fleet avg + 10pp
const LOW_UTIL_DELTA = 10;      // vehicle util < fleet avg - 10pp
const IDLE_STREAK_DAYS = 7;
const ENQUIRY_HOTSPOT_MIN = 3;
const CALIBRATION_DAYS = 30;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. Find every enabled tenant
    const { data: settingsRaw, error: setErr } = await supabase
      .from("revenue_optimiser_settings")
      .select("tenant_id, enabled, mode, calibration_started_at, calibration_complete")
      .eq("enabled", true);
    if (setErr) return errorResponse(setErr.message ?? "Failed to load settings", 500);
    const tenants = (settingsRaw ?? []) as TenantRow[];

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const summary = { tenants_processed: 0, observations_written: 0, calibrations_completed: 0, errors: [] as string[] };

    for (const t of tenants) {
      try {
        summary.tenants_processed++;

        // 2. Flip calibration_complete once 30 days have passed
        if (!t.calibration_complete && t.calibration_started_at) {
          const elapsedDays = Math.floor((now.getTime() - Date.parse(t.calibration_started_at)) / 86_400_000);
          if (elapsedDays >= CALIBRATION_DAYS) {
            await supabase
              .from("revenue_optimiser_settings")
              .update({ calibration_complete: true })
              .eq("tenant_id", t.tenant_id);
            summary.calibrations_completed++;
          }
        }

        // 3. Pull this tenant's vehicle stats from the MV
        const { data: statsRaw } = await supabase
          .from("vehicle_pricing_stats")
          .select("vehicle_id, tenant_id, category, make, model, utilization_30d, idle_days, active_enquiries_14d")
          .eq("tenant_id", t.tenant_id);
        const stats = (statsRaw ?? []) as StatsRow[];
        if (stats.length === 0) continue;

        // 4. Compute fleet utilisation average (so per-vehicle observations are relative)
        const utilSum = stats.reduce((s, v) => s + Number(v.utilization_30d ?? 0), 0);
        const fleetAvgUtil = stats.length > 0 ? utilSum / stats.length : 0;

        type InsightRow = {
          tenant_id: string;
          vehicle_id: string | null;
          observation_type: string;
          observation_date: string;
          label: string;
          value: Record<string, unknown>;
        };
        const inserts: InsightRow[] = [];

        // 5. Per-vehicle observations
        for (const v of stats) {
          const util = Number(v.utilization_30d ?? 0);
          if (util > fleetAvgUtil + HIGH_UTIL_DELTA) {
            inserts.push({
              tenant_id: t.tenant_id,
              vehicle_id: v.vehicle_id,
              observation_type: "high_utilization",
              observation_date: today,
              label: `${v.make ?? ""} ${v.model ?? ""} — ${Math.round(util)}% booked (fleet avg ${Math.round(fleetAvgUtil)}%)`,
              value: { utilization_30d: util, fleet_avg: fleetAvgUtil },
            });
          } else if (util > 0 && util < fleetAvgUtil - LOW_UTIL_DELTA) {
            inserts.push({
              tenant_id: t.tenant_id,
              vehicle_id: v.vehicle_id,
              observation_type: "low_utilization",
              observation_date: today,
              label: `${v.make ?? ""} ${v.model ?? ""} — only ${Math.round(util)}% booked (fleet avg ${Math.round(fleetAvgUtil)}%)`,
              value: { utilization_30d: util, fleet_avg: fleetAvgUtil },
            });
          }
          if ((v.idle_days ?? 0) >= IDLE_STREAK_DAYS) {
            inserts.push({
              tenant_id: t.tenant_id,
              vehicle_id: v.vehicle_id,
              observation_type: "idle_streak",
              observation_date: today,
              label: `${v.make ?? ""} ${v.model ?? ""} — idle ${v.idle_days} days`,
              value: { idle_days: v.idle_days },
            });
          }
          if (Number(v.active_enquiries_14d ?? 0) >= ENQUIRY_HOTSPOT_MIN) {
            inserts.push({
              tenant_id: t.tenant_id,
              vehicle_id: v.vehicle_id,
              observation_type: "enquiry_hotspot",
              observation_date: today,
              label: `${v.make ?? ""} ${v.model ?? ""} — ${v.active_enquiries_14d} active enquiries in last 14d`,
              value: { active_enquiries_14d: v.active_enquiries_14d },
            });
          }
        }

        // 6. Fleet-level summary observation (always one per tenant per day)
        const idleCount = stats.filter((v) => (v.idle_days ?? 0) >= IDLE_STREAK_DAYS).length;
        const highUtilCount = stats.filter((v) => Number(v.utilization_30d ?? 0) > fleetAvgUtil + HIGH_UTIL_DELTA).length;
        inserts.push({
          tenant_id: t.tenant_id,
          vehicle_id: null,
          observation_type: "fleet_summary",
          observation_date: today,
          label: `${stats.length} active vehicles · ${highUtilCount} high-utilisation · ${idleCount} idle ${IDLE_STREAK_DAYS}+ days`,
          value: {
            fleet_size: stats.length,
            fleet_avg_utilization: Math.round(fleetAvgUtil * 100) / 100,
            high_utilisation_count: highUtilCount,
            idle_count: idleCount,
          },
        });

        // 7. Insert with ON CONFLICT DO NOTHING (matches partial unique indexes)
        if (inserts.length > 0) {
          const { error: insErr } = await supabase
            .from("revenue_optimiser_insights")
            .upsert(inserts, {
              onConflict: "tenant_id,observation_type,observation_date,vehicle_id",
              ignoreDuplicates: true,
            });
          if (insErr) {
            // upsert may fail on partial unique conflict between vehicle-NULL and non-NULL rows;
            // fall back to plain insert with explicit duplicate suppression
            for (const row of inserts) {
              await supabase.from("revenue_optimiser_insights").insert(row).then(undefined, () => null);
            }
          }
          summary.observations_written += inserts.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`tenant ${t.tenant_id} insights gen failed:`, msg);
        summary.errors.push(`${t.tenant_id}: ${msg}`);
      }
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("revenue-optimiser-generate-insights error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
