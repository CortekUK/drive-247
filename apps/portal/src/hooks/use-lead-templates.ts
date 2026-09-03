/**
 * useLeadTemplates — Spec Section 15.
 * Loads tenant's lead_message_templates for the composer's template picker.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface LeadMessageTemplate {
  id: string;
  tenant_id: string;
  name: string;
  channel: "sms" | "email" | "whatsapp";
  category: "welcome" | "doc_request" | "approval" | "offer" | "reminder" | "decline" | "followup" | "custom";
  subject: string | null;
  body: string;
  is_default: boolean;
  is_active: boolean;
}

export function useLeadTemplates(channel?: LeadMessageTemplate["channel"]) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["lead-templates", tenant?.id, channel ?? "all"],
    queryFn: async (): Promise<LeadMessageTemplate[]> => {
      if (!tenant?.id) return [];
      let q = supabase
        .from("lead_message_templates")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .order("category", { ascending: true });
      if (channel) q = q.eq("channel", channel);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LeadMessageTemplate[];
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
  });
}
