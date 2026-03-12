import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

interface GlobalBanner {
  enabled: boolean;
  message: string;
  type: "info" | "warning" | "critical";
}

interface MaintenanceBannerData {
  global: GlobalBanner | null;
  tenant: { enabled: boolean; message: string } | null;
  hasBanner: boolean;
}

export function useMaintenanceBanner(): MaintenanceBannerData & { isLoading: boolean } {
  const { tenant } = useTenant();

  const { data: globalBanner, isLoading } = useQuery({
    queryKey: ["maintenance-banner-global"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select(
          "maintenance_banner_enabled, maintenance_banner_message, maintenance_banner_type"
        )
        .eq("maintenance_banner_enabled", true)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        enabled: true,
        message: data.maintenance_banner_message,
        type: data.maintenance_banner_type as "info" | "warning" | "critical",
      };
    },
    staleTime: 30_000, // check every 30s
    refetchInterval: 60_000, // auto-refresh every 60s
  });

  const tenantBanner =
    tenant?.maintenance_banner_enabled
      ? {
          enabled: true,
          message:
            tenant.maintenance_banner_message ||
            "We are currently performing scheduled maintenance. Some features may be temporarily unavailable.",
        }
      : null;

  // Tenant-specific banner takes priority over global
  const activeBanner = tenantBanner
    ? { global: null, tenant: tenantBanner }
    : { global: globalBanner ?? null, tenant: null };

  return {
    ...activeBanner,
    hasBanner: !!(tenantBanner || globalBanner),
    isLoading,
  };
}
