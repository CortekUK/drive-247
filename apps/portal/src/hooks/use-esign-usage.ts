import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "./use-tenant-subscription";

export interface ESignUsageEvent {
  id: string;
  tenant_id: string;
  rental_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  rental_ref: string | null;
  unit_cost: number;
  currency: string;
  stripe_event_id: string | null;
  created_at: string;
}

export interface MonthlyUsageAggregate {
  month: string; // YYYY-MM
  count: number;
  total_cost: number;
}

export function useESignUsage() {
  const { tenant } = useTenant();
  const { subscription } = useTenantSubscription();

  const periodStart = subscription?.current_period_start ?? null;
  const periodEnd = subscription?.current_period_end ?? null;

  // Current period usage events
  const currentPeriodQuery = useQuery({
    queryKey: ["esign-usage-current", tenant?.id, periodStart],
    queryFn: async () => {
      let query = (supabase as any)
        .from("esign_usage_log")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });

      if (periodStart) {
        query = query.gte("created_at", periodStart);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as ESignUsageEvent[];
    },
    enabled: !!tenant,
    staleTime: 30_000,
  });

  // All-time usage for historical chart (group by month client-side)
  const allUsageQuery = useQuery({
    queryKey: ["esign-usage-all", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("esign_usage_log")
        .select("created_at, unit_cost")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Aggregate by month
      const monthMap = new Map<string, { count: number; total_cost: number }>();
      for (const row of data || []) {
        const month = row.created_at.substring(0, 7); // YYYY-MM
        const existing = monthMap.get(month) || { count: 0, total_cost: 0 };
        existing.count += 1;
        existing.total_cost += Number(row.unit_cost);
        monthMap.set(month, existing);
      }

      const aggregates: MonthlyUsageAggregate[] = [];
      for (const [month, val] of monthMap) {
        aggregates.push({ month, count: val.count, total_cost: Math.round(val.total_cost * 100) / 100 });
      }
      return aggregates;
    },
    enabled: !!tenant,
    staleTime: 60_000,
  });

  const currentEvents = currentPeriodQuery.data || [];
  const currentCount = currentEvents.length;
  const currentCost = currentEvents.reduce((sum, e) => sum + Number(e.unit_cost), 0);
  const unitCost = 1.00;

  return {
    currentEvents,
    currentCount,
    currentCost: Math.round(currentCost * 100) / 100,
    unitCost,
    periodStart,
    periodEnd,
    monthlyAggregates: allUsageQuery.data || [],
    isLoading: currentPeriodQuery.isLoading,
    isLoadingHistory: allUsageQuery.isLoading,
  };
}
