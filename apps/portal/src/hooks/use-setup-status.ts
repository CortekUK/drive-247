import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";

interface SetupItem {
  id: string;
  label: string;
  description: string;
  isComplete: boolean;
  settingsPath: string;
}

interface TenantSetupFields {
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  stripe_mode: string;
  bonzah_mode: string;
  bonzah_username: string | null;
  integration_bonzah: boolean | null;
  setup_completed_at: string | null;
}

export function useSetupStatus() {
  const { tenant } = useTenant();
  const { isTrialing, subscription } = useTenantSubscription();

  const setupQuery = useQuery({
    queryKey: ["tenant-setup-status", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select(
          "stripe_account_id, stripe_onboarding_complete, stripe_account_status, stripe_mode, bonzah_mode, bonzah_username, integration_bonzah, setup_completed_at"
        )
        .eq("id", tenant!.id)
        .single();

      if (error) throw error;
      return data as TenantSetupFields;
    },
    enabled: !!tenant,
    staleTime: 15_000,
    refetchInterval: isTrialing ? 30_000 : false,
  });

  const data = setupQuery.data;

  const stripeComplete =
    !!data?.stripe_onboarding_complete &&
    data?.stripe_account_status === "active";
  const bonzahComplete =
    !!data?.integration_bonzah && !!data?.bonzah_username;

  const setupItems: SetupItem[] = [
    {
      id: "stripe-connect",
      label: "Stripe Connect",
      description: stripeComplete
        ? "Connected and active"
        : "Connect your Stripe account to accept payments",
      isComplete: stripeComplete,
      settingsPath: "/settings?tab=integrations",
    },
    {
      id: "bonzah-insurance",
      label: "Bonzah Insurance",
      description: bonzahComplete
        ? "Configured and active"
        : "Set up Bonzah to offer insurance to customers",
      isComplete: bonzahComplete,
      settingsPath: "/settings?tab=integrations",
    },
  ];

  const completedCount = setupItems.filter((i) => i.isComplete).length;
  const progressPercent = Math.round((completedCount / setupItems.length) * 100);
  const allComplete = completedCount === setupItems.length;

  const isLive = data?.stripe_mode === "live";

  const justWentLive = (() => {
    if (!data?.setup_completed_at) return false;
    const completedAt = new Date(data.setup_completed_at);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return completedAt > oneDayAgo;
  })();

  return {
    setupItems,
    progressPercent,
    allComplete,
    isTrialing,
    trialEnd: subscription?.trial_end ?? null,
    isLive,
    justWentLive,
    isLoading: setupQuery.isLoading,
    refetch: setupQuery.refetch,
  };
}
