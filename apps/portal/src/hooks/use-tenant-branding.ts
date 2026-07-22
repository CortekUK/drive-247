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

      // Keep the companion logo columns in step with logo_url.
      //
      // THE BUG THIS FIXES: onboarding stamps logo_url, dark_logo_url AND
      // auth_logo_url with the same uploaded image, but every UPDATE path only
      // ever wrote logo_url — no code anywhere in the product wrote the other
      // two. Meanwhile the readers PREFER them: the portal login page reads
      // auth_logo_url first, the sidebar reads dark_logo_url in dark mode, and
      // booking's header/footer read dark_logo_url unconditionally. So changing
      // your logo left most surfaces rendering the ORIGINAL image forever —
      // "it still shows the previous one". It is a stale column, not a cache,
      // which is why no refresh ever fixed it.
      //
      // Only columns that were still TRACKING logo_url (or were never set) get
      // updated. A tenant who deliberately uploaded a distinct dark-mode logo
      // keeps it — several live tenants have real ones, and blindly copying the
      // light logo over them would be a different, worse bug.
      const patch: Record<string, unknown> = { ...updates };

      if (Object.prototype.hasOwnProperty.call(patch, 'logo_url')) {
        // Read the current values fresh. The cached `branding` above has a 30s
        // staleTime and placeholderData, and deciding whether a column was
        // customised off a stale snapshot is exactly how real dark logos would
        // get clobbered.
        const { data: current, error: currentError } = await supabase
          .from('tenants')
          .select('logo_url, dark_logo_url, auth_logo_url')
          .eq('id', tenant.id)
          .single();

        const cur = (currentError ? null : current) as {
          logo_url?: string | null;
          dark_logo_url?: string | null;
          auth_logo_url?: string | null;
        } | null;

        // Skip the sync entirely if we could not read the current row. Without
        // this guard `cur` is null, every column looks "unset" to tracksLogo,
        // and we would happily overwrite a tenant's deliberate dark-mode logo
        // on the strength of a failed SELECT. Not syncing is always recoverable
        // (re-save the logo); destroying a custom asset is not.
        // A caller that echoes the CURRENT logo back (a passthrough on an
        // unrelated save) is not a logo change, so it must not touch the
        // companion columns. Without this, any bulk save that happens to carry
        // logo_url would drag dark/auth along with it — which is exactly how a
        // colours-only save could have wiped three columns instead of none.
        const logoUnchanged = cur ? patch.logo_url === cur.logo_url : false;

        if (cur && !logoUnchanged) {
          const nextLogo = patch.logo_url;
          const tracksLogo = (value: string | null | undefined) =>
            !value || value === cur.logo_url;

          // Never override a value the caller passed explicitly — a future
          // dark-logo uploader must win over this convenience sync.

          // dark_logo_url is cleared, NOT copied. Every reader resolves it as
          // `dark_logo_url || logo_url` (booking Navigation/Footer, brand-logo,
          // useSiteSettings), so NULL renders the identical image while leaving
          // exactly one source of truth. Copying the URL here would duplicate
          // state that has to be re-synced on every future save — which is the
          // very thing that produced this bug. A tenant with a real dark-mode
          // asset never reaches this branch (tracksLogo is false for them).
          if (
            !Object.prototype.hasOwnProperty.call(patch, 'dark_logo_url') &&
            tracksLogo(cur.dark_logo_url)
          ) {
            patch.dark_logo_url = null;
          }
          // auth_logo_url IS copied, deliberately unlike dark_logo_url above.
          // The login page does not merely fall back on it — it branches its
          // whole layout on it (login/page.tsx:313-320: a 256px logo on a black
          // panel when set, a smaller treatment when not). Clearing it would
          // silently restyle the first screen every staff member sees, so it
          // keeps tracking logo_url until someone deliberately changes that
          // design.
          if (
            !Object.prototype.hasOwnProperty.call(patch, 'auth_logo_url') &&
            tracksLogo(cur.auth_logo_url)
          ) {
            patch.auth_logo_url = nextLogo;
          }
        }
      }

      const { data, error } = await supabase
        .from('tenants')
        .update(patch)
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
