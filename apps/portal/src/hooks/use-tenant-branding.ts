import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface TenantBranding {
  // Branding
  app_name: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  light_primary_color: string | null;
  light_secondary_color: string | null;
  light_accent_color: string | null;
  light_background_color: string | null;
  dark_primary_color: string | null;
  dark_secondary_color: string | null;
  dark_accent_color: string | null;
  dark_background_color: string | null;
  light_header_footer_color: string | null;
  dark_header_footer_color: string | null;
  logo_url: string | null;
  dark_logo_url: string | null;
  auth_logo_url: string | null;
  favicon_url: string | null;
  hero_background_url: string | null;
  // SEO
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  // Contact info
  phone: string | null;
  address: string | null;
  business_hours: string | null;
  google_maps_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
}

/**
 * The platform's own brand string that `tenants.app_name` used to default to.
 * Treated as "unset" so it is never rendered as a tenant's own brand.
 */
const PLATFORM_DEFAULT_APP_NAME = 'Drive 917';

/**
 * Platform-neutral defaults. `app_name` is intentionally null — the display name
 * is always resolved from the tenant itself (app_name → company_name) so a tenant
 * that never set an app name never sees the platform's own brand in their portal.
 */
const DEFAULT_BRANDING: TenantBranding = {
  app_name: null,
  primary_color: '#223331',
  secondary_color: '#223331',
  accent_color: '#E9B63E',
  light_primary_color: null,
  light_secondary_color: null,
  light_accent_color: null,
  light_background_color: null,
  dark_primary_color: null,
  dark_secondary_color: null,
  dark_accent_color: null,
  dark_background_color: null,
  light_header_footer_color: null,
  dark_header_footer_color: null,
  logo_url: null,
  dark_logo_url: null,
  auth_logo_url: null,
  favicon_url: null,
  hero_background_url: null,
  meta_title: null,
  meta_description: null,
  og_image_url: null,
  phone: null,
  address: null,
  business_hours: null,
  google_maps_url: null,
  facebook_url: null,
  instagram_url: null,
  twitter_url: null,
  linkedin_url: null,
};

/**
 * Hook to manage tenant-specific branding settings
 *
 * This hook reads and writes branding to the `tenants` table,
 * enabling per-tenant customization for multi-tenant deployments.
 */
export const useTenantBranding = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // The tenant's own display name — never the platform default.
  // `tenants.app_name` is optional (never set for tenants provisioned without one),
  // so we fall back to the company name the tenant was created with.
  const tenantAny = tenant as (typeof tenant & Partial<TenantBranding>) | null;
  const resolveAppName = (appName?: string | null): string | null => {
    const trimmed = appName?.trim();
    // Belt-and-braces: `tenants.app_name` used to carry the platform default
    // 'Drive 917' as a column default. The default was dropped and every row
    // backfilled, but treat the literal as "unset" so a stale/reintroduced value
    // can never be rendered as a tenant's own brand.
    const own = trimmed && trimmed !== PLATFORM_DEFAULT_APP_NAME ? trimmed : null;
    return own || tenant?.company_name?.trim() || null;
  };

  // Build immediate branding from tenant while the query runs.
  // This prevents a flash of platform-default branding.
  const immediateFromTenant: TenantBranding = tenant ? {
    app_name: resolveAppName(tenantAny?.app_name),
    primary_color: tenantAny?.primary_color || DEFAULT_BRANDING.primary_color,
    secondary_color: tenantAny?.secondary_color || DEFAULT_BRANDING.secondary_color,
    accent_color: tenantAny?.accent_color || DEFAULT_BRANDING.accent_color,
    light_primary_color: tenantAny?.light_primary_color ?? null,
    light_secondary_color: tenantAny?.light_secondary_color ?? null,
    light_accent_color: tenantAny?.light_accent_color ?? null,
    light_background_color: tenantAny?.light_background_color ?? null,
    dark_primary_color: tenantAny?.dark_primary_color ?? null,
    dark_secondary_color: tenantAny?.dark_secondary_color ?? null,
    dark_accent_color: tenantAny?.dark_accent_color ?? null,
    dark_background_color: tenantAny?.dark_background_color ?? null,
    light_header_footer_color: tenantAny?.light_header_footer_color ?? null,
    dark_header_footer_color: tenantAny?.dark_header_footer_color ?? null,
    logo_url: tenantAny?.logo_url ?? null,
    dark_logo_url: tenantAny?.dark_logo_url ?? null,
    auth_logo_url: tenantAny?.auth_logo_url ?? null,
    favicon_url: tenantAny?.favicon_url ?? null,
    hero_background_url: tenantAny?.hero_background_url ?? null,
    meta_title: tenantAny?.meta_title ?? null,
    meta_description: tenantAny?.meta_description ?? null,
    og_image_url: tenantAny?.og_image_url ?? null,
    phone: tenantAny?.phone ?? null,
    address: tenantAny?.address ?? null,
    business_hours: tenantAny?.business_hours ?? null,
    google_maps_url: tenantAny?.google_maps_url ?? null,
    facebook_url: tenantAny?.facebook_url ?? null,
    instagram_url: tenantAny?.instagram_url ?? null,
    twitter_url: tenantAny?.twitter_url ?? null,
    linkedin_url: tenantAny?.linkedin_url ?? null,
  } : DEFAULT_BRANDING;

  // Fetch branding from tenants table
  const {
    data: branding,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['tenant-branding', tenant?.id],
    queryFn: async (): Promise<TenantBranding> => {
      if (!tenant?.id) {
        console.log('[TenantBranding] No tenant ID, returning defaults');
        return DEFAULT_BRANDING;
      }

      console.log(`[TenantBranding] Fetching branding for tenant: ${tenant.id}`);

      const { data, error } = await supabase
        .from('tenants')
        .select(`
          app_name,
          primary_color,
          secondary_color,
          accent_color,
          light_primary_color,
          light_secondary_color,
          light_accent_color,
          light_background_color,
          dark_primary_color,
          dark_secondary_color,
          dark_accent_color,
          dark_background_color,
          light_header_footer_color,
          dark_header_footer_color,
          logo_url,
          dark_logo_url,
          auth_logo_url,
          favicon_url,
          hero_background_url,
          meta_title,
          meta_description,
          og_image_url,
          phone,
          address,
          business_hours,
          google_maps_url,
          facebook_url,
          instagram_url,
          twitter_url,
          linkedin_url
        `)
        .eq('id', tenant.id)
        .single();

      if (error) {
        console.error('[TenantBranding] Error fetching branding:', error);
        throw error;
      }

      console.log('[TenantBranding] Branding loaded:', data);
      const merged = { ...DEFAULT_BRANDING, ...data } as TenantBranding;
      return { ...merged, app_name: resolveAppName(merged.app_name) };
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: immediateFromTenant,
  });

  // Update branding mutation
  const updateBrandingMutation = useMutation({
    mutationFn: async (updates: Partial<TenantBranding>): Promise<TenantBranding> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      console.log(`[TenantBranding] Updating branding for tenant ${tenant.id}:`, updates);

      const { data, error } = await supabase
        .from('tenants')
        .update(updates)
        .eq('id', tenant.id)
        .select(`
          app_name,
          primary_color,
          secondary_color,
          accent_color,
          light_primary_color,
          light_secondary_color,
          light_accent_color,
          light_background_color,
          dark_primary_color,
          dark_secondary_color,
          dark_accent_color,
          dark_background_color,
          light_header_footer_color,
          dark_header_footer_color,
          logo_url,
          dark_logo_url,
          auth_logo_url,
          favicon_url,
          hero_background_url,
          meta_title,
          meta_description,
          og_image_url,
          phone,
          address,
          business_hours,
          google_maps_url,
          facebook_url,
          instagram_url,
          twitter_url,
          linkedin_url
        `);

      if (error) {
        console.error('[TenantBranding] Update error:', error);
        throw error;
      }

      // Handle case where no rows were updated (shouldn't happen but be defensive)
      if (!data || data.length === 0) {
        console.warn('[TenantBranding] No rows updated, tenant may not exist');
        throw new Error('Tenant not found or no permission to update');
      }

      console.log('[TenantBranding] Branding updated:', data[0]);
      const merged = { ...DEFAULT_BRANDING, ...data[0] } as TenantBranding;
      return { ...merged, app_name: resolveAppName(merged.app_name) };
    },
    onSuccess: (data) => {
      // Update the cache with new data
      queryClient.setQueryData(['tenant-branding', tenant?.id], data);

      toast({
        title: "Branding Updated",
        description: "Your branding settings have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      console.error('[TenantBranding] Update error:', error);
      toast({
        title: "Error",
        description: `Failed to update branding: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const resolvedBranding = branding || immediateFromTenant;

  return {
    branding: resolvedBranding,
    // Display name to render anywhere the tenant's brand is shown (sidebar, login,
    // invoices). Always the tenant's own name — falls back to a neutral label, never
    // to the platform's brand.
    brandName: resolvedBranding.app_name || tenant?.company_name || 'Portal',
    isLoading,
    error,
    refetch,
    updateBranding: updateBrandingMutation.mutateAsync,
    isUpdating: updateBrandingMutation.isPending,
    tenantId: tenant?.id,
  };
};
