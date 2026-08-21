import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { useBonzahBalance, getBonzahPortalUrl } from "@/hooks/use-bonzah-balance";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
import { useGoLiveRequests } from "@/hooks/use-go-live-request";
import { useInshur } from "@/hooks/use-inshur";
import { useInshurFleetEligibility } from "@/hooks/use-inshur-eligibility";
import { useInshurActiveCoverageCount } from "@/hooks/use-inshur-coverage";
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
  const {
    mode: inshurMode,
    enabled: inshurEnabled,
    hasCredentials: inshurHasCredentials,
    configState: inshurConfigState,
    simulatedWhileStripeLive,
  } = useInshur();
  const inshurFleet = useInshurFleetEligibility();
  const { activeCount: inshurActiveCover } = useInshurActiveCoverageCount();

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
            "logo_url, boldsign_mode, boldsign_test_brand_id, boldsign_live_brand_id, integration_twilio_sms, integration_whatsapp, twilio_phone_number, meta_whatsapp_phone_number, integration_veriff, stripe_mode, subscription_stripe_mode, setup_completed_at"
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
          subscription_stripe_mode: "test" | "live" | null;
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

  // --- INSHUR Period Z ---
  // `enabled` is null while the config read is in flight or has failed; the
  // TenantContext copy of the same flag is the fallback so a slow settings read
  // does not demote a configured tenant to the "coming soon" row.
  const inshurOn = inshurEnabled ?? tenant?.integration_inshur === true;
  const inshurConfigUnknown = inshurConfigState === "unknown";
  const inshurCredsComplete = inshurHasCredentials === true;

  // Every branch keeps "could not determine" separate from "zero". A fleet
  // whose eligibility could not be read must never render as "0 of 0 eligible",
  // which reads as a fleet problem and sends the operator to ABI to fix nothing.
  const inshurFleetValue = inshurFleet.isLoading
    ? "—"
    : inshurFleet.total == null
      ? "Unavailable"
      : `${inshurFleet.eligible} of ${inshurFleet.total}`;

  // Most urgent first. Only one warning fits in the metric row.
  const inshurWarning: { warning?: string; warningUrl?: string } = (() => {
    // The Bonzah failure shape exactly: real money, simulated cover.
    if (simulatedWhileStripeLive === true) {
      return {
        warning: "Cover is simulated while Stripe is live",
        warningUrl: "/settings?tab=insurance",
      };
    }
    if (inshurConfigUnknown) {
      return {
        warning: "Could not read your INSHUR settings",
        warningUrl: "/settings?tab=insurance",
      };
    }
    if (!inshurFleet.isLoading && inshurFleet.total == null) {
      return { warning: "Fleet eligibility unavailable", warningUrl: "/vehicles" };
    }
    // Nothing eligible has two causes with two different fixes: vehicles ABI has
    // rejected, versus vehicles nobody has asked about yet.
    if (inshurFleet.eligible === 0 && inshurFleet.ineligible > 0) {
      return { warning: "No vehicle is on Period X yet", warningUrl: "https://portal.abiweb.com" };
    }
    if (inshurFleet.eligible === 0 && inshurFleet.unchecked > 0) {
      return { warning: "No vehicle has been checked yet", warningUrl: "/vehicles" };
    }
    if (inshurFleet.noVin != null && inshurFleet.noVin > 0) {
      return {
        warning: `${inshurFleet.noVin} vehicle${inshurFleet.noVin === 1 ? "" : "s"} missing a VIN`,
        warningUrl: "/vehicles",
      };
    }
    return {};
  })();

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
        ? (td?.subscription_stripe_mode ?? "test")
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
          // Under Bonzah's agency-level balance the spendable figure IS the
          // broker wallet, so a zero sub-user allocation is normal and must not
          // be reported as a fault. See use-bonzah-balance for the details.
          ? (balanceNumber ?? 0) > 0
            ? "Connected · Accepting live insurance policies"
            : "Connected · Top up your Bonzah balance to issue policies"
          : "Connected · Set up your account to go live"
        : "Test mode · Set up your account to go live",
      isComplete: hasOwnCredentials,
      actionLabel: hasOwnCredentials ? "Manage" : "Set up",
      actionPath: "/settings?tab=insurance",
      priority: 5,
      integrationStatus: hasOwnCredentials
        ? bonzahMode === "live" ? "live" : "test"
        : "test",
      mode: bonzahMode as "test" | "live",
      // Show balance for the current mode — always visible (test mode works for everyone)
      metric: {
          // The spendable figure — the broker/agency wallet a policy draws on.
          label: bonzahMode === "live" ? "Available to issue policies" : "Bonzah balance",
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
    // A tenant without the integration gets the `comingSoon` variant, which is
    // excluded from the progress denominator — otherwise shipping INSHUR would
    // knock every other tenant's setup bar down on the day it lands.
    inshurOn
      ? {
          id: "inshur",
          label: "INSHUR Period Z",
          description: inshurConfigUnknown
            ? "Status unavailable · Could not read your INSHUR settings"
            : !inshurCredsComplete
              ? "Simulation mode · Add your ABI credentials to start writing cover"
              : inshurMode === "live"
                ? "Connected · Writing real per-rental cover"
                : inshurMode === "test"
                  ? "Connected · Test account — no renter is insured yet"
                  : "Simulation mode · Nothing reaches INSHUR",
          // Matches the Bonzah/Stripe semantics: complete means "credentials in
          // place". Live-vs-test is carried by the pill and the go-live request,
          // not by withholding the tick from an operator who has done their part.
          isComplete: inshurCredsComplete,
          actionLabel: inshurCredsComplete ? "Manage" : "Set up",
          // tab=insurance is BONZAH's panel. The INSHUR panel is tab=inshur —
          // the two live side by side in Settings and the names are one letter
          // apart, so this is an easy and silent mis-route.
          actionPath: "/settings?tab=inshur",
          priority: 7,
          integrationStatus: !inshurCredsComplete
            ? "not_configured"
            : inshurMode === "live"
              ? "live"
              : "test",
          statusLabel: inshurConfigUnknown
            ? "Unavailable"
            : !inshurCredsComplete
              ? "Not connected"
              : inshurMode === "live"
                ? "Live"
                : inshurMode === "test"
                  ? "Test account"
                  : "Simulated",
          // Simulation renders as TEST in this shared 9px pill rather than
          // inventing a third state in the renderer. The unmissable simulation
          // signalling lives on the INSHUR surfaces themselves.
          mode: inshurMode === "live" ? "live" : "test",
          metric: {
            label: "Insurable vehicles",
            value: inshurFleetValue,
            ...inshurWarning,
          },
          secondaryMetric: {
            label: "On cover now",
            value: inshurActiveCover == null ? "—" : String(inshurActiveCover),
          },
          secondaryActionLabel: "Vehicles",
          secondaryActionPath: "/vehicles",
          goLiveStatus: inshurCredsComplete ? getRequestStatus("inshur") : null,
        }
      : {
          id: "inshur",
          label: "INSHUR Period Z",
          description: "Per-rental liability cover for US fleets",
          isComplete: false,
          actionLabel: "Learn more",
          actionPath: "/settings?tab=inshur",
          priority: 24,
          comingSoon: true,
          icon: "inshur",
        },
    {
      id: "boldsign",
      label: "BoldSign E-Sign",
      description: td?.boldsign_mode === "live"
        ? "Connected · 7 credits per agreement"
        : "Connected · 7 credits per agreement (test mode)",
      isComplete: true,
      actionLabel: "Manage",
      actionPath: "/settings?tab=esign",
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
      actionPath: "/settings?tab=messaging",
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
      actionPath: "/settings?tab=messaging",
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
      actionPath: "/settings?tab=requirements",
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
      actionPath: "/settings?tab=insurance",
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
