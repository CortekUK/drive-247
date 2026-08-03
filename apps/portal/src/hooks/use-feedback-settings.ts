import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";

export interface FeedbackSettings {
  formEnabled: boolean;
  forceLoginTriggeredAt: string | null;
}

/**
 * Platform-wide feedback config.
 *
 * The query key deliberately carries NO `tenant.id` — a documented exception to
 * this repo's usual convention. There is exactly one row of this config for the
 * whole platform, so keying it per tenant would just refetch identical data
 * once per tenant context.
 *
 * Fails OPEN (`formEnabled: true`) on error: a transient query failure hiding
 * the feedback button is a worse outcome than showing it, and the insert is
 * RLS-gated anyway.
 */
export const useFeedbackSettings = () => {
  const { appUser } = useAuth();

  const query = useQuery({
    queryKey: ["tenant-feedback-settings"],
    queryFn: async (): Promise<FeedbackSettings> => {
      const { data, error } = await (supabase as any)
        .from("tenant_feedback_settings")
        .select("form_enabled, force_login_triggered_at")
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return {
        formEnabled: data?.form_enabled ?? true,
        forceLoginTriggeredAt: data?.force_login_triggered_at ?? null,
      };
    },
    // Never fires on /login — appUser only exists inside the dashboard.
    enabled: !!appUser,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    formEnabled: query.data?.formEnabled ?? true,
    forceLoginTriggeredAt: query.data?.forceLoginTriggeredAt ?? null,
    isLoading: query.isLoading,
    // "We have a trustworthy answer" — used by the triggers so they never fire
    // off default values before the real config lands.
    isResolved: query.isSuccess || query.isError,
  };
};
