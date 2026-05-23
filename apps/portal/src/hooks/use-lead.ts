/**
 * useLead — single lead by id. Spec Section 10.3.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "./use-realtime-invalidate";
import type { LeadRow } from "./use-leads";

export function useLead(leadId: string | undefined) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  useRealtimeInvalidate({
    table: "leads",
    tenantId,
    queryKey: ["lead", tenantId, leadId],
    extraFilter: leadId ? `id=eq.${leadId}` : undefined,
    enabled: !!leadId,
  });

  return useQuery({
    queryKey: ["lead", tenantId, leadId],
    queryFn: async (): Promise<LeadRow | null> => {
      if (!leadId || !tenantId) return null;
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as LeadRow | null;
    },
    enabled: !!leadId && !!tenantId,
    staleTime: 30_000,
  });
}
