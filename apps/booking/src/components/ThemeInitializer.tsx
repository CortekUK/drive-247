'use client';

import { useEffect, useState } from 'react';
import { useDynamicTheme } from '@/hooks/useDynamicTheme';
import { useBrandingSettings } from '@/hooks/useBrandingSettings';
import { useTenant } from '@/contexts/TenantContext';

interface ThemeInitializerProps {
  children: React.ReactNode;
}

/**
 * ThemeInitializer component
 *
 * This component initializes the dynamic theme from branding settings.
 * It shows a loading state until tenant data AND branding is fully ready
 * to prevent "flash of default branding" issue.
 */
export function ThemeInitializer({ children }: ThemeInitializerProps) {
  const { branding } = useDynamicTheme();
  const { isLoading: brandingLoading } = useBrandingSettings();
  const { loading: tenantLoading, tenant } = useTenant();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Set ready when loading is complete
    // If tenant exists, wait for branding too
    // If no tenant (e.g., auth callback on root domain), proceed without branding
    if (!tenantLoading && !brandingLoading) {
      if (tenant && branding) {
        // Full tenant context - wait for CSS variables
        requestAnimationFrame(() => {
          setIsReady(true);
        });
      } else if (!tenant) {
        // No tenant context (e.g., auth callback, development without subdomain)
        // Allow rendering without tenant branding
        setIsReady(true);
      }
    }
  }, [tenant, tenantLoading, branding, brandingLoading]);

  // Show loading state while tenant/branding is loading
  if (!isReady) {
    return (
      <div className="fixed inset-0 bg-[#1a1a1a] flex items-center justify-center z-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#E9B63E] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default ThemeInitializer;
