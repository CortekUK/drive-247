/**
 * useLeadNotes — Spec Section 6.4 (Notes section in left column).
 * Pinned + ordered by created_at DESC. Internal-only — never sent to lead.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";

export interface LeadNote {
  id: string;
  tenant_id: string;
  lead_id: string;
  author_id: string | null;
  body: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export function useLeadNotes(leadId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["lead-notes", tenant?.id, leadId],
    queryFn: async (): Promise<LeadNote[]> => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_notes")
        .select("*")
        .eq("lead_id", leadId)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LeadNote[];
    },
    enabled: !!leadId && !!tenant?.id,
    staleTime: 30_000,
  });
}

export function useAddLeadNote() {
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, body, isPinned = false }: { leadId: string; body: string; isPinned?: boolean }) => {
      if (!tenant?.id) throw new Error("Tenant context missing");
      const { error } = await supabase.from("lead_notes").insert({
        tenant_id: tenant.id,
        lead_id: leadId,
        author_id: appUser?.id ?? null,
        body,
        is_pinned: isPinned,
      });
      if (error) throw error;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["lead-notes", tenant?.id, args.leadId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add note"),
  });
}

export function useTogglePinNote() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, leadId, isPinned }: { noteId: string; leadId: string; isPinned: boolean }) => {
      const { error } = await supabase.from("lead_notes").update({ is_pinned: isPinned }).eq("id", noteId);
      if (error) throw error;
    },
    onSuccess: (_, args) => qc.invalidateQueries({ queryKey: ["lead-notes", tenant?.id, args.leadId] }),
  });
}

export function useDeleteLeadNote() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId }: { noteId: string; leadId: string }) => {
      const { error } = await supabase.from("lead_notes").delete().eq("id", noteId);
      if (error) throw error;
    },
    onSuccess: (_, args) => qc.invalidateQueries({ queryKey: ["lead-notes", tenant?.id, args.leadId] }),
  });
}
