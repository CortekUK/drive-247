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
  dark_logo_url: string | null;
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
  distance_unit: 'km' | 'miles' | null;
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
  pickup_location_mode: 'fixed' | 'custom' | 'multiple' | 'area_around' | null;
  return_location_mode: 'fixed' | 'custom' | 'multiple' | 'area_around' | null;
  fixed_pickup_address: string | null;
  fixed_return_address: string | null;
  pickup_area_radius_km: number | null;
  return_area_radius_km: number | null;
  area_center_lat: number | null;
  area_center_lon: number | null;

  // Integration settings
  integration_veriff: boolean | null;
  integration_bonzah: boolean | null;

  // Tax settings
  tax_enabled: boolean | null;
  tax_percentage: number | null;

  // Service fee settings
  service_fee_enabled: boolean | null;
  service_fee_amount: number | null;

  // Deposit settings
  deposit_mode: 'global' | 'per_vehicle' | null;
  global_deposit_amount: number | null;

  // Working hours settings
  working_hours_enabled: boolean | null;
  working_hours_open: string | null;
  working_hours_close: string | null;
  working_hours_always_open: boolean | null;

  // Per-day working hours
  monday_enabled: boolean | null;
  monday_open: string | null;
  monday_close: string | null;
  tuesday_enabled: boolean | null;
  tuesday_open: string | null;
  tuesday_close: string | null;
  wednesday_enabled: boolean | null;
  wednesday_open: string | null;
  wednesday_close: string | null;
  thursday_enabled: boolean | null;
  thursday_open: string | null;
  thursday_close: string | null;
  friday_enabled: boolean | null;
  friday_open: string | null;
  friday_close: string | null;
  saturday_enabled: boolean | null;
  saturday_open: string | null;
  saturday_close: string | null;
  sunday_enabled: boolean | null;
  sunday_open: string | null;
  sunday_close: string | null;

  // Delivery & Collection settings (legacy)
  delivery_enabled: boolean | null;
  collection_enabled: boolean | null;

  // New simplified location options (legacy combined flags)
  fixed_address_enabled: boolean | null;
  multiple_locations_enabled: boolean | null;
  area_around_enabled: boolean | null;
  area_delivery_fee: number | null;

  // Separate pickup/return location settings
  pickup_fixed_enabled: boolean | null;
  return_fixed_enabled: boolean | null;
  pickup_multiple_locations_enabled: boolean | null;
  return_multiple_locations_enabled: boolean | null;
  pickup_area_enabled: boolean | null;
  return_area_enabled: boolean | null;

  // Installment settings
  installments_enabled: boolean | null;
  installment_config: Record<string, any> | null;

  // Lockbox settings
  lockbox_enabled: boolean | null;
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

  // Set up real-time subscription to listen for tenant updates
  useEffect(() => {
    if (!tenant?.id) return;

    console.log(`[TenantContext] Setting up real-time subscription for tenant: ${tenant.id}`);

    const channel = supabase
      .channel(`tenant-${tenant.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tenants',
          filter: `id=eq.${tenant.id}`,
        },
        (payload) => {
          console.log('[TenantContext] Tenant data updated via real-time:', payload.new);
          // Update the tenant state with the new data
          setTenant(payload.new as Tenant);
        }
      )
      .subscribe((status) => {
        console.log(`[TenantContext] Real-time subscription status: ${status}`);
      });

    // Cleanup subscription on unmount or when tenant changes
    return () => {
      console.log('[TenantContext] Cleaning up real-time subscription');
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

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
                logo_url, dark_logo_url, favicon_url, hero_background_url,
                meta_title, meta_description, og_image_url,
                phone, address, business_hours, google_maps_url,
                facebook_url, instagram_url, twitter_url, linkedin_url,
                currency_code, distance_unit, timezone, date_format,
                min_rental_days, max_rental_days, booking_lead_time_hours, minimum_rental_age,
                require_identity_verification, require_insurance_upload, payment_mode,
                pickup_location_mode, return_location_mode, fixed_pickup_address, fixed_return_address,
                pickup_area_radius_km, return_area_radius_km, area_center_lat, area_center_lon,
                integration_veriff, integration_bonzah,
                tax_enabled, tax_percentage,
                service_fee_enabled, service_fee_amount,
                deposit_mode, global_deposit_amount,
                working_hours_enabled, working_hours_open, working_hours_close, working_hours_always_open,
                monday_enabled, monday_open, monday_close,
                tuesday_enabled, tuesday_open, tuesday_close,
                wednesday_enabled, wednesday_open, wednesday_close,
                thursday_enabled, thursday_open, thursday_close,
                friday_enabled, friday_open, friday_close,
                saturday_enabled, saturday_open, saturday_close,
                sunday_enabled, sunday_open, sunday_close,
                delivery_enabled, collection_enabled,
                fixed_address_enabled, multiple_locations_enabled, area_around_enabled, area_delivery_fee,
                pickup_fixed_enabled, return_fixed_enabled,
                pickup_multiple_locations_enabled, return_multiple_locations_enabled,
                pickup_area_enabled, return_area_enabled,
                installments_enabled, installment_config,
                lockbox_enabled
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
          pickup_area_radius_km,
          return_area_radius_km,
          area_center_lat,
          area_center_lon,
          integration_veriff,
          integration_bonzah,
          tax_enabled,
          tax_percentage,
          service_fee_enabled,
          service_fee_amount,
          deposit_mode,
          global_deposit_amount,
          working_hours_enabled,
          working_hours_open,
          working_hours_close,
          working_hours_always_open,
          monday_enabled,
          monday_open,
          monday_close,
          tuesday_enabled,
          tuesday_open,
          tuesday_close,
          wednesday_enabled,
          wednesday_open,
          wednesday_close,
          thursday_enabled,
          thursday_open,
          thursday_close,
          friday_enabled,
          friday_open,
          friday_close,
          saturday_enabled,
          saturday_open,
          saturday_close,
          sunday_enabled,
          sunday_open,
          sunday_close,
          delivery_enabled,
          collection_enabled,
          fixed_address_enabled,
          multiple_locations_enabled,
          area_around_enabled,
          area_delivery_fee,
          pickup_fixed_enabled,
          return_fixed_enabled,
          pickup_multiple_locations_enabled,
          return_multiple_locations_enabled,
          pickup_area_enabled,
          return_area_enabled,
          installments_enabled,
          installment_config,
          lockbox_enabled
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
