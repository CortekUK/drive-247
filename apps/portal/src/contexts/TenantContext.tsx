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
  integration_veriff: boolean | null;
  integration_bonzah: boolean | null;
  // Finance Sync — TRUE while an active accounting_connections row exists for
  // this tenant. Flipped false by refresh-accounting-tokens / process-accounting-sync
  // when the connection expires, so the Settings pill reflects reality.
  integration_xero: boolean | null;
  integration_zoho_books: boolean | null;
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
  // an integration's own mode: "INSHUR is simulated but Stripe is LIVE" means a
  // renter can be charged for cover that does not exist, and that warning
  // silently never fired while this column was absent from the select.
  stripe_mode: 'test' | 'live' | null;
  // Which processor takes this tenant's customer money. Drives every
  // operator-facing label that used to say "Stripe" unconditionally.
  // anon holds a column-level SELECT grant on it, so adding it to the core
  // select cannot lock the login page out the way an ungranted column would.
  payment_provider: 'stripe' | 'square' | null;
  subscription_stripe_mode: 'test' | 'live' | null;
  integration_inshur: boolean | null;
  inshur_mode: 'mock' | 'test' | 'live' | null;
  inshur_customer_number: string | null;
  inshur_policy_number: string | null;
  inshur_states_allowed: string[] | null;
  inshur_states_synced_at: string | null;
  inshur_billing_mode: 'host_absorbs' | 'renter_pays' | null;
  // Credentials (inshur_username / inshur_password / inshur_2fa_token) are
  // deliberately NOT loaded here. This context is read by every page; the
  // Settings panel and useInshur() fetch what they need on their own.
  timezone: string | null;
  currency_code: string | null;
  distance_unit: 'km' | 'miles' | null;
  privacy_policy_version: string | null;
  terms_version: string | null;
  policies_accepted_at: string | null;
  integration_twilio_sms: boolean | null;
  twilio_phone_number: string | null;
  integration_twilio_whatsapp: boolean | null;
  twilio_whatsapp_number: string | null;
  twilio_whatsapp_lockbox_template_sid: string | null;
  integration_whatsapp: boolean | null;
  meta_whatsapp_phone_number: string | null;
  maintenance_banner_enabled: boolean | null;
  maintenance_banner_message: string | null;
  monthly_tier_days: number | null;
  integration_tesla_fleet: boolean | null;
  security_deposit_enabled: boolean | null;
  global_deposit_amount: number | null;
  deposit_mode: string | null;
  // When true the deposit is taken as a real captured charge (ledger category
  // 'Security Deposit') instead of a Stripe authorization hold.
  deposit_charge_enabled: boolean | null;
  lead_management_enabled: boolean | null;
  automations_enabled: boolean | null;
  vehicle_owners_enabled: boolean | null;
  /**
   * Turo Sync. When true this tenant's portal shows the Turo Sync screen and
   * its sidebar entry; when false both are hidden.
   *
   * This is a VISIBILITY PREFERENCE, not an authorization boundary. The Turo
   * rows are fenced by RLS on turo_bridge_reservations (tenant_id =
   * get_user_tenant_id() OR is_super_admin()) and the flag appears in no
   * policy — so a session that can already read this tenant's Turo rows can
   * still read them from PostgREST with the flag off.
   *
   * anon SHOULD hold a column-level SELECT grant for this (see the note on
   * allow_rental_without_id_verification below for the full mechanism —
   * Postgres refuses the whole ROW, not the column), applied by
   * turo-bridge-poc/sql/04-turo-sync-flag.sql. It is NOT a ship blocker: this
   * column lives in TENANT_OPTIONAL_COLUMNS rather than the core list precisely
   * so the 42501 retry sheds it, which means merging this file before that SQL
   * costs the login page a flag it never reads instead of costing every tenant
   * its branding. That is also why the type is nullable and every reader must
   * use `=== true` — undefined is a real, expected value here.
   */
  turo_bridge_enabled?: boolean | null;
  lead_stale_threshold_hours: number | null;
  lead_auto_lost_threshold_hours: number | null;
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
  'id, slug, company_name, status, contact_email, phone, admin_name, integration_veriff, integration_bonzah, integration_xero, integration_zoho_books, bonzah_brochure_url, bonzah_username, bonzah_mode, bonzah_sandbox_override, boldsign_mode, stripe_mode, payment_provider, subscription_stripe_mode, timezone, currency_code, distance_unit, privacy_policy_version, terms_version, policies_accepted_at, auth_logo_url, integration_twilio_sms, twilio_phone_number, integration_twilio_whatsapp, twilio_whatsapp_number, twilio_whatsapp_lockbox_template_sid, integration_whatsapp, meta_whatsapp_phone_number, maintenance_banner_enabled, maintenance_banner_message, monthly_tier_days, integration_tesla_fleet, security_deposit_enabled, global_deposit_amount, deposit_mode, deposit_charge_enabled, lead_management_enabled, automations_enabled, vehicle_owners_enabled, lead_stale_threshold_hours, lead_auto_lost_threshold_hours, communication_tone, subscription_gate_disabled, subscription_billing_anchor, setup_completed_at, customer_theme_mode, gig_driver_enabled, show_effective_daily_rate, hide_checkout_price_breakdown, allow_rental_without_id_verification, hide_vehicle_registration, push_notifications_enabled';

const TENANT_INSHUR_COLUMNS =
  'integration_inshur, inshur_mode, inshur_customer_number, inshur_policy_number, inshur_states_allowed, inshur_states_synced_at, inshur_billing_mode';

/**
 * Columns the portal WANTS but can survive without, kept out of the core list
 * on purpose so the 42501 retry below can shed them.
 *
 * `anon` holds COLUMN-level grants on `tenants` and no table grant, and
 * Postgres refuses the whole ROW when any selected column is ungranted — so a
 * column added to the CORE list before its GRANT lands takes branding and login
 * down for every tenant at once (it has happened, with customer_theme_mode).
 * Putting a new flag here first removes that ordering hazard entirely: the
 * authenticated dashboard, which holds a table-level grant, gets it on the
 * first attempt; the anon login page falls back and simply does without it.
 *
 * `turo_bridge_enabled` (the Turo Sync switch) is only ever read inside the
 * authenticated dashboard — the sidebar entry and the Turo Sync route guard.
 *
 * ⚠ Do NOT read that as "shedding it on the anon path costs nothing". This
 * provider fetches ONCE on mount with `[]` deps and never refetches on an auth
 * change, and the login page redirects with router.replace(), which keeps the
 * root layout — and therefore this provider — mounted. The tenant object built
 * on the LOGGED-OUT login page is the one the dashboard then uses for the whole
 * session, so anything shed here is missing in the dashboard too, until a hard
 * refresh. That is why the retry ladder below has a middle rung: these columns
 * are shed only when they are themselves ungranted, never as collateral damage
 * from the INSHUR group, which anon can never read.
 *
 * Until turo-bridge-poc/sql/04-turo-sync-flag.sql is applied the flag reads
 * undefined on the anon path and the feature renders as OFF — fail-closed, no
 * outage. Once it is applied, rung 2 picks it up. Promoting it into the core
 * list buys nothing and reintroduces the ordering hazard; leave it here.
 */
const TENANT_OPTIONAL_COLUMNS = 'turo_bridge_enabled';

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

      let { data, error: queryError } = await queryTenant(
        `${TENANT_CORE_COLUMNS}, ${TENANT_INSHUR_COLUMNS}, ${TENANT_OPTIONAL_COLUMNS}`
      );

      // `anon` holds COLUMN-level grants on `tenants`, not a table grant
      // (20260723090000_lock_down_tenants_rls.sql), and this provider runs on
      // the login page where there is no session. A column without a grant does
      // not come back null — Postgres refuses the whole row, so one ungranted
      // column takes down branding and login for every tenant. That has already
      // happened once, with customer_theme_mode. Retry without the newest
      // columns rather than let a missing GRANT lock operators out.
      //
      // The ladder sheds ONE GROUP AT A TIME, and the order matters.
      //
      // It was briefly two rungs — everything, then core-only — which quietly
      // made TENANT_OPTIONAL_COLUMNS unreadable for anyone without a session.
      // Measured against production 2026-09-05: `anon` holds ZERO grants on all
      // seven INSHUR columns, so rung 1 does not merely *sometimes* fail on the
      // anon path, it fails EVERY time (HTTP 401, code 42501). A two-rung ladder
      // therefore dropped the optional columns on every single logged-out load,
      // whether or not they had a grant of their own.
      //
      // That is not confined to the login page, because nothing here refetches:
      // loadTenant() runs once on mount with `[]` deps, and signing in navigates
      // with router.replace() — a client-side push that keeps the root layout,
      // and therefore this provider, mounted. So the tenant object assembled
      // ANONYMOUSLY survives into the authenticated dashboard for the rest of
      // the session: an operator with Turo Sync switched ON would see no sidebar
      // entry until their next hard refresh, which reads as a broken toggle.
      //
      // Rung 2 separates those two failures. INSHUR is shed first because it is
      // the group known to be ungranted; the optional flags then get their own
      // chance and reach rung 3 only if they are genuinely ungranted too. Safe
      // in both directions: before the GRANT lands rung 3 catches it and nobody
      // is locked out, and after it lands the flag is readable without a session.
      //
      // Anything in TENANT_CORE_COLUMNS still has NO fallback — every rung keeps
      // the core list — which is exactly why a new flag belongs in
      // TENANT_OPTIONAL_COLUMNS until its GRANT has been applied and proven with
      // a real anon-key read.
      if (queryError && queryError.code !== 'PGRST116') {
        console.warn(
          '[TenantContext] Full tenant select failed; retrying without the INSHUR columns. ' +
            'If this persists, GRANT SELECT on them to anon. Cause:',
          queryError.message
        );
        ({ data, error: queryError } = await queryTenant(
          `${TENANT_CORE_COLUMNS}, ${TENANT_OPTIONAL_COLUMNS}`
        ));
      }

      if (queryError && queryError.code !== 'PGRST116') {
        console.warn(
          '[TenantContext] Retry without INSHUR also failed; falling back to the core columns ' +
            'alone. The optional columns (' +
            TENANT_OPTIONAL_COLUMNS +
            ') will read as undefined for this load, so the features behind them render as ' +
            'OFF. Apply the column GRANT in turo-bridge-poc/sql/04-turo-sync-flag.sql. Cause:',
          queryError.message
        );
        ({ data, error: queryError } = await queryTenant(TENANT_CORE_COLUMNS));
      }

      if (queryError) {
        if (queryError.code === 'PGRST116') {
          console.warn(`[TenantContext] No active tenant found for slug: ${slug}`);
          setError(`Tenant "${slug}" not found or inactive`);
        } else if (queryError.code === '42501') {
          // No rung below this one: 42501 here means an ungranted column in
          // TENANT_CORE_COLUMNS. Say so explicitly, because Postgres will not.
          // It answers HTTP 401 with 'permission denied for table tenants' —
          // blaming the TABLE and never naming the column — which is what turns
          // a one-line GRANT into an afternoon spent chasing a phantom auth bug.
          console.error(
            '[TenantContext] COLUMN GRANT MISSING. A column in TENANT_CORE_COLUMNS is not ' +
              'readable by this role, so Postgres refused the WHOLE tenant row. Branding and ' +
              'login are down for EVERY tenant, not just this one. Find the column with the ' +
              'DEPLOY GATE query at the bottom of turo-bridge-poc/sql/04-turo-sync-flag.sql, ' +
              'then GRANT SELECT (<column>) ON public.tenants TO anon. Cause:',
            queryError.message
          );
          setError(queryError.message);
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
