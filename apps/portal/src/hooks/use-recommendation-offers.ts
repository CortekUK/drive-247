/**
 * Phase 4 — combined recommendation offer hooks.
 *
 *   useMatchedLeads(recommendationId, matchedLeadIds) — fetch the joined leads
 *   useSendRecommendationOffers()                    — dispatch via edge fn
 *   useRecommendationOfferDispatches(recId)          — per-rec offer history
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface MatchedLeadRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  vehicle_class: string | null;
  vehicle_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface OfferDispatchRow {
  id: string;
  recommendation_id: string;
  tenant_id: string;
  lead_id: string;
  channel: "sms" | "whatsapp" | "email";
  dispatch_status: "queued" | "sent" | "failed";
  dispatched_at: string | null;
  dispatch_error: string | null;
  converted_at: string | null;
  converted_to_rental_id: string | null;
  created_at: string;
  lead?: { full_name: string | null; phone: string | null; email: string | null } | null;
}

export function useMatchedLeads(matchedLeadIds: string[] | null | undefined) {
  const { tenant } = useTenant();
  const ids = matchedLeadIds ?? [];
  return useQuery({
    queryKey: ["matched-leads", tenant?.id, ids.join(",")],
    queryFn: async (): Promise<MatchedLeadRow[]> => {
      if (!tenant?.id || ids.length === 0) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, full_name, email, phone, stage, vehicle_class, vehicle_id, start_date, end_date, created_at")
        .in("id", ids);
      if (error) throw error;
      // Preserve the rec's ordering (which is by score, highest first)
      const map = new Map<string, MatchedLeadRow>(
        ((data ?? []) as MatchedLeadRow[]).map((r) => [r.id, r]),
      );
      return ids.map((id) => map.get(id)).filter((x): x is MatchedLeadRow => !!x);
    },
    enabled: !!tenant?.id && ids.length > 0,
  });
}

export function useRecommendationOfferDispatches(recommendationId: string | null | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["offer-dispatches", tenant?.id, recommendationId],
    queryFn: async (): Promise<OfferDispatchRow[]> => {
      if (!recommendationId || !tenant?.id) return [];
      const { data, error } = await supabaseUntyped
        .from("revenue_optimiser_offer_dispatches")
        .select("*, lead:leads(full_name, phone, email)")
        .eq("recommendation_id", recommendationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as OfferDispatchRow[]);
    },
    enabled: !!recommendationId && !!tenant?.id,
  });
}

export function useSendRecommendationOffers() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (args: {
      recommendationId: string;
      leadIds: string[];
      messageBody?: string;
      templateId?: string;
      channel?: "sms" | "email" | "whatsapp";
    }) => {
      const { data, error } = await supabase.functions.invoke("revenue-optimiser-send-offers", { body: args });
      if (error) {
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return data as {
        ok: boolean;
        recommendation_id: string;
        requested: number;
        dispatched: number;
        failed: number;
        skipped_no_channel: number;
        already_dispatched: number;
      };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["pricing-recs", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["pricing-rec", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["offer-dispatches", tenant?.id] });
      const ok = data.dispatched, skipped = data.skipped_no_channel + data.already_dispatched, failed = data.failed;
      if (failed === 0) {
        toast.success(`${ok} offer${ok === 1 ? "" : "s"} sent${skipped ? ` (${skipped} skipped)` : ""}.`);
      } else {
        toast.warning(`${ok} sent · ${failed} failed${skipped ? ` · ${skipped} skipped` : ""}`);
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to send offers"),
  });
}
