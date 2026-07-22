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
          "stripe_account_id, stripe_onboarding_complete, stripe_account_status, stripe_mode, payment_model, own_stripe_account_id, own_stripe_test_account_id, bonzah_mode, bonzah_username, integration_bonzah, setup_completed_at"
        )
        .eq("id", tenant!.id)
        .single();

      if (error) throw error;
      return data as TenantSetupFields;
    },
    enabled: !!tenant,
    staleTime: 15_000,
    // Only poll while a genuine new-signup trial is being set up. isTrialing already
    // excludes migrated live operators (see use-tenant-subscription); also guard on
    // setup_completed_at so a tenant that has already gone live never regresses into
    // 30s setup polling because its migrated UAE subscription reads status='trialing'.
    refetchInterval: (query) =>
      isTrialing && !query.state.data?.setup_completed_at ? 30_000 : false,
  });

  const data = setupQuery.data;

  // Own Stripe tenants connect their OWN account via OAuth — the legacy
  // Express fields stay empty for them forever, so deriving readiness purely
  // from those would show "Stripe Connect incomplete" to an operator who has
  // already connected. Treat a connected own-account for the current mode as
  // complete.
  const d = data as (typeof data & {
    payment_model?: string | null;
    own_stripe_account_id?: string | null;
    own_stripe_test_account_id?: string | null;
  }) | undefined;
  // Operators connect their LIVE account (see own-stripe-settings), so a live
  // connection completes this item whatever mode the tenant is currently in.
  // A test connection still counts for tenants rehearsing in test mode.
  const ownConnected = !!d?.own_stripe_account_id || !!d?.own_stripe_test_account_id;
  const stripeComplete =
    ownConnected ||
    (!!data?.stripe_onboarding_complete && data?.stripe_account_status === "active");
  const bonzahComplete =
    (data?.bonzah_mode === 'test') || (!!data?.integration_bonzah && !!data?.bonzah_username);

  const setupItems: SetupItem[] = [
    {
      id: "stripe-connect",
      label: "Stripe Connect",
      description: stripeComplete
        ? "Connected and active"
        : "Connect your Stripe account to accept payments",
      isComplete: stripeComplete,
      settingsPath: "/settings?tab=payments",
    },
    {
      id: "bonzah-insurance",
      label: "Bonzah Insurance",
      description: bonzahComplete
        ? "Configured and active"
        : "Set up Bonzah to offer insurance to customers",
      isComplete: bonzahComplete,
      settingsPath: "/settings?tab=insurance",
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
