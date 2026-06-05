/**
 * useLeadActivity — Spec Section 6.4 (Activity timeline).
 * Read-only event feed from lead_activity table.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "./use-realtime-invalidate";

export interface LeadActivityEvent {
  id: string;
  tenant_id: string;
  lead_id: string;
  actor_type: "system" | "staff" | "lead" | "ai";
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function useLeadActivity(leadId: string | undefined) {
  const { tenant } = useTenant();

  useRealtimeInvalidate({
    table: "lead_activity",
    tenantId: tenant?.id,
    queryKey: ["lead-activity", tenant?.id, leadId],
    extraFilter: leadId ? `lead_id=eq.${leadId}` : undefined,
    enabled: !!leadId,
  });

  return useQuery({
    queryKey: ["lead-activity", tenant?.id, leadId],
    queryFn: async (): Promise<LeadActivityEvent[]> => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_activity")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as LeadActivityEvent[];
    },
    enabled: !!leadId && !!tenant?.id,
    staleTime: 30_000,
  });
}
