/**
 * useLeadMutations — stage transitions, assignment, tags, read tracking.
 * Spec Sections 6.1 + 10.3.
 *
 * All mutations are tenant-scoped via RLS on the leads table.
 * Stage transitions are validated in canTransition() before the UPDATE,
 * mirroring the DB trigger.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { canTransition, type LeadStage } from "@/lib/lead-stage-machine";

export function useUpdateLeadStage() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, currentStage, nextStage }: {
      leadId: string;
      currentStage: LeadStage;
      nextStage: LeadStage;
    }) => {
      if (!canTransition(currentStage, nextStage)) {
        throw new Error(`Invalid stage transition: ${currentStage} → ${nextStage}`);
      }
      const { error } = await supabase
        .from("leads")
        .update({ stage: nextStage })
        .eq("id", leadId);
      if (error) throw error;
    },
    onMutate: async ({ leadId, nextStage }) => {
      const listKey = ["leads", tenant?.id];
      const singleKey = ["lead", tenant?.id, leadId];
      await Promise.all([
        qc.cancelQueries({ queryKey: listKey }),
        qc.cancelQueries({ queryKey: singleKey }),
      ]);
      const previousList = qc.getQueriesData({ queryKey: listKey });
      const previousSingle = qc.getQueryData(singleKey);

      // Optimistically update every cached `leads` list query for this tenant
      previousList.forEach(([qKey, value]) => {
        if (!Array.isArray(value)) return;
        const next = (value as { id: string; stage: LeadStage }[]).map((l) =>
          l.id === leadId ? { ...l, stage: nextStage } : l,
        );
        qc.setQueryData(qKey, next);
      });
      // Also update the single-lead cache so the workspace (stage dropdown,
      // quick-action enabled-states, top bar badges) reflects the new stage
      // immediately — not on next refetch.
      if (previousSingle && typeof previousSingle === "object") {
        qc.setQueryData(singleKey, { ...(previousSingle as object), stage: nextStage });
      }

      return { previousList, previousSingle, singleKey };
    },
    onError: (err, _vars, ctx) => {
      ctx?.previousList?.forEach(([qKey, value]) => qc.setQueryData(qKey, value));
      if (ctx?.singleKey && ctx.previousSingle !== undefined) {
        qc.setQueryData(ctx.singleKey, ctx.previousSingle);
      }
      toast.error(err instanceof Error ? err.message : "Failed to update stage");
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["leads", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["lead", tenant?.id, vars.leadId] });
    },
  });
}

export function useAssignLead() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, userId }: { leadId: string; userId: string | null }) => {
      const { error } = await supabase
        .from("leads")
        .update({ assigned_to: userId })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      // Same pattern — both the board list and the workspace view must refresh.
      qc.invalidateQueries({ queryKey: ["leads", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["lead", tenant?.id, vars.leadId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to assign"),
  });
}

export function useUpdateLeadTags() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, tags }: { leadId: string; tags: string[] }) => {
      const { error } = await supabase
        .from("leads")
        .update({ tags })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["leads", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["lead", tenant?.id, vars.leadId] });
    },
  });
}

/**
 * Edit a lead's contact fields (typo fixes).
 *
 * Caller should pre-validate format — this is a thin wrapper so the trigger
 * normalise_lead_identifiers() can recompute phone_normalised / email_lower
 * from the new value.
 */
export function useUpdateLeadContact() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      leadId,
      patch,
    }: {
      leadId: string;
      patch: { full_name?: string; phone?: string; email?: string };
    }) => {
      if (Object.keys(patch).length === 0) return;
      const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: ["leads", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["lead", tenant?.id, args.leadId] });
    },
    onError: (err) => {
      const msg = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to update lead";
      toast.error(msg);
    },
  });
}

export function useMarkLeadRead() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async ({ leadId, userId }: { leadId: string; userId: string }) => {
      const { error } = await supabase
        .from("leads")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
          read_by: userId,
        })
        .eq("id", leadId)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["leads", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["lead", tenant?.id, vars.leadId] });
    },
  });
}
