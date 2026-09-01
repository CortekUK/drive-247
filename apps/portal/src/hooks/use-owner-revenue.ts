import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { OwnerOwedRow, OwnerRevenueRow } from "@/types/vehicle-owners";

interface RevenueRangeArgs {
  ownerId: string | undefined;
  fromDate: string | undefined; // YYYY-MM-DD
  toDate: string | undefined;
}

export function useOwnerRevenue({ ownerId, fromDate, toDate }: RevenueRangeArgs) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["owner-revenue", tenant?.id, ownerId, fromDate, toDate],
    queryFn: async (): Promise<OwnerRevenueRow[]> => {
      if (!ownerId || !fromDate || !toDate) return [];
      const { data, error } = await (supabase as any)
        .from("view_owner_revenue")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .eq("owner_id", ownerId)
        .gte("revenue_date", fromDate)
        .lte("revenue_date", toDate)
        .order("revenue_date", { ascending: false });
      if (error) throw error;
      return (data || []) as OwnerRevenueRow[];
    },
    enabled: !!tenant?.id && !!ownerId && !!fromDate && !!toDate,
  });
}

export function useOwnerOwedPreview({ ownerId, fromDate, toDate }: RevenueRangeArgs) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["owner-owed-preview", tenant?.id, ownerId, fromDate, toDate],
    queryFn: async (): Promise<OwnerOwedRow[]> => {
      if (!ownerId || !fromDate || !toDate) return [];
      const { data, error } = await (supabase as any).rpc("calculate_owner_owed", {
        p_owner_id: ownerId,
        p_from_date: fromDate,
        p_to_date: toDate,
      });
      if (error) throw error;
      return (data || []) as OwnerOwedRow[];
    },
    enabled: !!tenant?.id && !!ownerId && !!fromDate && !!toDate,
  });
}
