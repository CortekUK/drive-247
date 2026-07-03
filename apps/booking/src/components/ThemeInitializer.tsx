'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDynamicTheme } from '@/hooks/useDynamicTheme';
import { useBrandingSettings } from '@/hooks/useBrandingSettings';
import { useTenant } from '@/contexts/TenantContext';

interface ThemeInitializerProps {
  children: React.ReactNode;
}

// Public, crawler-facing pages that MUST appear in the server-rendered HTML.
// US A2P 10DLC / carrier review bots (and SEO crawlers) fetch these URLs
// without executing JS, so they cannot be hidden behind the branding-ready
// spinner below — a page that renders only the spinner in its initial HTML
// reads as "blank" and fails SMS campaign vetting (errors 30908 / 30882).
// For these text-only legal pages a brief flash of the default theme is an
// acceptable trade for being verifiable; every other route keeps the
// anti-flash behavior unchanged.
const CRAWLER_VISIBLE_PATHS = ['/privacy', '/terms', '/sms-opt-in'];

function isCrawlerVisiblePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return CRAWLER_VISIBLE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * ThemeInitializer component
 *
 * This component initializes the dynamic theme from branding settings.
 * It shows a loading state until tenant data AND branding is fully ready
 * to prevent "flash of default branding" issue.
 */
export function ThemeInitializer({ children }: ThemeInitializerProps) {
  const pathname = usePathname();
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

  // Crawler-facing legal pages must render their content in the initial HTML,
  // so they skip the branding-ready gate entirely (server + client render the
  // children immediately — no hydration mismatch since both branches match).
  // Show loading state while tenant/branding is loading for every other route.
  if (!isCrawlerVisiblePath(pathname) && !isReady) {
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
