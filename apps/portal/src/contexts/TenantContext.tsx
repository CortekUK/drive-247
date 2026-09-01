'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  status: string;
  contact_email: string;
  phone: string | null;
  admin_name: string | null;
  integration_bonzah: boolean | null;
  bonzah_brochure_url: string | null;
  bonzah_username: string | null;
  bonzah_mode: 'test' | 'live' | null;
  // Super-admin escape hatch: allows selling Bonzah while still in test mode.
  // Internal/demo tenants only — see isBonzahSellable() in lib/bonzah.ts.
  bonzah_sandbox_override: boolean | null;
  boldsign_mode: 'test' | 'live' | null;
  // The tenant's Stripe Connect mode — i.e. whether renters are being charged
  // real money. Not the same as subscription_stripe_mode, which is how the
  // tenant pays US. Loaded because several safety warnings compare it against
  // an integration's own mode, and those warnings silently never fired while
  // this column was absent from the select.
  stripe_mode: 'test' | 'live' | null;
  // Which processor takes this tenant's customer money. Drives every
  // operator-facing label that used to say "Stripe" unconditionally.
  // anon holds a column-level SELECT grant on it, so adding it to the core
  // select cannot lock the login page out the way an ungranted column would.
  subscription_stripe_mode: 'test' | 'live' | null;
  timezone: string | null;
  currency_code: string | null;
  distance_unit: 'km' | 'miles' | null;
  privacy_policy_version: string | null;
  terms_version: string | null;
  policies_accepted_at: string | null;
  integration_twilio_sms: boolean | null;
  twilio_phone_number: string | null;
  maintenance_banner_enabled: boolean | null;
  maintenance_banner_message: string | null;
  monthly_tier_days: number | null;
  security_deposit_enabled: boolean | null;
  global_deposit_amount: number | null;
  deposit_mode: string | null;
  // When true the deposit is taken as a real captured charge (ledger category
  // 'Security Deposit') instead of a Stripe authorization hold.
  deposit_charge_enabled: boolean | null;
  communication_tone: string | null;
  subscription_gate_disabled: boolean | null;
  subscription_billing_anchor: string | null;
  setup_completed_at: string | null;
  customer_theme_mode: 'dark' | 'light' | 'light_only' | 'dark_only' | null;
  show_effective_daily_rate: boolean | null;
  hide_checkout_price_breakdown: boolean | null;
  /** Keep plates/VIN off this tenant's CUSTOMER-facing booking site. Staff always see them. */
  hide_vehicle_registration: boolean | null;
  // Web Push (PWA) notifications — per-tenant rollout flag.
  push_notifications_enabled: boolean | null;
  gig_driver_enabled: boolean | null;
  /**
   * Head-admin switch allowing staff to create a rental for a customer who has
   * not passed identity verification. A typed reason is still required per
   * rental.
   *
   * anon MUST hold a column-level SELECT grant for this (it does). The portal
   * loads its tenant row with the anon key on the login page, before any
   * session exists, and anon has no table-level grant on `tenants` — so one
   * ungranted column in this select makes Postgres refuse the entire row, and
   * every tenant's login page silently loses its branding for the whole
   * session. The grant does not reach the booking site, which uses its own
   * column list and deliberately omits this flag.
   */
  allow_rental_without_id_verification: boolean | null;
}

interface TenantContextType {
  tenant: Tenant | null;
  loading: boolean;
  error: string | null;
  tenantSlug: string | null;
  refetchTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

const TENANT_CORE_COLUMNS =
  'id, slug, company_name, status, contact_email, phone, admin_name, integration_bonzah, bonzah_brochure_url, bonzah_username, bonzah_mode, bonzah_sandbox_override, boldsign_mode, stripe_mode, subscription_stripe_mode, timezone, currency_code, distance_unit, privacy_policy_version, terms_version, policies_accepted_at, auth_logo_url, integration_twilio_sms, twilio_phone_number, maintenance_banner_enabled, maintenance_banner_message, monthly_tier_days, security_deposit_enabled, global_deposit_amount, deposit_mode, deposit_charge_enabled, communication_tone, subscription_gate_disabled, subscription_billing_anchor, setup_completed_at, customer_theme_mode, gig_driver_enabled, show_effective_daily_rate, hide_checkout_price_breakdown, allow_rental_without_id_verification, hide_vehicle_registration, push_notifications_enabled';

// Domains that belong to us — NOT custom tenant domains
const PLATFORM_DOMAINS = ['drive-247.com', 'localhost', 'vercel.app'];

function isPlatformDomain(hostname: string): boolean {
  const host = hostname.split(':')[0];
  return PLATFORM_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

/**
 * Extract tenant slug from hostname for portal app
 * Portal uses the pattern: {tenant}.portal.domain.com
 * Examples:
 * - "acme.portal.localhost:3001" → "acme"
 * - "acme.portal.drive-247.com" → "acme"
 * - "fleetvana.portal.drive-247.com" → "fleetvana"
 * - "portal.localhost:3001" → null (no tenant)
 * - "portal.drive-247.com" → null (no tenant)
 */
function extractTenantSlug(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0];
  const parts = host.split('.');

  // Handle localhost: "acme.portal.localhost" → "acme" or "acme.localhost" → "acme"
  if (parts[parts.length - 1] === 'localhost') {
    // Pattern: {tenant}.portal.localhost
    if (parts.length >= 3 && parts[parts.length - 2] === 'portal') {
      const tenant = parts[0];
      if (tenant && tenant !== 'portal') {
        return tenant;
      }
      return null;
    }
    // Pattern: {tenant}.localhost
    if (parts.length === 2) {
      const tenant = parts[0];
      if (tenant && tenant !== 'localhost') {
        return tenant;
      }
      return null;
    }
    return null;
  }

  // Handle production: "acme.portal.drive-247.com" → "acme"
  // Pattern: {tenant}.portal.{domain}.{tld}
  // Must have at least 4 parts: tenant.portal.domain.tld
  if (parts.length >= 4 && parts[1] === 'portal') {
    const tenant = parts[0];
    return tenant;
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
      setLoading(true);
      setError(null);

      // Only run on client side
      if (typeof window === 'undefined') {
        setLoading(false);
        return;
      }

      // Extract tenant slug from subdomain (e.g., acme-portal.drive-247.com → acme)
      const hostname = window.location.hostname;
      let slug = extractTenantSlug(hostname);

      // If no subdomain and not a platform domain, try custom portal domain lookup
      if (!slug && !isPlatformDomain(hostname)) {
        let host = hostname;
        if (host.startsWith('www.')) {
          host = host.slice(4);
        }

        console.log(`[TenantContext] No subdomain detected, trying custom portal domain lookup: ${host}`);
        const { data: customDomainTenant } = await supabase
          .from('tenants')
          .select('slug')
          .eq('custom_portal_domain', host)
          // Include suspended so a suspended custom-domain tenant still resolves
          // to its slug and the dashboard can show the suspended block screen.
          .in('status', ['active', 'suspended'])
          .single();

        if (customDomainTenant) {
          slug = customDomainTenant.slug;
          console.log(`[TenantContext] Resolved custom portal domain ${host} → slug: ${slug}`);
        }
      }

      // DEV FALLBACK: If no slug detected on localhost, use 'drive-247' as default
      if (!slug && (hostname === 'localhost' || hostname === '127.0.0.1')) {
        console.log('[TenantContext] DEV MODE: Using default tenant "drive-247"');
        slug = 'drive-247';
      }

      setTenantSlug(slug);

      // If no tenant subdomain, show error (portal requires tenant context)
      if (!slug) {
        console.log('[TenantContext] No tenant subdomain detected');
        setError('No tenant detected. Please access portal via {tenant}.portal.drive-247.com');
        setTenant(null);
        setLoading(false);
        return;
      }

      console.log(`[TenantContext] Loading tenant for slug: ${slug}`);

      const queryTenant = (columns: string) =>
        supabase
          .from('tenants')
          .select(columns)
          .eq('slug', slug)
          // Load both active AND suspended tenants: a suspended tenant must
          // still resolve so the dashboard can show the "account suspended"
          // block screen rather than an infinite "tenant not found" spinner.
          // Enforcement of suspension happens in the dashboard layout.
          .in('status', ['active', 'suspended'])
          .single();

      // `anon` holds COLUMN-level grants on `tenants`, not a table grant
      // (20260723090000_lock_down_tenants_rls.sql), and this provider runs on
      // the login page where there is no session. A column without a grant does
      // not come back null — Postgres refuses the whole row, so one ungranted
      // column takes down branding and login for every tenant. That has already
      // happened once, with customer_theme_mode. Every column added to
      // TENANT_CORE_COLUMNS must be GRANTed SELECT to anon.
      const { data, error: queryError } = await queryTenant(TENANT_CORE_COLUMNS);

      if (queryError) {
        if (queryError.code === 'PGRST116') {
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
    } catch (err: any) {
      console.error('[TenantContext] Unexpected error:', err);
      setError('Failed to load tenant configuration');
      setTenant(null);
    } finally {
      setLoading(false);
    }
  };

  const refetchTenant = async () => {
    await loadTenant();
  };

  return (
    <TenantContext.Provider value={{ tenant, loading, error, tenantSlug, refetchTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);

  // Return safe defaults during SSR or when provider is not mounted
  if (context === undefined) {
    return {
      tenant: null,
      loading: false,
      error: null,
      tenantSlug: null,
      refetchTenant: async () => {}
    };
  }

  return context;
}
