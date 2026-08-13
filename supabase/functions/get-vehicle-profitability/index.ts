/**
 * get-vehicle-profitability — Spec §11 + master plan Deviation #4.
 *
 * Reads per-vehicle revenue + expenses from the existing `pnl_entries` table
 * (NOT financial_events — that table only feeds the sync layer). Returns
 * KPIs + per-vehicle rows for the Vehicle Profitability dashboard at
 * /reports/vehicle-profitability.
 *
 * Utilisation comes from a separate query against `rentals` — count of days
 * the vehicle was on a rental in the period vs. total period days.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  periodStart?: string;   // ISO date — defaults to 12 months ago
  periodEnd?: string;     // ISO date — defaults to today
}

interface PnlRow {
  vehicle_id: string;
  side: "Revenue" | "Cost";
  category: string;
  amount: number;
}

interface VehicleRow {
  id: string;
  reg: string | null;
  make: string | null;
  model: string | null;
  category: string | null;
  purchase_price: number | null;
  is_disposed: boolean | null;
}

interface RentalDaysRow {
  vehicle_id: string;
  start_date: string;
  end_date: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return errorResponse("Unauthorised", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    const periodEnd = body.periodEnd ?? new Date().toISOString().slice(0, 10);
    const periodStart = body.periodStart
      ?? new Date(Date.parse(periodEnd) - 365 * 86_400_000).toISOString().slice(0, 10);

    // Currency for the response — tenant-global.
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("currency_code")
      .eq("id", tenantId)
      .maybeSingle();
    const currency = (tenantRow as { currency_code?: string } | null)?.currency_code ?? "USD";

    // Pull P&L entries in the period
    const { data: pnlRaw } = await supabase
      .from("pnl_entries")
      .select("vehicle_id, side, category, amount")
      .eq("tenant_id", tenantId)
      .gte("entry_date", periodStart)
      .lte("entry_date", periodEnd);
    const pnl = (pnlRaw ?? []) as PnlRow[];

    // Pull the tenant's vehicles
    const { data: vehRaw } = await supabase
      .from("vehicles")
      .select("id, reg, make, model, category, purchase_price, is_disposed")
      .eq("tenant_id", tenantId);
    const vehicles = (vehRaw ?? []) as VehicleRow[];

    // Pull rentals in the period for utilisation calc.
    // CRITICAL: filter out cancelled / reserved / quote rentals. Otherwise a
    // cancelled "would have been Jan 1-7" booking still counts as 7 utilised
    // days and inflates everyone's utilisation. Only rentals that actually
    // happened count: Active, Closed, Completed, Returned, Ongoing.
    const COUNTING_STATUSES = ["Active", "Closed", "Completed", "Returned", "Ongoing"];
    const { data: rentalsRaw } = await supabase
      .from("rentals")
      .select("vehicle_id, start_date, end_date, status")
      .eq("tenant_id", tenantId)
      .gte("end_date", periodStart)
      .lte("start_date", periodEnd)
      .in("status", COUNTING_STATUSES);
    const rentals = (rentalsRaw ?? []) as RentalDaysRow[];

    const periodDays = Math.max(
      1,
      Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / 86_400_000) + 1,
    );

    // Aggregate per vehicle
    const byVehicle = new Map<string, { revenue: number; expenses: number }>();
    for (const v of vehicles) byVehicle.set(v.id, { revenue: 0, expenses: 0 });
    for (const p of pnl) {
      if (!p.vehicle_id) continue;
      let entry = byVehicle.get(p.vehicle_id);
      if (!entry) {
        entry = { revenue: 0, expenses: 0 };
        byVehicle.set(p.vehicle_id, entry);
      }
      if (p.side === "Revenue") entry.revenue += Number(p.amount ?? 0);
      else if (p.side === "Cost") entry.expenses += Number(p.amount ?? 0);
    }

    // Utilisation per vehicle — count days within the period the vehicle was on a rental
    const utilByVehicle = new Map<string, number>();
    const periodStartMs = Date.parse(periodStart);
    const periodEndMs = Date.parse(periodEnd);
    for (const r of rentals) {
      if (!r.vehicle_id || !r.start_date || !r.end_date) continue;
      const sMs = Math.max(Date.parse(r.start_date), periodStartMs);
      const eMs = Math.min(Date.parse(r.end_date), periodEndMs);
      if (eMs < sMs) continue;
      const days = Math.max(1, Math.round((eMs - sMs) / 86_400_000) + 1);
      utilByVehicle.set(r.vehicle_id, (utilByVehicle.get(r.vehicle_id) ?? 0) + days);
    }

    // Build per-vehicle rows
    const rows = vehicles.map((v) => {
      const agg = byVehicle.get(v.id) ?? { revenue: 0, expenses: 0 };
      const profit = agg.revenue - agg.expenses;
      const utilDays = utilByVehicle.get(v.id) ?? 0;
      const utilisation = Math.min(100, Math.round((utilDays / periodDays) * 1000) / 10);
      const purchase = Number(v.purchase_price ?? 0);
      const roi = purchase > 0 ? Math.round((profit / purchase) * 1000) / 10 : null;
      return {
        vehicle_id: v.id,
        reg: v.reg,
        make: v.make,
        model: v.model,
        category: v.category,
        is_disposed: !!v.is_disposed,
        revenue: Math.round(agg.revenue * 100) / 100,
        expenses: Math.round(agg.expenses * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        utilisation_percent: utilisation,
        roi_percent: roi,
      };
    });

    // Sort by profit desc for default table order
    rows.sort((a, b) => b.profit - a.profit);

    const totals = rows.reduce(
      (acc, r) => {
        acc.revenue += r.revenue;
        acc.expenses += r.expenses;
        acc.profit += r.profit;
        if (r.roi_percent !== null) {
          acc.roi_sum += r.roi_percent;
          acc.roi_count++;
        }
        return acc;
      },
      { revenue: 0, expenses: 0, profit: 0, roi_sum: 0, roi_count: 0 },
    );

    return jsonResponse({
      ok: true,
      period_start: periodStart,
      period_end: periodEnd,
      currency,
      kpis: {
        revenue: Math.round(totals.revenue * 100) / 100,
        expenses: Math.round(totals.expenses * 100) / 100,
        net_profit: Math.round(totals.profit * 100) / 100,
        avg_roi_percent: totals.roi_count > 0
          ? Math.round((totals.roi_sum / totals.roi_count) * 10) / 10
          : null,
      },
      vehicles: rows,
    });
  } catch (err) {
    console.error("get-vehicle-profitability error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
