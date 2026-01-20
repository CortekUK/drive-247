'use client';

import { useTenant } from "@/contexts/TenantContext";

export interface BrandingSettings {
  // Base colors
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  // Light theme colors
  light_primary_color: string | null;
  light_secondary_color: string | null;
  light_accent_color: string | null;
  light_background_color: string | null;
  // Dark theme colors
  dark_primary_color: string | null;
  dark_secondary_color: string | null;
  dark_accent_color: string | null;
  dark_background_color: string | null;
  // Header/Footer colors
  light_header_footer_color: string | null;
  dark_header_footer_color: string | null;
  // Logo & branding
  logo_url: string | null;
  favicon_url: string | null;
  app_name: string;
  hero_background_url: string | null;
  // SEO fields
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
}

const DEFAULT_BRANDING: BrandingSettings = {
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
  favicon_url: null,
  app_name: 'Drive 247',
  hero_background_url: null,
  meta_title: null,
  meta_description: null,
  og_image_url: null,
};

/**
 * Hook to get branding settings for the current tenant
 *
 * This hook reads branding directly from the TenantContext, which fetches
 * tenant-specific branding from the tenants table based on the subdomain.
 *
 * For the main domain (no subdomain), default branding is returned.
 */
export const useBrandingSettings = () => {
  const { tenant, loading, error } = useTenant();

  // If we have a tenant, use their branding; otherwise use defaults
  const branding: BrandingSettings = tenant ? {
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
    favicon_url: tenant.favicon_url,
    app_name: tenant.app_name || tenant.company_name || DEFAULT_BRANDING.app_name,
    hero_background_url: tenant.hero_background_url,
    meta_title: tenant.meta_title,
    meta_description: tenant.meta_description,
    og_image_url: tenant.og_image_url,
  } : DEFAULT_BRANDING;

  return {
    branding,
    isLoading: loading,
    error: error ? new Error(error) : null,
  };
};

export default useBrandingSettings;
