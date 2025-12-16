'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { extractSubdomain } from '@/middleware/tenantMiddleware';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  status: string;
  contact_email: string;
}

interface TenantContextType {
  tenant: Tenant | null;
  loading: boolean;
  error: string | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTenant();
  }, []);

  const loadTenant = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if we're in a browser environment
      if (typeof window === 'undefined') {
        setLoading(false);
        return;
      }

      // Get subdomain from hostname
      const hostname = window.location.hostname;
      const subdomain = extractSubdomain(hostname);

      if (!subdomain) {
        setError('No tenant subdomain detected');
        setLoading(false);
        return;
      }

      // Fetch tenant from database
      const { data, error: fetchError } = await supabase
        .from('tenants')
        .select('id, slug, company_name, status, contact_email')
        .eq('slug', subdomain)
        .eq('status', 'active')
        .single();

      if (fetchError) throw fetchError;

      if (!data) {
        setError('Tenant not found or inactive');
        setLoading(false);
        return;
      }

      setTenant(data);
    } catch (err: any) {
      console.error('Error loading tenant:', err);
      setError(err.message || 'Failed to load tenant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <TenantContext.Provider value={{ tenant, loading, error }}>
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
      error: null
    };
  }

  return context;
}
