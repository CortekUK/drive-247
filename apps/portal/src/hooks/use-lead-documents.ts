/**
 * useLeadDocuments — Spec Section 6.4 (Documents section in left column).
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface LeadDocument {
  id: string;
  tenant_id: string;
  lead_id: string;
  document_type: "licence" | "selfie" | "rideshare_proof" | "insurance" | "passport" | "utility_bill" | "other";
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  verification_status: "pending" | "uploaded" | "verifying" | "verified" | "failed" | "expired";
  verification_id: string | null;
  verification_error: string | null;
  expires_at: string | null;
  uploaded_by_lead: boolean;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

export function useLeadDocuments(leadId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["lead-documents", tenant?.id, leadId],
    queryFn: async (): Promise<LeadDocument[]> => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_documents")
        .select("*")
        .eq("lead_id", leadId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LeadDocument[];
    },
    enabled: !!leadId && !!tenant?.id,
    staleTime: 30_000,
  });
}
