/**
 * Revenue Optimiser Rules — Phase 3 hooks.
 *
 *   useRevenueOptimiserRules()      — list rules for the tenant
 *   useCreateRule()                 — insert vehicle- or category-scoped rule
 *   useUpdateRule()                 — partial UPDATE on rule fields
 *   useDeleteRule()                 — DELETE rule
 *
 * RLS allows admin/head_admin to write directly from the portal — same pattern
 * as `useUpdateRevenueOptimiserSettings`. No edge fn needed.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface RevenueOptimiserRule {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  category: string | null;
  autopilot_enabled: boolean;
  paused_until: string | null;
  min_price_daily: number | null;
  max_price_daily: number | null;
  min_price_weekly: number | null;
  max_price_weekly: number | null;
  min_price_monthly: number | null;
  max_price_monthly: number | null;
  created_at: string;
  updated_at: string;
}

export type RuleScope =
  | { vehicle_id: string; category?: never }
  | { vehicle_id?: never; category: string };

export type RuleInsert = RuleScope & {
  autopilot_enabled?: boolean;
  paused_until?: string | null;
  min_price_daily?: number | null;
  max_price_daily?: number | null;
  min_price_weekly?: number | null;
  max_price_weekly?: number | null;
  min_price_monthly?: number | null;
  max_price_monthly?: number | null;
};

export type RuleUpdate = Partial<Omit<RuleInsert, "vehicle_id" | "category">>;

export function useRevenueOptimiserRules() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["ro-rules", tenant?.id],
    queryFn: async (): Promise<RevenueOptimiserRule[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("revenue_optimiser_rules")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("category", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RevenueOptimiserRule[];
    },
    enabled: !!tenant?.id,
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (input: RuleInsert) => {
      if (!tenant?.id) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("revenue_optimiser_rules")
        .insert({ ...input, tenant_id: tenant.id })
        .select("*")
        .single();
      if (error) throw error;
      return data as RevenueOptimiserRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ro-rules", tenant?.id] });
      toast.success("Rule created");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create rule"),
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: RuleUpdate }) => {
      const { data, error } = await supabase
        .from("revenue_optimiser_rules")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data as RevenueOptimiserRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ro-rules", tenant?.id] });
      toast.success("Rule updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update rule"),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("revenue_optimiser_rules").delete().eq("id", id);
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ro-rules", tenant?.id] });
      toast.success("Rule deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete rule"),
  });
}

/**
 * Categories present on the tenant's vehicles. Used to populate the rule-editor
 * scope dropdown. Returns unique sorted strings.
 */
export function useVehicleCategories() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["vehicle-categories", tenant?.id],
    queryFn: async (): Promise<string[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("vehicles")
        .select("category")
        .eq("tenant_id", tenant.id)
        .not("category", "is", null);
      if (error) throw error;
      const set = new Set<string>(
        ((data ?? []) as Array<{ category: string | null }>)
          .map((r) => r.category)
          .filter((c): c is string => !!c && c.trim().length > 0),
      );
      return [...set].sort();
    },
    enabled: !!tenant?.id,
  });
}

/** Vehicles list (id + reg/make/model/category) for the rule-editor vehicle picker. */
export function useVehicleList() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["vehicle-list-min", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model, category, daily_rent, weekly_rent, monthly_rent, cost_floor_daily, cost_floor_weekly, cost_floor_monthly")
        .eq("tenant_id", tenant.id)
        .order("reg", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        reg: string | null;
        make: string | null;
        model: string | null;
        category: string | null;
        daily_rent: number | null;
        weekly_rent: number | null;
        monthly_rent: number | null;
        cost_floor_daily: number | null;
        cost_floor_weekly: number | null;
        cost_floor_monthly: number | null;
      }>;
    },
    enabled: !!tenant?.id,
  });
}
