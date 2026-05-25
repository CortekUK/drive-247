/**
 * revenue-optimiser-measure-outcomes — Spec §3.3 + §10.
 *
 * Daily cron. Finds applied recommendations whose applied_at < NOW() - 14 days
 * AND have no `pricing_recommendation_outcomes` row yet. For each, computes:
 *   - bookings_before / bookings_after (14d windows)
 *   - revenue_before / revenue_after  (14d windows, from ledger_entries Charge)
 *   - utilization_before / utilization_after
 *   - net_revenue_delta (after - before)
 *   - outcome: positive | neutral | negative
 *
 * Writes the row to pricing_recommendation_outcomes (idempotent — unique constraint
 * on recommendation_id prevents duplicates if cron re-runs).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const WINDOW_DAYS = 14;
/** Net revenue delta thresholds for outcome labelling. */
const POSITIVE_THRESHOLD = 50;  // > +$50 over 14d = positive
const NEGATIVE_THRESHOLD = -50; // < -$50 = negative

interface RecRow {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  applied_at: string;
  applied_price: number | null;
  current_price: number;
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

    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    // 1. Find applied recs older than 14 days with no outcome row yet
    const { data: candidatesRaw, error: candErr } = await supabase
      .from("pricing_recommendations")
      .select("id, tenant_id, vehicle_id, applied_at, applied_price, current_price")
      .eq("status", "applied")
      .lt("applied_at", since);
    if (candErr) return errorResponse(candErr.message ?? "Failed to load candidates", 500);
    const candidates = (candidatesRaw ?? []) as RecRow[];

    // Filter out ones already measured
    const { data: existingOutcomes } = await supabase
      .from("pricing_recommendation_outcomes")
      .select("recommendation_id")
      .in("recommendation_id", candidates.map((c) => c.id));
    const measuredIds = new Set(
      ((existingOutcomes ?? []) as Array<{ recommendation_id: string }>).map((o) => o.recommendation_id),
    );
    const toMeasure = candidates.filter((c) => !measuredIds.has(c.id));

    const summary = { candidates: candidates.length, measured: 0, positive: 0, neutral: 0, negative: 0, errors: [] as string[] };

    for (const rec of toMeasure) {
      try {
        const applied = new Date(rec.applied_at);
        const winBeforeStart = new Date(applied.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
        const winAfterEnd = new Date(applied.getTime() + WINDOW_DAYS * 86_400_000).toISOString();

        // Bookings (count of rentals that started in each window) + revenue (ledger SUM)
        const { data: rentalsBeforeRaw } = await supabase
          .from("rentals")
          .select("id")
          .eq("vehicle_id", rec.vehicle_id)
          .gte("start_date", winBeforeStart.slice(0, 10))
          .lt("start_date", rec.applied_at.slice(0, 10));
        const { data: rentalsAfterRaw } = await supabase
          .from("rentals")
          .select("id")
          .eq("vehicle_id", rec.vehicle_id)
          .gte("start_date", rec.applied_at.slice(0, 10))
          .lte("start_date", winAfterEnd.slice(0, 10));

        const bookingsBefore = (rentalsBeforeRaw ?? []).length;
        const bookingsAfter = (rentalsAfterRaw ?? []).length;

        const { data: ledgersBeforeRaw } = await supabase
          .from("ledger_entries")
          .select("amount")
          .eq("vehicle_id", rec.vehicle_id)
          .eq("type", "Charge")
          .gte("entry_date", winBeforeStart.slice(0, 10))
          .lt("entry_date", rec.applied_at.slice(0, 10));
        const { data: ledgersAfterRaw } = await supabase
          .from("ledger_entries")
          .select("amount")
          .eq("vehicle_id", rec.vehicle_id)
          .eq("type", "Charge")
          .gte("entry_date", rec.applied_at.slice(0, 10))
          .lte("entry_date", winAfterEnd.slice(0, 10));
        const revenueBefore = (ledgersBeforeRaw ?? []).reduce((s, l) => s + Number(l.amount ?? 0), 0);
        const revenueAfter = (ledgersAfterRaw ?? []).reduce((s, l) => s + Number(l.amount ?? 0), 0);

        // Utilization approximation: bookings × 7 (days/booking weekly tier) ÷ 14
        const utilBefore = Math.min(100, (bookingsBefore * 7) / WINDOW_DAYS * 100);
        const utilAfter = Math.min(100, (bookingsAfter * 7) / WINDOW_DAYS * 100);

        const netDelta = revenueAfter - revenueBefore;
        const outcome: "positive" | "neutral" | "negative" =
          netDelta > POSITIVE_THRESHOLD ? "positive"
          : netDelta < NEGATIVE_THRESHOLD ? "negative"
          : "neutral";

        const { error: insErr } = await supabase
          .from("pricing_recommendation_outcomes")
          .insert({
            recommendation_id: rec.id,
            tenant_id: rec.tenant_id,
            vehicle_id: rec.vehicle_id,
            measurement_window_days: WINDOW_DAYS,
            bookings_before: bookingsBefore,
            bookings_after: bookingsAfter,
            revenue_before: Math.round(revenueBefore * 100) / 100,
            revenue_after: Math.round(revenueAfter * 100) / 100,
            utilization_before: Math.round(utilBefore * 100) / 100,
            utilization_after: Math.round(utilAfter * 100) / 100,
            net_revenue_delta: Math.round(netDelta * 100) / 100,
            outcome,
          });
        if (insErr) {
          summary.errors.push(`${rec.id}: ${insErr.message}`);
          continue;
        }
        summary.measured++;
        summary[outcome]++;
      } catch (err) {
        summary.errors.push(`${rec.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("revenue-optimiser-measure-outcomes error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
