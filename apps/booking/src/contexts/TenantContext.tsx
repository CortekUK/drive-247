'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Tenant interface representing a rental company on the platform
 * Includes all branding, settings, and configuration for the tenant
 */
export interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  status: string;
  contact_email: string | null;
  contact_phone: string | null;

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
  favicon_url: string | null;
  hero_background_url: string | null;

  // SEO
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;

  // Site settings
  phone: string | null;
  address: string | null;
  business_hours: string | null;
  google_maps_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;

  // Operational settings
  currency_code: string | null;
  timezone: string | null;
  date_format: string | null;
  min_rental_days: number | null;
  max_rental_days: number | null;
  booking_lead_time_hours: number | null;
  minimum_rental_age: number | null;
  require_identity_verification: boolean | null;
  require_insurance_upload: boolean | null;
  payment_mode: string | null;

  // Location settings
  pickup_location_mode: 'fixed' | 'custom' | 'multiple' | null;
  return_location_mode: 'fixed' | 'custom' | 'multiple' | null;
  fixed_pickup_address: string | null;
  fixed_return_address: string | null;

  // Integration settings
  integration_veriff: boolean | null;

  // Tax settings
  tax_enabled: boolean | null;
  tax_percentage: number | null;

  // Service fee settings
  service_fee_enabled: boolean | null;
  service_fee_amount: number | null;

  // Deposit settings
  deposit_mode: 'global' | 'per_vehicle' | null;
  global_deposit_amount: number | null;
}

interface TenantContextType {
  tenant: Tenant | null;
  loading: boolean;
  error: string | null;
  tenantSlug: string | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

/**
 * Extract subdomain from hostname
 * Examples:
 * - "acme.localhost:3000" -> "acme"
 * - "acme.drive-247.com" -> "acme"
 * - "localhost:3000" -> null
 * - "drive-247.com" -> null
 * - "www.drive-247.com" -> null
 */
function extractSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0];
  const parts = host.split('.');

  // Handle localhost: "acme.localhost" -> "acme"
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
    const subdomain = parts[0];
    if (subdomain === 'localhost') {
      return null;
    }
    return subdomain;
  }

  // Handle production: "acme.drive-247.com" -> "acme"
  // Must have at least 3 parts (subdomain.domain.tld)
  // Exclude reserved subdomains that have their own Vercel projects
  const reservedSubdomains = ['www', 'admin', 'portal', 'api', 'app'];
  if (parts.length >= 3) {
    const subdomain = parts[0];
    if (reservedSubdomains.includes(subdomain)) {
      return null;
    }
    return subdomain;
  }

  return null;
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  useEffect(() => {
    loadTenant();
  }, []);

  const loadTenant = async () => {
    try {
      // Only run on client side
      if (typeof window === 'undefined') {
        setLoading(false);
        return;
      }

      // Extract subdomain from current URL
      const hostname = window.location.hostname;
      const slug = extractSubdomain(hostname);
      setTenantSlug(slug);

      // If no subdomain, this is the main domain
      if (!slug) {
        // In development, try to load a default tenant for easier testing
        if (process.env.NODE_ENV === 'development') {
          console.log('[TenantContext] No subdomain detected in development, checking for NEXT_PUBLIC_DEFAULT_TENANT_SLUG');

          // Check for default tenant slug from env or use 'test' as fallback
          const defaultSlug = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG;

          if (defaultSlug) {
            console.log(`[TenantContext] Using default tenant slug: ${defaultSlug}`);
            // Query the default tenant
            const { data: defaultTenant, error: defaultError } = await supabase
              .from('tenants')
              .select(`
                id, slug, company_name, status, contact_email, contact_phone,
                app_name, primary_color, secondary_color, accent_color,
                light_primary_color, light_secondary_color, light_accent_color, light_background_color,
                dark_primary_color, dark_secondary_color, dark_accent_color, dark_background_color,
                light_header_footer_color, dark_header_footer_color,
                logo_url, favicon_url, hero_background_url,
                meta_title, meta_description, og_image_url,
                phone, address, business_hours, google_maps_url,
                facebook_url, instagram_url, twitter_url, linkedin_url,
                currency_code, timezone, date_format,
                min_rental_days, max_rental_days, booking_lead_time_hours, minimum_rental_age,
                require_identity_verification, require_insurance_upload, payment_mode,
                pickup_location_mode, return_location_mode, fixed_pickup_address, fixed_return_address,
                integration_veriff,
                tax_enabled, tax_percentage,
                service_fee_enabled, service_fee_amount,
                deposit_mode, global_deposit_amount
              `)
              .eq('slug', defaultSlug)
              .eq('status', 'active')
              .single();

            if (defaultTenant && !defaultError) {
              console.log(`[TenantContext] Loaded default tenant: ${defaultTenant.company_name} (${defaultTenant.id})`);
              console.log('[TenantContext] tenant_id:', defaultTenant.id);
              setTenantSlug(defaultSlug);
              setTenant(defaultTenant as Tenant);
              setLoading(false);
              return;
            } else {
              console.warn('[TenantContext] Default tenant not found or inactive:', defaultError?.message);
            }
          }
        }

        console.log('[TenantContext] No subdomain detected, running without tenant context');
        console.log('[TenantContext] TIP: Access via subdomain (e.g., test.localhost:3000) or set NEXT_PUBLIC_DEFAULT_TENANT_SLUG in .env.local');
        setTenant(null);
        setLoading(false);
        return;
      }

      console.log(`[TenantContext] Loading tenant for slug: ${slug}`);

      // Query the tenants table by slug
      const { data, error: queryError } = await supabase
        .from('tenants')
        .select(`
          id,
          slug,
          company_name,
          status,
          contact_email,
          contact_phone,
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
          linkedin_url,
          currency_code,
          timezone,
          date_format,
          min_rental_days,
          max_rental_days,
          booking_lead_time_hours,
          minimum_rental_age,
          require_identity_verification,
          require_insurance_upload,
          payment_mode,
          pickup_location_mode,
          return_location_mode,
          fixed_pickup_address,
          fixed_return_address,
          integration_veriff,
          tax_enabled,
          tax_percentage,
          service_fee_enabled,
          service_fee_amount,
          deposit_mode,
          global_deposit_amount
        `)
        .eq('slug', slug)
        .eq('status', 'active')
        .single();

      if (queryError) {
        if (queryError.code === 'PGRST116') {
          // No tenant found with this slug
          console.warn(`[TenantContext] No active tenant found for slug: ${slug}`);
          setError(`Tenant "${slug}" not found or inactive`);
        } else {
          console.error('[TenantContext] Error loading tenant:', queryError);
          setError(queryError.message);
        }
        setTenant(null);
        setLoading(false);
        return;
      }

      console.log(`[TenantContext] Loaded tenant: ${data.company_name} (${data.id})`);
      console.log('[TenantContext] tenant_id:', data.id);
      setTenant(data as Tenant);
      setError(null);
    } catch (err) {
      console.error('[TenantContext] Unexpected error:', err);
      setError('Failed to load tenant configuration');
      setTenant(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TenantContext.Provider value={{ tenant, loading, error, tenantSlug }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);

  // Return safe defaults during SSR or when provider is not mounted
  // This prevents errors during Next.js server-side rendering
  if (context === undefined) {
    return {
      tenant: null,
      loading: false,
      error: null,
      tenantSlug: null
    };
  }

  return context;
}
