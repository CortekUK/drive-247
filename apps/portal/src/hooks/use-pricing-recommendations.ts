/**
 * Pricing recommendations hooks — Phase 2 portal surface.
 *
 *   usePricingRecommendations(filters)       — list pending + recently-actioned recs
 *   usePricingRecommendation(id)             — single rec by id
 *   useApplyRecommendation()                 — { recommendationId, customPrice? }
 *   useDismissRecommendation()               — { recommendationId, reason? }
 *   useSnoozeRecommendation()                — { recommendationId, days? }
 *   useRevertRecommendation()                — { recommendationId, reason? }
 *   usePricingOutcomes(days)                 — list outcome rows
 *
 * All mutations invalidate ["pricing-recs"] + ["pricing-outcomes"] queries
 * so the list refreshes immediately after every action.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface PricingRecommendation {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  tier: "daily" | "weekly" | "monthly" | "weekend_daily";
  current_price: number;
  recommended_price: number;
  recommended_range_low: number;
  recommended_range_high: number;
  confidence: "low" | "medium" | "high";
  confidence_score: number;
  projected_revenue_delta_monthly: number | null;
  reasons: Array<{ code: string; label: string; value: string | number; weight: number }>;
  data_points: Record<string, unknown>;
  elasticity_curve: Array<{ price: number; predicted_qty: number }> | null;
  ai_explanation: string | null;
  ai_model: string | null;
  ai_tokens_total: number | null;
  status: "pending" | "applied" | "dismissed" | "snoozed" | "expired" | "reverted" | "superseded" | "pending_approval" | "suppressed_by_admin";
  applied_at: string | null;
  applied_by: string | null;
  applied_price: number | null;
  applied_source: "manual" | "autopilot" | null;
  // Phase 3 — A/B experiment linkage + autopilot run audit
  experiment_id?: string | null;
  experiment_arm?: "control" | "test" | null;
  autopilot_run_id?: string | null;
  suppressed_at?: string | null;
  suppressed_by?: string | null;
  suppress_reason?: string | null;
  dismissed_at: string | null;
  dismiss_reason: string | null;
  snoozed_until: string | null;
  reverted_at: string | null;
  revert_reason: string | null;
  expires_at: string;
  generation_run_id: string | null;
  created_at: string;
  updated_at: string;
  // Phase 4 — combined recommendation (price drop + matching leads)
  is_combined?: boolean;
  matched_lead_ids?: string[] | null;
  // Joined vehicle metadata (when requested)
  vehicle?: { reg: string | null; make: string | null; model: string | null; category: string | null } | null;
}

export interface PricingOutcome {
  id: string;
  recommendation_id: string;
  tenant_id: string;
  vehicle_id: string;
  measured_at: string;
  measurement_window_days: number;
  bookings_before: number | null;
  bookings_after: number | null;
  revenue_before: number | null;
  revenue_after: number | null;
  utilization_before: number | null;
  utilization_after: number | null;
  net_revenue_delta: number | null;
  outcome: "positive" | "neutral" | "negative";
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendationFilters {
  status?: PricingRecommendation["status"] | PricingRecommendation["status"][];
  sort?: "impact" | "newest" | "confidence";
  limit?: number;
}

export function usePricingRecommendations(filters: RecommendationFilters = {}) {
  const { tenant } = useTenant();
  const status = filters.status ?? "pending";
  const statuses = Array.isArray(status) ? status : [status];
  const sort = filters.sort ?? "impact";
  const limit = filters.limit ?? 100;
  return useQuery({
    queryKey: ["pricing-recs", tenant?.id, statuses.join(","), sort, limit],
    queryFn: async (): Promise<PricingRecommendation[]> => {
      if (!tenant?.id) return [];
      // Hide snoozed recs whose snoozed_until is past — they should auto-resurface
      // in the next generate run, but in the meantime the UI shouldn't show them.
      const nowIso = new Date().toISOString();
      let query = supabase
        .from("pricing_recommendations")
        .select("*, vehicle:vehicles(reg, make, model, category)")
        .eq("tenant_id", tenant.id)
        .in("status", statuses)
        .or(`snoozed_until.is.null,snoozed_until.gt.${nowIso}`);
      switch (sort) {
        case "impact":
          query = query.order("projected_revenue_delta_monthly", { ascending: false, nullsFirst: false });
          break;
        case "confidence":
          query = query.order("confidence_score", { ascending: false });
          break;
        case "newest":
        default:
          query = query.order("created_at", { ascending: false });
      }
      const { data, error } = await query.limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as PricingRecommendation[];
    },
    enabled: !!tenant?.id,
  });
}

export function usePricingRecommendation(id: string | null | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["pricing-rec", tenant?.id, id],
    queryFn: async (): Promise<PricingRecommendation | null> => {
      if (!id || !tenant?.id) return null;
      const { data, error } = await supabase
        .from("pricing_recommendations")
        .select("*, vehicle:vehicles(reg, make, model, category)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as PricingRecommendation | null) ?? null;
    },
    enabled: !!id && !!tenant?.id,
  });
}

export function usePricingOutcomes(days = 90) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["pricing-outcomes", tenant?.id, days],
    queryFn: async (): Promise<PricingOutcome[]> => {
      if (!tenant?.id) return [];
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("pricing_recommendation_outcomes")
        .select("*")
        .eq("tenant_id", tenant.id)
        .gte("measured_at", since)
        .order("measured_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PricingOutcome[];
    },
    enabled: !!tenant?.id,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations — every one surfaces the real edge-fn error in toast
// ─────────────────────────────────────────────────────────────────────────────

async function callEdgeFn<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
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
  return data as T;
}

function useInvalidateRecQueries() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return () => {
    qc.invalidateQueries({ queryKey: ["pricing-recs", tenant?.id] });
    qc.invalidateQueries({ queryKey: ["pricing-rec", tenant?.id] });
    qc.invalidateQueries({ queryKey: ["pricing-outcomes", tenant?.id] });
  };
}

export function useApplyRecommendation() {
  const invalidate = useInvalidateRecQueries();
  return useMutation({
    mutationFn: async (args: { recommendationId: string; customPrice?: number }) => {
      return await callEdgeFn<{ ok: boolean; recommendation: PricingRecommendation; old_price: number; new_price: number }>(
        "revenue-optimiser-apply",
        args,
      );
    },
    onSuccess: (data) => {
      invalidate();
      const diff = data.new_price - data.old_price;
      const dir = diff > 0 ? "raised" : diff < 0 ? "lowered" : "set";
      toast.success(`Applied — price ${dir} from $${data.old_price} to $${data.new_price}.`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to apply"),
  });
}

export function useDismissRecommendation() {
  const invalidate = useInvalidateRecQueries();
  return useMutation({
    mutationFn: async (args: { recommendationId: string; reason?: string }) => {
      return await callEdgeFn<{ ok: boolean }>("revenue-optimiser-dismiss", args);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Recommendation dismissed.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to dismiss"),
  });
}

export function useSnoozeRecommendation() {
  const invalidate = useInvalidateRecQueries();
  return useMutation({
    mutationFn: async (args: { recommendationId: string; days?: number }) => {
      return await callEdgeFn<{ ok: boolean; snoozed_until: string }>("revenue-optimiser-snooze", args);
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`Snoozed until ${new Date(data.snoozed_until).toLocaleDateString()}.`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to snooze"),
  });
}

export function useRevertRecommendation() {
  const invalidate = useInvalidateRecQueries();
  return useMutation({
    mutationFn: async (args: { recommendationId: string; reason?: string }) => {
      return await callEdgeFn<{ ok: boolean; restored_price: number; previous_price: number }>(
        "revenue-optimiser-revert",
        args,
      );
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`Reverted — price restored to $${data.restored_price} (was $${data.previous_price}).`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to revert"),
  });
}
