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

const DEFAULT_BRANDING: TenantBranding = {
  app_name: 'Drive 917',
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
      return { ...DEFAULT_BRANDING, ...data } as TenantBranding;
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: DEFAULT_BRANDING,
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
      return { ...DEFAULT_BRANDING, ...data[0] } as TenantBranding;
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

  // Build immediate branding from tenant while query runs
  // This prevents flash of default "Drive 917" branding
  const immediateFromTenant: TenantBranding = tenant ? {
    app_name: tenant.app_name || tenant.company_name || DEFAULT_BRANDING.app_name,
    primary_color: tenant.primary_color || DEFAULT_BRANDING.primary_color,
    secondary_color: tenant.secondary_color || DEFAULT_BRANDING.secondary_color,
    accent_color: tenant.accent_color || DEFAULT_BRANDING.accent_color,
    light_primary_color: tenant.light_primary_color,
    light_secondary_color: tenant.light_secondary_color,
    light_accent_color: tenant.light_accent_color,
    light_background_color: tenant.light_background_color,
    dark_primary_color: tenant.dark_primary_color,
    dark_secondary_color: tenant.dark_secondary_color,
    dark_accent_color: tenant.dark_accent_color,
    dark_background_color: tenant.dark_background_color,
    light_header_footer_color: tenant.light_header_footer_color,
    dark_header_footer_color: tenant.dark_header_footer_color,
    logo_url: tenant.logo_url,
    dark_logo_url: tenant.dark_logo_url,
    favicon_url: tenant.favicon_url,
    hero_background_url: tenant.hero_background_url,
    meta_title: tenant.meta_title,
    meta_description: tenant.meta_description,
    og_image_url: tenant.og_image_url,
    phone: tenant.phone,
    address: tenant.address,
    business_hours: tenant.business_hours,
    google_maps_url: tenant.google_maps_url,
    facebook_url: tenant.facebook_url,
    instagram_url: tenant.instagram_url,
    twitter_url: tenant.twitter_url,
    linkedin_url: tenant.linkedin_url,
  } : DEFAULT_BRANDING;

  return {
    branding: branding || immediateFromTenant,
    isLoading,
    error,
    refetch,
    updateBranding: updateBrandingMutation.mutateAsync,
    isUpdating: updateBrandingMutation.isPending,
    tenantId: tenant?.id,
  };
};
