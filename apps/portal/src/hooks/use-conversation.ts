/**
 * useConversation — Resolves the single conversation row for a lead.
 * Spec Section 4.3 + 6.4. One row per lead; survives lead→customer conversion.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface ConversationRow {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  customer_id: string | null;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export function useLeadConversation(leadId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["conversation", tenant?.id, leadId],
    queryFn: async (): Promise<ConversationRow | null> => {
      if (!leadId || !tenant?.id) return null;
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("lead_id", leadId)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ConversationRow | null;
    },
    enabled: !!leadId && !!tenant?.id,
    staleTime: 60_000,
  });
}
