/**
 * useAutomations / useAutomation / useAutomationRuns / use-automation-mutations.
 * Spec Section 7.4 + 10.3.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "./use-realtime-invalidate";
import { useAuthStore } from "@/stores/auth-store";

/** Format any error (Error, PostgrestError, plain object, string) into a useful string. */
function fmtError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    return e.message || e.details || e.hint || (e.code ? `Error ${e.code}` : fallback);
  }
  return fallback;
}

export interface AutomationRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  status: "draft" | "published" | "archived";
  version: number;
  published_at: string | null;
  published_snapshot: { steps?: AutomationStep[] } | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationStep {
  id: string;
  automation_id: string;
  parent_step_id: string | null;
  order_index: number;
  step_type: "sms" | "email" | "wait" | "condition" | "stop";
  config: Record<string, unknown>;
  branch: "true" | "false" | null;
  created_at: string;
  updated_at: string;
}

export function useAutomations() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["automations", tenant?.id],
    queryFn: async (): Promise<AutomationRow[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("automations")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AutomationRow[];
    },
    enabled: !!tenant?.id,
  });
}

export function useAutomation(id: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["automation", tenant?.id, id],
    queryFn: async (): Promise<AutomationRow | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("automations")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as AutomationRow | null;
    },
    enabled: !!id && !!tenant?.id,
  });
}

export function useAutomationSteps(automationId: string | undefined) {
  return useQuery({
    queryKey: ["automation-steps", automationId],
    queryFn: async (): Promise<AutomationStep[]> => {
      if (!automationId) return [];
      const { data, error } = await supabase
        .from("automation_steps")
        .select("*")
        .eq("automation_id", automationId)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AutomationStep[];
    },
    enabled: !!automationId,
  });
}

export function useAutomationRuns(automationId: string | undefined) {
  const { tenant } = useTenant();
  useRealtimeInvalidate({
    table: "automation_runs",
    tenantId: tenant?.id,
    queryKey: ["automation-runs", tenant?.id, automationId],
    extraFilter: automationId ? `automation_id=eq.${automationId}` : undefined,
    enabled: !!automationId,
  });
  return useQuery({
    queryKey: ["automation-runs", tenant?.id, automationId],
    queryFn: async () => {
      if (!automationId) return [];
      const { data, error } = await supabase
        .from("automation_runs")
        .select("*")
        .eq("automation_id", automationId)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!automationId && !!tenant?.id,
  });
}

export function useCreateAutomation() {
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, triggerType }: { name: string; triggerType: string }) => {
      if (!tenant?.id) throw new Error("Tenant missing");
      const { data, error } = await supabase
        .from("automations")
        .insert({
          tenant_id: tenant.id,
          name,
          trigger_type: triggerType,
          trigger_config: {},
          status: "draft",
          version: 0,
          created_by: appUser?.id ?? null,
          updated_by: appUser?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations", tenant?.id] });
    },
    onError: (err) => toast.error(fmtError(err, "Failed to create")),
  });
}

export function useUpdateAutomation() {
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<AutomationRow, "name" | "description" | "trigger_type" | "trigger_config" | "status">>;
    }) => {
      const updates: Record<string, unknown> = { ...patch, updated_by: appUser?.id ?? undefined };
      // Editing a published automation reverts to draft (published_snapshot stays for in-flight runs)
      const { data: current } = await supabase
        .from("automations")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (current?.status === "published" && Object.keys(patch).some((k) => k !== "status")) {
        Object.assign(updates, { status: "draft" });
      }
      const { error } = await supabase.from("automations").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["automations", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["automation", tenant?.id, args.id] });
    },
    onError: (err) => toast.error(fmtError(err, "Failed to save")),
  });
}

export function useUpsertAutomationSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ automationId, steps }: { automationId: string; steps: Omit<AutomationStep, "created_at" | "updated_at">[] }) => {
      // Replace-all strategy for V1: delete + insert.
      const { error: delErr } = await supabase.from("automation_steps").delete().eq("automation_id", automationId);
      if (delErr) throw delErr;
      if (steps.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insErr } = await (supabase.from("automation_steps") as any).insert(steps);
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["automation-steps", args.automationId] });
    },
  });
}

export function usePublishAutomation() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (automationId: string) => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; version: number }>(
        "automation-publish",
        { body: { automationId } },
      );
      if (error) {
        // FunctionsHttpError keeps the original Response on .context. Without
        // this read, every 4xx/5xx shows "non-2xx status code" instead of the
        // actual edge-fn reason (e.g. "Only admin / head_admin can publish").
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error)
            : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return data;
    },
    onSuccess: (data, automationId) => {
      qc.invalidateQueries({ queryKey: ["automations", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["automation", tenant?.id, automationId] });
      toast.success(`Published v${data?.version}`);
    },
    onError: (err) => toast.error(fmtError(err, "Publish failed")),
  });
}

export function useDeleteAutomation() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("automations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations", tenant?.id] });
      toast.success("Automation deleted");
    },
  });
}
