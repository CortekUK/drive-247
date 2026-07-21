import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";

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
  // This flag short-circuits EVERYTHING in the dashboard gate — gateOpen, the
  // latch, showGate and even the fail-closed skeleton hold — so it is the single
  // most dangerous value to get wrong. It is the last gate input that was still
  // running unauthenticated with a key carrying no identity: exactly the shape
  // that hid the paywall via subscription_plans.
  //
  // It fails SAFE today rather than open (admin_settings RLS filters for anon, so
  // maybeSingle() yields null -> `!!data` false -> gate NOT suppressed), so this
  // is defence in depth, not a live bypass. Guarding it anyway stops a pointless
  // signed-out request and stops one account's answer being reused for another.
  const { session, user } = useAuth();
  const { data } = useQuery({
    queryKey: ["subscription-gate-disabled", user?.id ?? "anon"],
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
    enabled: !!session,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return data ?? false;
}
