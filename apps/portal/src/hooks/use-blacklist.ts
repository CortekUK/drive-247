/**
 * useBlacklist — Spec Section 6.7.
 * List / add / remove blacklist entries for the current tenant.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";

export interface BlacklistEntry {
  id: string;
  tenant_id: string;
  phone_normalised: string | null;
  email_lower: string | null;
  licence_number: string | null;
  full_name: string | null;
  reason: string;
  notes: string | null;
  added_by: string | null;
  source_lead_id: string | null;
  source_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useBlacklistEntries() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["blacklist", tenant?.id],
    queryFn: async (): Promise<BlacklistEntry[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("blacklist_entries")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BlacklistEntry[];
    },
    enabled: !!tenant?.id,
  });
}

export function useAddToBlacklist() {
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      phone?: string;
      email?: string;
      licenceNumber?: string;
      fullName?: string;
      reason: string;
      notes?: string;
      sourceLeadId?: string;
    }) => {
      if (!tenant?.id) throw new Error("Tenant missing");
      const { error } = await supabase.from("blacklist_entries").insert({
        tenant_id: tenant.id,
        phone_normalised: args.phone ? args.phone.replace(/\D/g, "") : null,
        email_lower: args.email ? args.email.trim().toLowerCase() : null,
        licence_number: args.licenceNumber ? args.licenceNumber.trim().toUpperCase() : null,
        full_name: args.fullName ?? null,
        reason: args.reason,
        notes: args.notes ?? null,
        added_by: appUser?.id ?? null,
        source_lead_id: args.sourceLeadId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blacklist", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["leads", tenant?.id] });
      toast.success("Added to blacklist");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add"),
  });
}

export function useRemoveFromBlacklist() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("blacklist_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blacklist", tenant?.id] });
      toast.success("Removed from blacklist");
    },
  });
}
