import { useTenant } from "@/contexts/TenantContext";
import { useCustomSiteEnabled } from "@/hooks/use-custom-site";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useIsLean } from "@/lib/lean-context";
import { isV2 } from "@/lib/v2";
import { useV2 } from "@/lib/v2-context";
import type { DestinationContext } from "@/lib/search/portal-destinations";
import { useAuthStore } from "@/stores/auth-store";
import { isIntegrationBillingTenant } from "@/lib/integration-billing/gate";

/**
 * What the global search needs to know to offer only the places this user can
 * open — read from the same hooks the sidebars read (app-sidebar.tsx,
 * app-sidebar-v2.tsx), so the answers cannot differ. Every hook here is already
 * mounted by the sidebar, so its data comes from the shared query cache.
 */
export function usePortalDestinationContext(): DestinationContext {
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const { canAccessRoute, canViewSettings } = useManagerPermissions();
  const lean = useIsLean();
  const v2Chrome = useV2("chrome");
  const integrationsBoard = useV2("appearance");
  const turoV2 = useV2("turo") || isV2("turo", tenant?.slug);
  const { settings: rentalSettings } = useRentalSettings();
  const { settings: orgSettings } = useOrgSettings();
  const customSite = useCustomSiteEnabled();

  const t = tenant as {
    lead_management_enabled?: boolean;
    automations_enabled?: boolean;
    vehicle_owners_enabled?: boolean;
    turo_bridge_enabled?: boolean;
  } | null;

  const fleetHealth = (rentalSettings as unknown as { fleet_health_enabled?: boolean } | undefined)?.fleet_health_enabled === true;
  const paymentModeManual = (orgSettings as { payment_mode?: string } | undefined)?.payment_mode === "manual";

  return {
    v2Chrome,
    integrationsBoard,
    lean,
    creditsRetired: isIntegrationBillingTenant(tenant?.slug),
    isHeadAdmin: appUser?.role === "head_admin",
    flags: {
      lead_management_enabled: t?.lead_management_enabled === true,
      automations_enabled: t?.automations_enabled === true,
      vehicle_owners_enabled: t?.vehicle_owners_enabled === true,
      fleet_health_enabled: fleetHealth,
      turo_sync_enabled: turoV2 && t?.turo_bridge_enabled === true,
      pending_bookings: paymentModeManual,
      custom_site_enabled: customSite.enabled,
    },
    canAccessRoute,
    canViewSettings,
  };
}
