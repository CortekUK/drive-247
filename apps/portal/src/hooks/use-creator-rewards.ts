import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Creator Rewards Programme — the operator's side.
 *
 * Reads go straight to the tables (RLS: a tenant sees only its own
 * submissions; every signed-in user may read the one settings row). The only
 * write is `submit_creator_reward()`, which enforces the programme's limits on
 * the server and returns a readable message when one is hit.
 *
 * A review by Drive247 updates the submission row, which is on the realtime
 * publication: the channel below refetches as soon as it lands, so a rejection
 * message appears without a reload.
 */

export type CreatorRewardStatus = "pending" | "approved" | "rejected";

export interface CreatorRewardSubmission {
  id: string;
  url: string;
  platform: string;
  note: string | null;
  status: CreatorRewardStatus;
  admin_message: string | null;
  reviewed_at: string | null;
  reward_type: "free_month" | "percent" | null;
  reward_percent: number | null;
  reward_status: "applied" | "pending" | "failed" | null;
  created_at: string;
}

export interface CreatorRewardSettings {
  enabled: boolean;
  monthly_submission_limit: number;
  max_pending_per_tenant: number;
  allowed_platforms: string[];
  default_reward_type: "free_month" | "percent";
  default_reward_percent: number;
  rules: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const submissionsKey = (tenantId?: string) => ["creator-reward-submissions", tenantId] as const;

export function useCreatorRewardSettings() {
  return useQuery({
    queryKey: ["creator-reward-settings"],
    queryFn: async () => {
      const { data, error } = await db
        .from("creator_reward_settings")
        .select("enabled, monthly_submission_limit, max_pending_per_tenant, allowed_platforms, default_reward_type, default_reward_percent, rules")
        .eq("id", 1)
        .single();
      if (error) throw error;
      return data as CreatorRewardSettings;
    },
    staleTime: 60_000,
  });
}

export function useCreatorRewardSubmissions() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`creator-rewards-${tenant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "creator_reward_submissions", filter: `tenant_id=eq.${tenant.id}` },
        () => void queryClient.invalidateQueries({ queryKey: submissionsKey(tenant.id) }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenant?.id, queryClient]);

  return useQuery({
    queryKey: submissionsKey(tenant?.id),
    queryFn: async () => {
      const { data, error } = await db
        .from("creator_reward_submissions")
        .select("id, url, platform, note, status, admin_message, reviewed_at, reward_type, reward_percent, reward_status, created_at")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CreatorRewardSubmission[];
    },
    enabled: !!tenant?.id,
    // Belt and braces for a socket that died quietly: re-check while anything
    // is still waiting for review, and whenever the tab regains focus.
    refetchInterval: (query) =>
      (query.state.data as CreatorRewardSubmission[] | undefined)?.some((s) => s.status === "pending") ? 30_000 : false,
    refetchOnWindowFocus: true,
  });
}

export function useSubmitCreatorReward() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ url, note }: { url: string; note?: string }) => {
      const { data, error } = await db.rpc("submit_creator_reward", { p_url: url, p_note: note ?? null });
      if (error) throw new Error(error.message);
      return data as CreatorRewardSubmission;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: submissionsKey(tenant?.id) }),
  });
}

export const CREATOR_PLATFORMS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  linkedin: "LinkedIn",
};
