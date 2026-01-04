'use client';

import { useEffect, useState } from 'react';
import { useDynamicTheme } from '@/hooks/use-dynamic-theme';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { useTenant } from '@/contexts/TenantContext';
import { Skeleton } from '@/components/ui/skeleton';

export function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  // This hook applies dynamic theme colors from org settings
  useDynamicTheme();
  const { isLoading: brandingLoading, branding } = useTenantBranding();
  const { loading: tenantLoading, tenant } = useTenant();
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
