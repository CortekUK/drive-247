/**
 * revenue-optimiser-generate — Spec §11 (Algorithm) + §6 Journey B (Daily check-in).
 *
 * The daily cron that turns metrics into price recommendations. For every
 * eligible tenant + vehicle, it:
 *   1. Reads stats from `vehicle_pricing_stats` MV
 *   2. Runs the elasticity engine (shared with the backtest fn)
 *   3. Applies safety rails (max swing, cost floor) per Spec §13
 *   4. Skips trivial deltas (< $30 monthly impact, Spec §11.8)
 *   5. Skips stale-lock vehicles (applied < 14d ago, Spec §13.5)
 *   6. Generates a GPT plain-English explanation (Spec §12)
 *   7. Marks prior pending recs for the same vehicle/tier as 'superseded'
 *   8. Inserts a fresh `pricing_recommendations` row (status='pending', expires 7d)
 *
 * Skipped entirely:
 *   - Tenants without `enabled = true` AND `mode IN ('recommendations','autopilot')`
 *   - Tenants where `calibration_complete = false` (Spec §13.2)
 *   - Vehicles failing the data-quality gate (`_shared/revenue-optimiser-quality.ts`)
 *   - Vehicles with < 12 bookings in 90d AND no category fallback available
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  checkVehicleQuality,
  MIN_BOOKINGS_PER_VEHICLE_90D,
  MIN_RECOMMENDATION_DELTA_MONTHLY,
} from "../_shared/revenue-optimiser-quality.ts";
import {
  computeElasticity,
  computeDemandScore,
  computeSupplyScore,
  computeTimingScore,
  computeRecommendedPrice,
  computeConfidenceScore,
  buildReasonsArray,
  type VehicleStats,
  type BookingObservation,
} from "../_shared/revenue-optimiser-engine.ts";
import { chatCompletion } from "../_shared/openai.ts";
import { findMatchingLeads } from "../_shared/revenue-optimiser-matching.ts";

/** Idle threshold for triggering combined recommendations (Spec §16). */
const IDLE_DAYS_FOR_COMBINED = 5;

// Per-tier choice for V1: we recommend on the dominant tier (weekly) only.
// Phase 3 can extend to daily/monthly per-tier recommendations.
type Tier = "daily" | "weekly" | "monthly";
const PRIMARY_TIER: Tier = "weekly";

interface SettingsRow {
  tenant_id: string;
  enabled: boolean;
  mode: string;
  calibration_complete: boolean;
  max_swing_percent: number;
  cost_floor_enabled: boolean;
}

interface VehicleStatsRow {
  vehicle_id: string;
  tenant_id: string;
  category: string | null;
  make: string | null;
  model: string | null;
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  cost_floor_daily: number | null;
  cost_floor_weekly: number | null;
  cost_floor_monthly: number | null;
  bookings_30d: number;
  bookings_90d: number;
  revenue_30d: number;
  revenue_90d: number;
  booked_days_30d: number;
  utilization_30d: number;
  idle_days: number | null;
  active_enquiries_14d: number;
  enquiry_conversion_90d: number | null;
  upcoming_booking_days_90d: number;
}

interface VehicleRow {
  id: string;
  tenant_id: string | null;
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  is_disposed: boolean | null;
  status: string | null;
  category: string | null;
  created_at: string | null;
}

interface RentalRow {
  vehicle_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
}

interface LedgerRow {
  rental_id: string | null;
  vehicle_id: string | null;
  amount: number | null;
  entry_date: string | null;
}

/** Stale-lock: skip recs for vehicles where a rec was applied < 14d ago (Spec §13.5). */
const STALE_LOCK_DAYS = 14;
/** Recommendations decay after this many days (Spec §C example). */
const RECOMMENDATION_EXPIRY_DAYS = 7;
/** GPT prompt budget cap. */
const GPT_MAX_TOKENS = 220;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Per-run explanation cache so the same (category × reasons) doesn't burn
    // a GPT call per vehicle within this batch.
    const gptCache = new Map<string, { text: string; model: string; tokens: number }>();

    // 1. Find every tenant in recommendations / autopilot mode with calibration complete
    const { data: settingsRaw, error: setErr } = await supabase
      .from("revenue_optimiser_settings")
      .select("tenant_id, enabled, mode, calibration_complete, max_swing_percent, cost_floor_enabled")
      .eq("enabled", true)
      .in("mode", ["recommendations", "autopilot"])
      .eq("calibration_complete", true);
    if (setErr) return errorResponse(setErr.message ?? "Failed to load settings", 500);
    const tenants = (settingsRaw ?? []) as SettingsRow[];

    const summary = {
      tenants_processed: 0,
      vehicles_evaluated: 0,
      recommendations_written: 0,
      skipped_stale: 0,
      skipped_low_impact: 0,
      skipped_quality: 0,
      gpt_cache_hits: 0,
      gpt_calls: 0,
      gpt_fallbacks: 0,
      errors: [] as string[],
    };

    const runId = crypto.randomUUID();

    for (const t of tenants) {
      try {
        summary.tenants_processed++;

        // 2. Pull stats + vehicles + recent rentals/ledger for this tenant
        const { data: statsRaw } = await supabase
          .from("vehicle_pricing_stats")
          .select("*")
          .eq("tenant_id", t.tenant_id);
        const stats = (statsRaw ?? []) as VehicleStatsRow[];
        if (stats.length === 0) continue;

        const vehicleIds = stats.map((s) => s.vehicle_id);

        // Quality gate — pre-filter disposed at the SQL level (defence in depth).
        // The per-row checkVehicleQuality also rejects disposed, but excluding
        // here saves bytes + ensures we never generate a rec for a binned car.
        const { data: vehiclesRaw } = await supabase
          .from("vehicles")
          .select("id, tenant_id, daily_rent, weekly_rent, monthly_rent, is_disposed, status, category, created_at")
          .in("id", vehicleIds)
          .or("is_disposed.is.null,is_disposed.eq.false");
        const vehicleById = new Map(
          ((vehiclesRaw ?? []) as VehicleRow[]).map((v) => [v.id, v] as const),
        );

        // Bookings to feed elasticity
        const periodStart = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
        const { data: rentalsRaw } = await supabase
          .from("rentals")
          .select("vehicle_id, start_date, end_date, status")
          .in("vehicle_id", vehicleIds)
          .gte("start_date", periodStart);
        const rentals = ((rentalsRaw ?? []) as RentalRow[]).filter(
          (r) => r.status && ["Active", "Closed"].includes(r.status),
        );

        const { data: ledgerRaw } = await supabase
          .from("ledger_entries")
          .select("rental_id, vehicle_id, amount, entry_date")
          .eq("type", "Charge")
          .in("vehicle_id", vehicleIds)
          .gte("entry_date", periodStart);
        const ledgers = (ledgerRaw ?? []) as LedgerRow[];

        // Stale-lock map: recently-applied rec per (vehicle_id, tier)
        const { data: recentAppliesRaw } = await supabase
          .from("pricing_recommendations")
          .select("vehicle_id, tier, applied_at")
          .eq("tenant_id", t.tenant_id)
          .eq("status", "applied")
          .gte("applied_at", new Date(Date.now() - STALE_LOCK_DAYS * 86_400_000).toISOString());
        const staleLock = new Set<string>(
          ((recentAppliesRaw ?? []) as Array<{ vehicle_id: string; tier: string }>).map(
            (r) => `${r.vehicle_id}:${r.tier}`,
          ),
        );

        // Phase 3: skip vehicles whose rule is currently paused
        // (e.g. paused after 2 negative outcomes in a row).
        const { data: pausedRulesRaw } = await supabase
          .from("revenue_optimiser_rules")
          .select("vehicle_id, paused_until")
          .eq("tenant_id", t.tenant_id)
          .not("paused_until", "is", null)
          .not("vehicle_id", "is", null)
          .gt("paused_until", new Date().toISOString());
        const pausedVehicles = new Set<string>(
          ((pausedRulesRaw ?? []) as Array<{ vehicle_id: string | null }>)
            .map((r) => r.vehicle_id)
            .filter((id): id is string => !!id),
        );

        // Fleet averages for demand-score normalisation
        const utilSum = stats.reduce((s, v) => s + Number(v.utilization_30d ?? 0), 0);
        const fleetUtilAvg = stats.length > 0 ? utilSum / stats.length : 0;
        const bookingsTotal = stats.reduce((s, v) => s + Number(v.bookings_30d ?? 0), 0);
        const fleetVelocityAvg = Math.max(0.001, bookingsTotal / (stats.length * 30));

        // Per-category supply availability (for supplyScore)
        const categoryAvailability = new Map<string, { total: number; available: number }>();
        for (const s of stats) {
          const key = s.category ?? "uncategorised";
          const entry = categoryAvailability.get(key) ?? { total: 0, available: 0 };
          entry.total++;
          if ((s.upcoming_booking_days_90d ?? 0) < 30) entry.available++;
          categoryAvailability.set(key, entry);
        }

        const toInsert: Record<string, unknown>[] = [];
        const supersedeKeys: Array<{ vehicle_id: string; tier: string }> = [];

        // 3. Per-vehicle evaluation
        for (const s of stats) {
          summary.vehicles_evaluated++;
          const v = vehicleById.get(s.vehicle_id);
          if (!v) continue;

          // Quality gate
          if (!checkVehicleQuality(v).isUsable) {
            summary.skipped_quality++;
            continue;
          }

          // Stale-lock: skip if applied recently
          const lockKey = `${s.vehicle_id}:${PRIMARY_TIER}`;
          if (staleLock.has(lockKey)) {
            summary.skipped_stale++;
            continue;
          }

          // Phase 3: rule-paused vehicles get no recs (autopilot circuit-breaker)
          if (pausedVehicles.has(s.vehicle_id)) {
            summary.skipped_stale++;
            continue;
          }

          // Eligibility: ≥60d of fleet age OR ≥12 bookings in 90d
          const ageDays = v.created_at
            ? Math.floor((Date.now() - Date.parse(v.created_at)) / 86_400_000)
            : 0;
          const enoughHistory = ageDays >= 60 || (s.bookings_90d ?? 0) >= MIN_BOOKINGS_PER_VEHICLE_90D;
          if (!enoughHistory) {
            summary.skipped_quality++;
            continue;
          }

          const currentPrice = Number(
            PRIMARY_TIER === "weekly"
              ? s.weekly_rent
              : PRIMARY_TIER === "daily"
                ? s.daily_rent
                : s.monthly_rent
          );
          if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
            summary.skipped_quality++;
            continue;
          }

          // Build elasticity observations from this vehicle's own bookings
          const vRentals = rentals.filter((r) => r.vehicle_id === s.vehicle_id);
          const vLedgers = ledgers.filter((l) => l.vehicle_id === s.vehicle_id);
          const observations: BookingObservation[] = vRentals
            .map((r) => {
              const weeks = Math.max(
                1,
                Math.round(
                  (Date.parse(r.end_date!) - Date.parse(r.start_date!)) / (7 * 86_400_000),
                ),
              );
              const rentalIds = ledgers.filter((l) => l.rental_id);
              void rentalIds;
              const price =
                vLedgers
                  .filter((l) => l.rental_id) // can't link by rental id without join; use overall
                  .reduce((sum, l) => sum + Number(l.amount ?? 0), 0) / Math.max(1, weeks);
              return { price: Math.round(price), bookings: 1 };
            })
            .filter((o) => o.price > 0);

          const elasticity = computeElasticity(observations, currentPrice);

          // Build per-vehicle stats for demand/supply scoring
          const vehicleStats: VehicleStats = {
            bookings_30d: Number(s.bookings_30d ?? 0),
            bookings_90d: Number(s.bookings_90d ?? 0),
            revenue_30d: Number(s.revenue_30d ?? 0),
            revenue_90d: Number(s.revenue_90d ?? 0),
            booked_days_30d: Number(s.booked_days_30d ?? 0),
            utilization_30d: Number(s.utilization_30d ?? 0),
            idle_days: s.idle_days,
            active_enquiries_14d: Number(s.active_enquiries_14d ?? 0),
            enquiry_conversion_90d: s.enquiry_conversion_90d,
            upcoming_booking_days_90d: Number(s.upcoming_booking_days_90d ?? 0),
          };

          const catKey = s.category ?? "uncategorised";
          const cat = categoryAvailability.get(catKey) ?? { total: 1, available: 1 };
          const similarAvailPct = (cat.available / cat.total) * 100;

          const demand = computeDemandScore(vehicleStats, {
            utilization_30d_avg: fleetUtilAvg,
            bookings_velocity_avg: fleetVelocityAvg,
          });
          const supply = computeSupplyScore(vehicleStats, similarAvailPct);
          const timing = computeTimingScore({
            coversWeekend: true, // PRIMARY_TIER='weekly' always covers a weekend
            coversHoliday: false, // Phase 2.1+: integrate tenant_holidays
            isLastMinute: (s.idle_days ?? 0) === 0,
          });

          const costFloor = t.cost_floor_enabled
            ? Number(
                PRIMARY_TIER === "weekly"
                  ? s.cost_floor_weekly
                  : PRIMARY_TIER === "daily"
                    ? s.cost_floor_daily
                    : s.cost_floor_monthly
              ) || null
            : null;

          const rec = computeRecommendedPrice(elasticity, demand, supply, timing, {
            current_price: currentPrice,
            max_swing_percent: Number(t.max_swing_percent ?? 15),
            cost_floor: costFloor,
          });

          // Skip trivial — Spec §11.8
          const priceDelta = rec.price - currentPrice;
          const projectedBookings30d = Math.max(0, demand / 5); // rough demand-bookings proxy
          const projectedMonthlyDelta = priceDelta * Math.max(2, projectedBookings30d) * 4;
          if (Math.abs(projectedMonthlyDelta) < MIN_RECOMMENDATION_DELTA_MONTHLY) {
            summary.skipped_low_impact++;
            continue;
          }

          // Confidence — used by UI display + autopilot gate
          const conf = computeConfidenceScore({
            bookings_90d: Number(s.bookings_90d ?? 0),
            elasticity_r_squared: elasticity.r_squared,
            conversion_variance: 0.3, // V1 placeholder; Phase 3 computes from booking timeline
            vehicle_age_days: ageDays,
          });

          const reasons = buildReasonsArray(
            vehicleStats,
            { utilization_30d_avg: fleetUtilAvg, bookings_velocity_avg: fleetVelocityAvg },
            similarAvailPct,
            { weekend: true, holiday: false },
          );

          // GPT explanation — cached by (category, reasons_top_3)
          const top3 = reasons.slice(0, 3).map((r) => r.code).join("|");
          const cacheKey = `${catKey}::${top3}`;
          let explanation: { text: string; model: string; tokens: number } | undefined =
            gptCache.get(cacheKey);
          if (!explanation) {
            try {
              const completion = await chatCompletion(
                [
                  {
                    role: "system",
                    content:
                      "You are Drive247 Revenue Optimiser's explanation writer. You receive a JSON " +
                      "payload describing a pricing recommendation that was computed by a deterministic " +
                      "statistical model. Your job is to write a short, factual, plain-English " +
                      "explanation. Do NOT invent prices, numbers, or trends not present in the payload. " +
                      "Do NOT use marketing language. Be specific. 2-3 sentences. Reference the most " +
                      "important 2 data points.",
                  },
                  {
                    role: "user",
                    content: JSON.stringify({
                      vehicle: `${v ? "" : ""}${s.make ?? ""} ${s.model ?? ""}`.trim(),
                      tier: PRIMARY_TIER,
                      current_price: currentPrice,
                      recommended_price: rec.price,
                      data_points: {
                        utilization_30d: vehicleStats.utilization_30d,
                        active_enquiries_14d: vehicleStats.active_enquiries_14d,
                        conversion_at_current: vehicleStats.enquiry_conversion_90d,
                        bookings_velocity_trend_14d: 0,
                        fleet_avg_utilization: fleetUtilAvg,
                        bookings_30d: vehicleStats.bookings_30d,
                      },
                      reasons_top_3: reasons.slice(0, 3).map((r) => r.code),
                    }),
                  },
                ],
                { model: "gpt-4o-mini", max_tokens: GPT_MAX_TOKENS, temperature: 0.3 },
                { tenantId: t.tenant_id, functionName: "revenue-optimiser-generate" },
              );
              const txt = completion.choices?.[0]?.message?.content?.trim() ?? "";
              if (txt) {
                explanation = {
                  text: txt,
                  model: "gpt-4o-mini",
                  tokens:
                    (completion.usage?.prompt_tokens ?? 0) +
                    (completion.usage?.completion_tokens ?? 0),
                };
                gptCache.set(cacheKey, explanation);
                summary.gpt_calls++;
              }
            } catch (err) {
              console.error("GPT explanation failed (non-fatal):", err);
            }
          } else {
            summary.gpt_cache_hits++;
          }

          if (!explanation) {
            // Template fallback (Spec §12.5)
            const direction = priceDelta > 0 ? "increase" : "decrease";
            explanation = {
              text:
                `Suggested ${direction} of ${Math.abs(priceDelta)} (${currentPrice} → ${rec.price}) ` +
                `for ${s.make ?? ""} ${s.model ?? ""}. Based on utilisation ${Math.round(vehicleStats.utilization_30d)}% ` +
                `(fleet avg ${Math.round(fleetUtilAvg)}%) and ${vehicleStats.active_enquiries_14d} active enquiries.`,
              model: "template",
              tokens: 0,
            };
            summary.gpt_fallbacks++;
          }

          toInsert.push({
            tenant_id: t.tenant_id,
            vehicle_id: s.vehicle_id,
            tier: PRIMARY_TIER,
            current_price: currentPrice,
            recommended_price: rec.price,
            recommended_range_low: rec.range_low,
            recommended_range_high: rec.range_high,
            confidence: conf.label,
            confidence_score: conf.score,
            projected_revenue_delta_monthly: Math.round(projectedMonthlyDelta * 100) / 100,
            reasons,
            data_points: {
              bookings_30d: vehicleStats.bookings_30d,
              bookings_90d: vehicleStats.bookings_90d,
              utilization_30d: vehicleStats.utilization_30d,
              idle_days: vehicleStats.idle_days,
              active_enquiries_14d: vehicleStats.active_enquiries_14d,
              conversion_at_current_price: vehicleStats.enquiry_conversion_90d,
              fleet_avg_utilization: Math.round(fleetUtilAvg * 100) / 100,
              elasticity: elasticity.elasticity,
              elasticity_r_squared: elasticity.r_squared,
              similar_available_pct: Math.round(similarAvailPct * 100) / 100,
              clamped: rec.clamped,
              clamp_reason: rec.clampReason ?? null,
            },
            elasticity_curve: elasticity.fittedCurve,
            ai_explanation: explanation.text,
            ai_model: explanation.model,
            ai_tokens_total: explanation.tokens,
            status: "pending",
            expires_at: new Date(
              Date.now() + RECOMMENDATION_EXPIRY_DAYS * 86_400_000,
            ).toISOString(),
            generation_run_id: runId,
          });
          supersedeKeys.push({ vehicle_id: s.vehicle_id, tier: PRIMARY_TIER });
        }

        // 4. Supersede prior pending recs for the same (vehicle, tier)
        for (const { vehicle_id, tier } of supersedeKeys) {
          await supabase
            .from("pricing_recommendations")
            .update({ status: "superseded" })
            .eq("vehicle_id", vehicle_id)
            .eq("tier", tier)
            .eq("status", "pending");
        }

        // 4b. Phase 4 — for idle-vehicle price-drop recs, attach matching leads.
        // We only enrich recs whose vehicle is idle ≥ IDLE_DAYS_FOR_COMBINED days
        // AND whose recommended price is BELOW current — i.e. price drop.
        const idlePriceDropCandidates = toInsert.filter((r) => {
          const d = r.data_points as { idle_days?: number | null };
          return (
            r.recommended_price < r.current_price &&
            d.idle_days !== null && d.idle_days !== undefined &&
            Number(d.idle_days) >= IDLE_DAYS_FOR_COMBINED
          );
        });
        if (idlePriceDropCandidates.length > 0) {
          await Promise.all(idlePriceDropCandidates.map(async (rec) => {
            const v = vehicleById.get(rec.vehicle_id);
            const matches = await findMatchingLeads(supabase, {
              tenantId: rec.tenant_id,
              vehicleId: rec.vehicle_id,
              vehicleCategory: v?.category ?? null,
            });
            if (matches.length === 0) return;
            rec.is_combined = true;
            rec.matched_lead_ids = matches.map((m) => m.id);
            (summary as unknown as { combined_recommendations?: number }).combined_recommendations =
              ((summary as unknown as { combined_recommendations?: number }).combined_recommendations ?? 0) + 1;
          }));
        }

        // 5. Bulk insert new recs
        if (toInsert.length > 0) {
          const { error: insErr } = await supabase
            .from("pricing_recommendations")
            .insert(toInsert);
          if (insErr) {
            console.error(`tenant ${t.tenant_id} insert error:`, insErr);
            summary.errors.push(`${t.tenant_id}: ${insErr.message}`);
          } else {
            summary.recommendations_written += toInsert.length;
          }
        }

        // 6. Also expire any rec older than its expires_at (housekeeping)
        await supabase
          .from("pricing_recommendations")
          .update({ status: "expired" })
          .eq("tenant_id", t.tenant_id)
          .eq("status", "pending")
          .lt("expires_at", new Date().toISOString());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`tenant ${t.tenant_id} generate failed:`, msg);
        summary.errors.push(`${t.tenant_id}: ${msg}`);
      }
    }

    return jsonResponse({ runId, ...summary });
  } catch (err) {
    console.error("revenue-optimiser-generate error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
