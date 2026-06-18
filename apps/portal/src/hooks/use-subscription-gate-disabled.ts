import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";

/**
 * Global super-admin kill-switch for the subscription blocker.
 *
 * When a super admin enables "Hide subscription blocker" in the admin
 * dashboard (admin_settings.subscription_gate_disabled = true), the portal
 * stops showing the Finish-Setup / subscription-expired blocking dialog to
 * ALL tenants. Subscription data/status is otherwise untouched.
 *
 * admin_settings can have multiple rows; we treat the gate as disabled if ANY
 * row has the flag set (mirrors how the maintenance banner is read). RLS lets
 * any authenticated user SELECT admin_settings.
 */
export function useSubscriptionGateDisabled(): boolean {
  const { data } = useQuery({
    queryKey: ["subscription-gate-disabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("subscription_gate_disabled")
        .eq("subscription_gate_disabled", true)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return data ?? false;
}
