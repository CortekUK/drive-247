import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { useBonzahBalance, getBonzahPortalUrl } from "@/hooks/use-bonzah-balance";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
import { useGoLiveRequests } from "@/hooks/use-go-live-request";
import { format } from "date-fns";

export type IntegrationStatus =
  | "live"
  | "test"
  | "configured"
  | "not_configured"
  | "coming_soon";

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  isComplete: boolean;
  actionLabel: string;
  actionPath: string;
  priority: number;
  // Integration metadata (enriched inline)
  integrationStatus?: IntegrationStatus;
  statusLabel?: string;
  mode?: "test" | "live" | null;
  metric?: { label: string; value: string; warning?: string; warningUrl?: string };
  secondaryMetric?: { label: string; value: string; warning?: string; warningUrl?: string };
  comingSoon?: boolean;
  goLiveStatus?: "pending" | "approved" | "rejected" | null;
  icon?: string;
  secondaryActionLabel?: string;
  secondaryActionPath?: string;
}

export interface PlatformStatus {
  mode: "trial" | "live" | "expired" | "no_subscription";
  trialDaysRemaining: number;
  trialEnd: string | null;
  wentLiveAt: string | null;
  isSubscribed: boolean;
  checklist: ChecklistItem[];
  checklistProgress: number;
  allChecklistComplete: boolean;
  isLoading: boolean;
}

export function usePlatformStatus(): PlatformStatus {
  const { tenant } = useTenant();
  const {
    isSubscribed,
    isTrialing,
    trialDaysRemaining,
    subscription,
    hasExpiredSubscription,
  } = useTenantSubscription();
  const {
    setupItems,
    isLive,
    isLoading: setupLoading,
  } = useSetupStatus();
  const {
    balanceNumber,
    testBalanceNumber,
    isBonzahConnected,
    hasOwnCredentials,
    bonzahMode,
  } = useBonzahBalance();
  const { balance, testBalance } = useCreditWallet();
  const { getRequestStatus } = useGoLiveRequests();

  // Extra queries for checklist items not covered by existing hooks
  const { data: extraData, isLoading: extraLoading } = useQuery({
    queryKey: ["platform-status-extra", tenant?.id],
    queryFn: async () => {
      const [vehicleRes, tenantRes] = await Promise.all([
        (supabase as any)
          .from("vehicles")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant!.id),
        (supabase as any)
          .from("tenants")
          .select(
            "logo_url, boldsign_mode, boldsign_test_brand_id, boldsign_live_brand_id, integration_twilio_sms, integration_whatsapp, twilio_phone_number, meta_whatsapp_phone_number, integration_veriff, stripe_mode, setup_completed_at"
          )
          .eq("id", tenant!.id)
          .single(),
      ]);

      return {
        vehicleCount: vehicleRes.count ?? 0,
        tenantDetails: tenantRes.data as {
          logo_url: string | null;
          boldsign_mode: string | null;
          boldsign_test_brand_id: string | null;
          boldsign_live_brand_id: string | null;
          integration_twilio_sms: boolean | null;
          integration_whatsapp: boolean | null;
          twilio_phone_number: string | null;
          meta_whatsapp_phone_number: string | null;
          integration_veriff: boolean | null;
          stripe_mode: string | null;
          setup_completed_at: string | null;
        } | null,
      };
    },
    enabled: !!tenant,
    staleTime: 15_000,
  });

  const td = extraData?.tenantDetails;
  const stripeItem = setupItems.find((i) => i.id === "stripe-connect");
  const bonzahItem = setupItems.find((i) => i.id === "bonzah-insurance");

  // --- Platform mode ---
  const mode: PlatformStatus["mode"] = isTrialing
    ? "trial"
    : isLive
      ? "live"
      : hasExpiredSubscription
        ? "expired"
        : "no_subscription";

  // --- Checklist ---
  const boldsignConfigured =
    !!td?.boldsign_test_brand_id || !!td?.boldsign_live_brand_id;
  const hasVehicle = (extraData?.vehicleCount ?? 0) > 0;
  const hasLogo = !!td?.logo_url;
  const hasNotifications =
    !!td?.integration_twilio_sms || !!td?.integration_whatsapp;

  const stripeMode = td?.stripe_mode ?? "test";
  const stripeComplete = !!stripeItem?.isComplete;

  const checklist: ChecklistItem[] = [
    {
      id: "subscription",
      label: "Subscription",
      description: isTrialing
        ? `Trial · ${trialDaysRemaining} day${trialDaysRemaining !== 1 ? "s" : ""} left`
        : isSubscribed
          ? subscription?.current_period_end
            ? `Subscribed · Next charge on ${format(new Date(subscription.current_period_end), "MMM d, yyyy")}`
            : "Subscribed"
          : hasExpiredSubscription
            ? "Expired · Your last payment failed — renew to continue"
            : "Complete your subscription to get started",
      isComplete: !!isSubscribed,
      actionLabel: "Manage",
      actionPath: "/settings?tab=subscription",
      priority: 1,
      mode: isSubscribed
        ? isTrialing ? "test" : "live"
        : null,
    },
    {
      id: "stripe-connect",
      label: "Stripe Connect",
      description: stripeComplete
        ? stripeMode === "live"
          ? "Connected · Accepting live payments from your customers"
          : "Connected · Request live mode to accept real payments"
        : "Not connected · Connect to accept live payments",
      isComplete: stripeComplete,
      actionLabel: stripeComplete ? "Manage" : "Set up",
      actionPath: "/settings?tab=payments",
      priority: 2,
      integrationStatus: stripeComplete
        ? stripeMode === "live" ? "live" : "test"
        : "not_configured",
      mode: stripeComplete ? (stripeMode as "test" | "live") : "test",
      goLiveStatus: stripeComplete
        ? getRequestStatus("stripe_connect")
        : null,
    },
    {
      id: "bonzah",
      label: "Bonzah Insurance",
      description: hasOwnCredentials
        ? bonzahMode === "live"
          ? "Connected · Accepting live insurance policies"
          : "Connected · Set up your account to go live"
        : "Test mode · Set up your account to go live",
      isComplete: hasOwnCredentials,
      actionLabel: hasOwnCredentials ? "Manage" : "Set up",
      actionPath: "/settings?tab=integrations",
      priority: 5,
      integrationStatus: hasOwnCredentials
        ? bonzahMode === "live" ? "live" : "test"
        : "test",
      mode: bonzahMode as "test" | "live",
      // Show balance for the current mode — always visible (test mode works for everyone)
      metric: {
          label: bonzahMode === "live" ? "Live balance" : "Test balance",
          value: balanceNumber != null
            ? `$${balanceNumber.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "$0.00",
          warning: (balanceNumber == null || balanceNumber === 0)
            ? "Top up your balance in Bonzah"
            : undefined,
          warningUrl: (balanceNumber == null || balanceNumber === 0)
            ? getBonzahPortalUrl(bonzahMode)
            : undefined,
        },
      goLiveStatus: hasOwnCredentials
        ? getRequestStatus("bonzah")
        : null,
    },
    {
      id: "boldsign",
      label: "BoldSign E-Sign",
      description: td?.boldsign_mode === "live"
        ? "Connected · 7 credits per agreement"
        : "Connected · 7 credits per agreement (test mode)",
      isComplete: true,
      actionLabel: "Manage",
      actionPath: "/settings?tab=integrations",
      priority: 6,
      integrationStatus: td?.boldsign_mode === "live" ? "live" : "test",
      mode: (td?.boldsign_mode as "test" | "live") ?? "test",
    },
    {
      id: "credits",
      label: "Credits",
      description: "Prepaid service credits for platform features",
      isComplete: true,
      actionLabel: "Buy live credits",
      actionPath: "/credits",
      priority: 3,
      metric: { label: "Live", value: balance.toFixed(0) },
      secondaryMetric: { label: "Test", value: testBalance.toFixed(0) },
      goLiveStatus: getRequestStatus("credits_test"),
    },
    {
      id: "sms-notifications",
      label: "Twilio SMS",
      description: "Automated SMS alerts for your customers",
      isComplete: false,
      actionLabel: "Learn more",
      actionPath: "/settings?tab=notifications",
      priority: 20,
      comingSoon: true,
      icon: "twilio",
    },
    {
      id: "whatsapp-notifications",
      label: "WhatsApp Notifications",
      description: "Customer messaging via WhatsApp",
      isComplete: false,
      actionLabel: "Learn more",
      actionPath: "/settings?tab=notifications",
      priority: 21,
      comingSoon: true,
      icon: "whatsapp",
    },
    {
      id: "cmd-driver-verification",
      label: "CMD Driver Verification",
      description: "Automated driver licence & identity checks",
      isComplete: false,
      actionLabel: "Learn more",
      actionPath: "/settings?tab=integrations",
      priority: 22,
      comingSoon: true,
      icon: "cmd-driver",
    },
    {
      id: "cmd-insurance-verification",
      label: "CMD Insurance Verification",
      description: "Automated motor insurance validation",
      isComplete: false,
      actionLabel: "Learn more",
      actionPath: "/settings?tab=integrations",
      priority: 23,
      comingSoon: true,
      icon: "cmd-insurance",
    },
  ];

  const activeItems = checklist.filter((i) => !i.comingSoon);
  const completedCount = activeItems.filter((i) => i.isComplete).length;
  const checklistProgress = Math.round(
    (completedCount / activeItems.length) * 100
  );
  const allChecklistComplete = completedCount === activeItems.length;

  return {
    mode,
    trialDaysRemaining,
    trialEnd: subscription?.trial_end ?? null,
    wentLiveAt: td?.setup_completed_at ?? null,
    isSubscribed: !!isSubscribed,
    checklist,
    checklistProgress,
    allChecklistComplete,
    isLoading: setupLoading || extraLoading,
  };
}
