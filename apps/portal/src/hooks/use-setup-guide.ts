import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { useBonzahBalance } from "@/hooks/use-bonzah-balance";
import type { ExplainerId } from "@/lib/explainers";

export interface SetupGuideItem {
  id: string;
  label: string;
  isComplete: boolean;
  /** Where clicking the item sends the operator to finish it. */
  href: string;
  /**
   * The explainer for THIS task, rendered as a `Watch (m:ss)` control on the
   * row itself. This is the highest-value place a video can sit: the operator
   * is stuck on exactly this step at exactly this moment.
   *
   * Naming an id costs nothing before the video exists — `getExplainer()`
   * returns null for an unproduced entry and the slot renders nothing at all,
   * so every row below can point at its video today and light up the moment a
   * file lands in `lib/explainers.ts`.
   */
  explainerId?: ExplainerId;
}

export interface SetupGuideGroup {
  id: string;
  title: string;
  items: SetupGuideItem[];
  completedCount: number;
  isComplete: boolean;
}

export interface SetupGuideState {
  groups: SetupGuideGroup[];
  totalItems: number;
  completedItems: number;
  progressPercent: number;
  allComplete: boolean;
  /** True once every underlying read has resolved — see the note below. */
  isReady: boolean;
  /**
   * Whether the guide should occupy the dashboard's primary action slot. The
   * rule lives here so the page and the panel can never disagree about it and
   * leave the slot either empty or holding both controls at once.
   */
  isVisible: boolean;
  isLoading: boolean;
}

/**
 * The tenant's onboarding journey, grouped the way an operator actually walks
 * it: describe the business → build the fleet → take a TEST booking → get paid
 * → protect the rentals → go live.
 *
 * The test booking deliberately sits ABOVE the payment group. An operator gets
 * a working rental on screen before anyone asks them to connect a bank
 * account, so the first win never depends on the highest-friction step.
 *
 * This is the single source of truth for "how set up is this tenant". It
 * replaced three overlapping surfaces (the Setup Hub, the getting-started
 * card and the recurring reminder dialog) which each answered that question
 * differently — the Hub called a tenant 100% done at two items while the card
 * had them at 30% of ten.
 *
 * Completion rules for the integrations are reused from the hooks that already
 * own them (`use-setup-status` for Stripe, `use-bonzah-balance` for Bonzah)
 * rather than restated here, so the guide can never drift from Settings.
 *
 * TENANT ISOLATION: RLS is OFF on `vehicles`, `pickup_locations`, `cms_pages`
 * and `rentals` (V2_PLAN §5). Every count below goes through `head()`, which
 * pins `.eq('tenant_id', tid)` before anything else is chained on, and the
 * `tenants` read is keyed on the tenant's own primary key. The query is
 * `enabled` only once a tenant is resolved. Do not remove either.
 */
export function useSetupGuide(): SetupGuideState {
  const { tenant } = useTenant();
  const { isSubscribed } = useTenantSubscription();
  const { setupItems, isLoading: setupLoading } = useSetupStatus();
  const { hasOwnCredentials } = useBonzahBalance();

  const stripeComplete = !!setupItems.find((i) => i.id === "stripe-connect")
    ?.isComplete;

  const { data, isLoading, isSuccess } = useQuery({
    queryKey: ["setup-guide", tenant?.id],
    queryFn: async () => {
      const tid = tenant!.id;
      const head = (table: string) =>
        (supabase as any)
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tid);

      const [
        tenantRes,
        vehiclesRes,
        vehiclesWithPhotoRes,
        vehiclesPricedRes,
        locationsRes,
        pagesRes,
        rentalsRes,
        agreementsSentRes,
      ] = await Promise.all([
        (supabase as any)
          .from("tenants")
          .select(
            "logo_url, company_name, contact_email, contact_phone, phone, address, stripe_mode, security_deposit_enabled, global_deposit_amount, boldsign_test_brand_id, boldsign_live_brand_id, integration_veriff"
          )
          .eq("id", tid)
          .single(),
        head("vehicles"),
        // An empty string is not a photo — `is not null` alone would tick this
        // for every vehicle saved through a form that writes "" for untouched
        // optional fields.
        head("vehicles").not("photo_url", "is", null).neq("photo_url", ""),
        head("vehicles").gt("daily_rent", 0),
        head("pickup_locations").eq("is_active", true),
        head("cms_pages").eq("status", "published"),
        head("rentals"),
        // "Sent an agreement" = an e-sign envelope exists on a rental. That is
        // the moment the customer is actually asked to sign, which is what the
        // step is teaching — not `document_status`, which a rental can carry
        // before anything leaves the building.
        head("rentals").not("docusign_envelope_id", "is", null),
      ]);

      if (tenantRes.error) throw tenantRes.error;

      return {
        t: tenantRes.data as {
          logo_url: string | null;
          company_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          phone: string | null;
          address: string | null;
          stripe_mode: string | null;
          security_deposit_enabled: boolean | null;
          global_deposit_amount: number | null;
          boldsign_test_brand_id: string | null;
          boldsign_live_brand_id: string | null;
          integration_veriff: boolean | null;
        },
        vehicleCount: (vehiclesRes.count as number | null) ?? 0,
        vehiclesWithPhoto: (vehiclesWithPhotoRes.count as number | null) ?? 0,
        vehiclesPriced: (vehiclesPricedRes.count as number | null) ?? 0,
        locationCount: (locationsRes.count as number | null) ?? 0,
        publishedPages: (pagesRes.count as number | null) ?? 0,
        rentalCount: (rentalsRes.count as number | null) ?? 0,
        agreementsSent: (agreementsSentRes.count as number | null) ?? 0,
      };
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
  });

  const t = data?.t;

  const hasBusinessDetails =
    !!t?.company_name &&
    !!t?.contact_email &&
    !!(t?.contact_phone || t?.phone) &&
    !!t?.address;

  // Turning deposits OFF is a deliberate decision, not an unfinished task —
  // an operator who does not take deposits must still be able to reach 100%.
  const hasDepositPolicy =
    t?.security_deposit_enabled === false || (t?.global_deposit_amount ?? 0) > 0;

  const hasEsignBrand =
    !!t?.boldsign_test_brand_id || !!t?.boldsign_live_brand_id;

  const rawGroups: Array<Omit<SetupGuideGroup, "completedCount" | "isComplete">> =
    [
      {
        id: "business",
        title: "Tell us about your business",
        items: [
          {
            id: "logo",
            label: "Add your logo",
            isComplete: !!t?.logo_url,
            href: "/settings?tab=branding",
            explainerId: "business.logo",
          },
          {
            id: "details",
            label: "Business name, contact and address",
            isComplete: hasBusinessDetails,
            href: "/settings?tab=general",
            explainerId: "business.details",
          },
          {
            id: "location",
            label: "Add a pickup location",
            isComplete: (data?.locationCount ?? 0) > 0,
            href: "/settings?tab=locations",
            explainerId: "business.location",
          },
          {
            id: "site",
            label: "Publish your booking site",
            isComplete: (data?.publishedPages ?? 0) > 0,
            href: "/cms",
            explainerId: "business.site",
          },
        ],
      },
      {
        id: "fleet",
        title: "Build your fleet",
        items: [
          {
            id: "vehicle",
            label: "Add your first vehicle",
            isComplete: (data?.vehicleCount ?? 0) > 0,
            href: "/vehicles",
            explainerId: "fleet.vehicle-add",
          },
          {
            id: "photos",
            label: "Add photos",
            isComplete: (data?.vehiclesWithPhoto ?? 0) > 0,
            href: "/vehicles",
            explainerId: "fleet.vehicle-photos",
          },
          {
            id: "rates",
            label: "Set your daily rates",
            isComplete: (data?.vehiclesPriced ?? 0) > 0,
            href: "/vehicles",
            explainerId: "fleet.vehicle-rates",
          },
        ],
      },
      {
        id: "test-booking",
        title: "Take a test booking",
        items: [
          {
            id: "first-rental",
            label: "Create your first rental",
            isComplete: (data?.rentalCount ?? 0) > 0,
            href: "/rentals/new",
            explainerId: "rentals.first-rental",
          },
          // The guide carries the feature discovery the 3-stop tour
          // deliberately drops. E-signing is the step that most often surprises
          // a new operator — it exists, it is built in, and they never find it
          // because nothing on the rental screen insists. An unfinished item
          // here is a standing invitation, which is the whole design intent.
          //
          // Sits under "Take a test booking" rather than "Protect your
          // rentals" because it is the second half of one action: you cannot
          // send an agreement without a rental to send it against, and the
          // guide should read in the order the operator actually walks it.
          {
            id: "first-agreement",
            label: "Send your first agreement",
            isComplete: (data?.agreementsSent ?? 0) > 0,
            href: "/rentals",
            explainerId: "agreements.first-agreement",
          },
        ],
      },
      {
        id: "payments",
        title: "Get paid",
        items: [
          {
            id: "stripe",
            label: "Connect your Stripe account",
            isComplete: stripeComplete,
            href: "/settings?tab=payments",
            explainerId: "payments.stripe-connect",
          },
          {
            id: "deposit",
            label: "Set your security deposit",
            isComplete: hasDepositPolicy,
            href: "/settings?tab=payments",
            explainerId: "payments.deposit",
          },
        ],
      },
      {
        id: "protect",
        title: "Protect your rentals",
        items: [
          {
            id: "bonzah",
            label: "Turn on Bonzah insurance",
            isComplete: hasOwnCredentials,
            href: "/settings?tab=insurance",
            explainerId: "insurance.bonzah",
          },
          {
            id: "esign",
            label: "Brand your e-sign agreements",
            isComplete: hasEsignBrand,
            href: "/settings?tab=esign",
            explainerId: "agreements.esign-brand",
          },
          {
            id: "verification",
            label: "Turn on driver verification",
            isComplete: !!t?.integration_veriff,
            href: "/settings?tab=requirements",
            explainerId: "verification.driver",
          },
        ],
      },
      {
        id: "go-live",
        title: "Go live",
        items: [
          {
            id: "subscription",
            label: "Activate your subscription",
            isComplete: !!isSubscribed,
            href: "/settings?tab=subscription",
            explainerId: "billing.subscription",
          },
          {
            id: "live-mode",
            label: "Switch to live payments",
            isComplete: t?.stripe_mode === "live",
            href: "/settings?tab=payments",
            explainerId: "payments.go-live",
          },
        ],
      },
    ];

  const groups: SetupGuideGroup[] = rawGroups.map((g) => {
    const completedCount = g.items.filter((i) => i.isComplete).length;
    return {
      ...g,
      completedCount,
      isComplete: completedCount === g.items.length,
    };
  });

  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const completedItems = groups.reduce((n, g) => n + g.completedCount, 0);
  const allComplete = totalItems > 0 && completedItems === totalItems;
  // Gate the UI on a SUCCESSFUL read, not on `!isLoading`. An errored query
  // leaves every field undefined, which reads as "nothing is set up" — that
  // would show a fully-configured operator a 0% guide in place of their New
  // Rental button.
  const isReady = isSuccess;

  return {
    groups,
    totalItems,
    completedItems,
    progressPercent: totalItems
      ? Math.round((completedItems / totalItems) * 100)
      : 0,
    allComplete,
    isReady,
    isVisible: isReady && !allComplete,
    isLoading: isLoading || setupLoading,
  };
}
