/**
 * Finance Sync — Sprint 4 backfill hooks.
 *
 *   useStartBackfill()                    — mutation; calls backfill-accounting-sync
 *   useBackfillJob(jobId)                 — polls progress every 5s while job is running
 *   useBackfillJobsForTenant()            — list view (recent jobs)
 *   useBackfillEventCount(args)           — pre-flight count for the date range picker
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { AccountingProvider } from "@/hooks/use-accounting-connection";

export type BackfillJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface BackfillJobRow {
  id: string;
  tenant_id: string;
  provider: AccountingProvider;
  date_from: string | null;
  date_to: string;
  status: BackfillJobStatus;
  total_events: number;
  processed_events: number;
  failed_events: number;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StartBackfillResponse {
  ok: boolean;
  backfillJobId: string;
  provider: AccountingProvider;
  total_events: number;
  estimated_minutes: number;
}

export function useStartBackfill() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (args: { provider: AccountingProvider; dateFrom: string | null; dateTo: string }): Promise<StartBackfillResponse> => {
      const { data, error } = await supabase.functions.invoke("backfill-accounting-sync", { body: args });
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
      return data as StartBackfillResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backfill-jobs", tenant?.id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start backfill"),
  });
}

/** Polls every 5s while the job is pending/running. Stops polling once complete. */
export function useBackfillJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: ["backfill-job", jobId],
    queryFn: async (): Promise<BackfillJobRow | null> => {
      if (!jobId) return null;
      const { data, error } = await supabase.functions.invoke("get-accounting-sync-status", {
        body: { backfillJobId: jobId },
      });
      if (error) throw error;
      const job = (data as { ok: boolean; job: BackfillJobRow }).job;
      return job;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return 5000;
      return ["pending", "running"].includes(job.status) ? 5000 : false;
    },
  });
}

export function useBackfillJobsForTenant() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["backfill-jobs", tenant?.id],
    queryFn: async (): Promise<BackfillJobRow[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabaseUntyped
        .from("backfill_jobs")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as BackfillJobRow[];
    },
    enabled: !!tenant?.id,
  });
}

/**
 * Pre-flight count — how many financial_events fall in the chosen date range?
 * Lets the wizard say "1,284 events · ~22 minutes" before the operator clicks Start.
 */
export function useBackfillEventCount(args: { dateFrom: string | null; dateTo: string; enabled: boolean }) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["backfill-event-count", tenant?.id, args.dateFrom, args.dateTo],
    queryFn: async (): Promise<number> => {
      if (!tenant?.id) return 0;
      let query = supabaseUntyped
        .from("financial_events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id);
      if (args.dateFrom) query = query.gte("occurred_at", args.dateFrom);
      query = query.lte("occurred_at", `${args.dateTo}T23:59:59`);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!tenant?.id && args.enabled,
  });
}
