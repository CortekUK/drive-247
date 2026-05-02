"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface EnquiryStats {
  pending: number;   // status = 'new'
  contacted: number;
  resolved: number;
  totalThisMonth: number;
}

/**
 * Counts of enquiries broken down by status, used for sidebar badge and stat
 * cards on the list page. Mirrors `useReminderStats` cadence (60s refetch).
 */
export function useEnquiryStats() {
  const { tenant } = useTenant();

  return useQuery<EnquiryStats>({
    queryKey: ["enquiry-stats", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) {
        return { pending: 0, contacted: 0, resolved: 0, totalThisMonth: 0 };
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [pending, contacted, resolved, monthly] = await Promise.all([
        supabase
          .from("enquiries")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("status", "new"),
        supabase
          .from("enquiries")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("status", "contacted"),
        supabase
          .from("enquiries")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("status", "resolved"),
        supabase
          .from("enquiries")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .gte("created_at", startOfMonth.toISOString()),
      ]);

      return {
        pending: pending.count ?? 0,
        contacted: contacted.count ?? 0,
        resolved: resolved.count ?? 0,
        totalThisMonth: monthly.count ?? 0,
      };
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
