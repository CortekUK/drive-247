'use client';

import { useEffect, useState } from 'react';
import { useDynamicTheme } from '@/hooks/use-dynamic-theme';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { useTenant } from '@/contexts/TenantContext';
import { Skeleton } from '@/components/ui/skeleton';
import { TenantNotFound } from '@/components/shared/layout/tenant-not-found';

export function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  // This hook applies dynamic theme colors from org settings
  useDynamicTheme();
  const { isLoading: brandingLoading, branding } = useTenantBranding();
  const {
    loading: tenantLoading,
    tenant,
    error: tenantError,
    tenantSlug,
  } = useTenant();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Only set ready when BOTH tenant data AND branding are loaded
    // This ensures company name, logo, and colors are all ready
    if (!tenantLoading && !brandingLoading && tenant && branding) {
      // Small delay to ensure CSS variables are applied
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    }
  }, [tenant, tenantLoading, branding, brandingLoading]);

  // Tenant resolution FINISHED and produced nothing. Waiting longer cannot help:
  // TenantContext has already run its query, set an error and cleared `loading`,
  // and it will not retry on its own.
  //
  // This branch is the whole point of the file. Without it the condition above
  // simply never became true, so a subdomain that matched no tenant rendered the
  // skeleton below forever — turning a one-character typo in the address into
  // something indistinguishable from a platform outage, with no message on screen
  // to suggest otherwise. It cost an operator an evening of bookings.
  //
  // Safe against a false positive during normal startup: `loading` initialises to
  // `true` in TenantContext, so `!tenantLoading && !tenant` is unreachable until a
  // real lookup has completed and failed.
  if (!tenantLoading && !tenant) {
    return <TenantNotFound slug={tenantSlug} message={tenantError} />;
  }

  // Show loading state while tenant/branding is loading
  if (!isReady) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex h-16 items-center justify-between px-6 border-b">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default DynamicThemeProvider;
