/**
 * useLeads — Spec Section 6.3, 10.3.
 *
 * Lists leads for the kanban board / list view with optional filters.
 * Query key includes tenant_id for cache isolation.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { LeadStage } from "@/lib/lead-stage-machine";
import { useRealtimeInvalidate } from "./use-realtime-invalidate";

export interface LeadRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  full_name: string;
  email: string;
  phone: string;
  phone_normalised: string;
  email_lower: string;
  application_data: Record<string, unknown>;
  vehicle_id: string | null;
  vehicle_class: string | null;
  start_date: string | null;
  end_date: string | null;
  rental_type: string | null;
  stage: LeadStage;
  stage_updated_at: string;
  lead_score: number | null;
  score_band: "hot" | "warm" | "cold" | "risk" | null;
  source: string;
  source_metadata: Record<string, unknown> | null;
  assigned_to: string | null;
  last_contacted_at: string | null;
  last_message_at: string | null;
  last_activity_at: string;
  blacklist_match_id: string | null;
  tags: string[];
  converted_at: string | null;
  converted_to_rental_id: string | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadFilters {
  stages?: LeadStage[];
  scoreBand?: "hot" | "warm" | "cold" | "risk";
  source?: string;
  search?: string;
  assignedTo?: string;
  vehicleId?: string;
}

export function useLeads(filters: LeadFilters = {}) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  useRealtimeInvalidate({
    table: "leads",
    tenantId,
    queryKey: ["leads", tenantId, filters],
  });

  return useQuery({
    queryKey: ["leads", tenantId, filters],
    queryFn: async (): Promise<LeadRow[]> => {
      if (!tenantId) return [];
      let q = supabase
        .from("leads")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("last_activity_at", { ascending: false })
        .limit(500);

      if (filters.stages && filters.stages.length > 0) {
        q = q.in("stage", filters.stages);
      }
      if (filters.scoreBand) q = q.eq("score_band", filters.scoreBand);
      if (filters.source) q = q.eq("source", filters.source);
      if (filters.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
      if (filters.vehicleId) q = q.eq("vehicle_id", filters.vehicleId);

      if (filters.search?.trim()) {
        const term = filters.search.trim();
        // Search across name / email / phone
        q = q.or(
          [
            `full_name.ilike.%${term}%`,
            `email.ilike.%${term}%`,
            `phone.ilike.%${term}%`,
          ].join(","),
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LeadRow[];
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });
}
