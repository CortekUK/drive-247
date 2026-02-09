'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  status: string;
  contact_email: string;
  admin_name: string | null;
  integration_veriff: boolean | null;
  integration_bonzah: boolean | null;
  timezone: string | null;
}

interface TenantContextType {
  tenant: Tenant | null;
  loading: boolean;
  error: string | null;
  tenantSlug: string | null;
  refetchTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

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

  // Handle localhost: "acme.portal.localhost" → "acme"
  // Pattern: {tenant}.portal.localhost
  if (parts.length >= 3 && parts[parts.length - 1] === 'localhost' && parts[parts.length - 2] === 'portal') {
    const tenant = parts[0];
    if (tenant && tenant !== 'portal') {
      return tenant;
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

      // Query the tenants table by slug
      const { data, error: queryError } = await supabase
        .from('tenants')
        .select('id, slug, company_name, status, contact_email, admin_name, integration_veriff, integration_bonzah, timezone')
        .eq('slug', slug)
        .eq('status', 'active')
        .single();

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
      setTenant(data);
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
