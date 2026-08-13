/**
 * Finance Sync — Sprint 4 vehicle profitability hook.
 *
 *   useVehicleProfitability(period) — fetches the KPI snapshot + per-vehicle rows.
 *
 * Driven entirely by `pnl_entries` (per master plan Deviation #4) — no Xero/Zoho
 * connection required. This dashboard ships as a "bonus" for every tenant who
 * has the Finance Sync feature unlocked, even pre-connection.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface ProfitabilityVehicleRow {
  vehicle_id: string;
  reg: string | null;
  make: string | null;
  model: string | null;
  category: string | null;
  is_disposed: boolean;
  revenue: number;
  expenses: number;
  profit: number;
  utilisation_percent: number;
  roi_percent: number | null;
}

export interface ProfitabilityResponse {
  ok: boolean;
  period_start: string;
  period_end: string;
  currency: string;
  kpis: {
    revenue: number;
    expenses: number;
    net_profit: number;
    avg_roi_percent: number | null;
  };
  vehicles: ProfitabilityVehicleRow[];
}

export type ProfitabilityPeriod = "30" | "90" | "180" | "365" | "all" | { custom: { from: string; to: string } };

function resolvePeriod(period: ProfitabilityPeriod): { dateFrom: string | null; dateTo: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (typeof period === "object" && "custom" in period) {
    return { dateFrom: period.custom.from, dateTo: period.custom.to };
  }
  if (period === "all") return { dateFrom: null, dateTo: today };
  const days = Number(period);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return { dateFrom: from, dateTo: today };
}

export function useVehicleProfitability(period: ProfitabilityPeriod) {
  const { tenant } = useTenant();
  const { dateFrom, dateTo } = resolvePeriod(period);
  return useQuery({
    queryKey: ["vehicle-profitability", tenant?.id, dateFrom, dateTo],
    queryFn: async (): Promise<ProfitabilityResponse> => {
      const { data, error } = await supabase.functions.invoke("get-vehicle-profitability", {
        body: { periodStart: dateFrom, periodEnd: dateTo },
      });
      if (error) {
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return data as ProfitabilityResponse;
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,           // 5 min — pnl_entries don't change every second
  });
}
