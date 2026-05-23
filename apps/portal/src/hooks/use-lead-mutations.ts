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
      const key = ["leads", tenant?.id];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueriesData({ queryKey: key });

      // Optimistically update every cached `leads` query for this tenant
      previous.forEach(([qKey, value]) => {
        if (!Array.isArray(value)) return;
        const next = (value as { id: string; stage: LeadStage }[]).map((l) =>
          l.id === leadId ? { ...l, stage: nextStage } : l,
        );
        qc.setQueryData(qKey, next);
      });

      return { previous };
    },
    onError: (err, _vars, ctx) => {
      ctx?.previous?.forEach(([qKey, value]) => qc.setQueryData(qKey, value));
      toast.error(err instanceof Error ? err.message : "Failed to update stage");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["leads", tenant?.id] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads", tenant?.id] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads", tenant?.id] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads", tenant?.id] }),
  });
}
