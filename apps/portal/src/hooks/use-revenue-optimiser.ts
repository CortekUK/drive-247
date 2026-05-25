/**
 * Revenue Optimiser portal hooks — Phase 1 surface.
 *
 * Bundled in one file to keep import noise low:
 *   useRevenueOptimiserSettings()   — read settings (auto-creates default row if missing)
 *   useToggleRevenueOptimiserMode() — mutation calling revenue-optimiser-toggle-mode edge fn
 *   useLatestBacktest()             — most recent backtest_results row
 *   useRunBacktest()                — mutation calling revenue-optimiser-backtest edge fn
 *   useRevenueOptimiserInsights()   — most recent observations (last 14 days)
 *
 * All queryKeys are tenant-scoped (Drive247 convention).
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface RevenueOptimiserSettings {
  tenant_id: string;
  enabled: boolean;
  mode: "observation" | "recommendations" | "autopilot";
  calibration_complete: boolean;
  calibration_started_at: string | null;
  backtest_completed_at: string | null;
  backtest_projected_lift_percent: number | null;
  backtest_projected_lift_amount: number | null;
  max_swing_percent: number;
  weekend_max_increase_percent: number;
  cost_floor_enabled: boolean;
  require_approval_above_amount: number | null;
  auto_pause_on_utilization_drop: boolean;
  auto_pause_threshold_percent: number;
  notify_daily_summary: boolean;
  notify_outcome: boolean;
  notify_anomalies: boolean;
  created_at: string;
  updated_at: string;
}

export interface BacktestResult {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  actual_revenue: number;
  projected_revenue: number;
  uplift_percent: number;
  uplift_amount: number;
  vehicles_analysed: number;
  bookings_analysed: number;
  confidence: "low" | "medium" | "high";
  per_vehicle_summary: {
    narrative?: string;
    cap_applied?: boolean;
    total_fleet_size?: number;
    rows?: Array<{ vehicle_id: string; reg: string; make: string; model: string; actual: number; projected: number; bookings: number }>;
  } | null;
  monthly_breakdown: Array<{ month: string; actual: number; projected: number }> | null;
  generated_at: string;
}

export interface RevenueOptimiserInsight {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  observation_type: string;
  observation_date: string;
  label: string;
  value: Record<string, unknown> | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — read + toggle
// ─────────────────────────────────────────────────────────────────────────────

export function useRevenueOptimiserSettings() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["ro-settings", tenant?.id],
    queryFn: async (): Promise<RevenueOptimiserSettings | null> => {
      if (!tenant?.id) return null;
      const { data, error } = await supabase
        .from("revenue_optimiser_settings")
        .select("*")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (error) throw error;
      return (data as RevenueOptimiserSettings | null) ?? null;
    },
    enabled: !!tenant?.id,
  });
}

export function useToggleRevenueOptimiserMode() {
  const qc = useQueryClient();
  const { tenant, refetchTenant } = useTenant();
  return useMutation({
    mutationFn: async (mode: "observation" | "recommendations" | "autopilot" | "disabled") => {
      const { data, error } = await supabase.functions.invoke("revenue-optimiser-toggle-mode", {
        body: { mode },
      });
      if (error) {
        // Surface the real edge-fn error so the operator sees "Only admin / head_admin..."
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return data as { ok: boolean; settings: RevenueOptimiserSettings };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ro-settings", tenant?.id] });
      // tenant.revenue_optimiser_enabled toggles too — refetch tenant for sidebar gating
      refetchTenant?.();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update Revenue Optimiser mode"),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Backtest — read latest + trigger
// ─────────────────────────────────────────────────────────────────────────────

export function useLatestBacktest() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["ro-latest-backtest", tenant?.id],
    queryFn: async (): Promise<BacktestResult | null> => {
      if (!tenant?.id) return null;
      const { data, error } = await supabase
        .from("backtest_results")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as BacktestResult | null) ?? null;
    },
    enabled: !!tenant?.id,
  });
}

export function useRunBacktest() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("No tenant in context");
      const { data, error } = await supabase.functions.invoke("revenue-optimiser-backtest", {
        body: { tenantId: tenant.id },
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
      return data as { backtestId: string; uplift_percent: number; uplift_amount: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ro-latest-backtest", tenant?.id] });
      toast.success(`Backtest complete — +${data.uplift_percent}% projected uplift`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Backtest failed"),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Insights — recent observations
// ─────────────────────────────────────────────────────────────────────────────

export function useRevenueOptimiserInsights(opts: { days?: number; limit?: number } = {}) {
  const { tenant } = useTenant();
  const days = opts.days ?? 14;
  const limit = opts.limit ?? 100;
  return useQuery({
    queryKey: ["ro-insights", tenant?.id, days, limit],
    queryFn: async (): Promise<RevenueOptimiserInsight[]> => {
      if (!tenant?.id) return [];
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("revenue_optimiser_insights")
        .select("*")
        .eq("tenant_id", tenant.id)
        .gte("observation_date", since)
        .order("observation_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RevenueOptimiserInsight[];
    },
    enabled: !!tenant?.id,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings updates — for the /revenue/settings page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updatable subset of revenue_optimiser_settings. Mode + calibration are NOT in
 * here — those go through `useToggleRevenueOptimiserMode` (edge fn that also
 * flips the tenant flag).
 */
export type RevenueOptimiserSettingsUpdate = Partial<Pick<
  RevenueOptimiserSettings,
  | "max_swing_percent"
  | "weekend_max_increase_percent"
  | "cost_floor_enabled"
  | "require_approval_above_amount"
  | "auto_pause_on_utilization_drop"
  | "auto_pause_threshold_percent"
  | "notify_daily_summary"
  | "notify_outcome"
  | "notify_anomalies"
>>;

export function useUpdateRevenueOptimiserSettings() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (patch: RevenueOptimiserSettingsUpdate) => {
      if (!tenant?.id) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("revenue_optimiser_settings")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenant.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as RevenueOptimiserSettings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ro-settings", tenant?.id] });
      toast.success("Settings saved");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save settings"),
  });
}
