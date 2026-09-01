import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClientProvider } from '@/components/QueryClientProvider';
import { ThemeProvider } from 'next-themes';
import type { CustomerThemeMode } from '@/lib/theme-mode';
import { ThemeInitializer } from '@/components/ThemeInitializer';
import GDPRConsent from '@/components/GDPRConsent';
import ScrollToTopOnNavigate from '@/components/ScrollToTopOnNavigate';
import { TenantProvider } from '@/contexts/TenantContext';
import { CustomerAuthProvider } from '@/providers/CustomerAuthProvider';
import { BookingPersistenceGuard } from '@/components/BookingPersistenceGuard';
import DevJumpPanel from '@/components/DevJumpPanel';
import { MaintenanceBanner } from '@/components/MaintenanceBanner';
import { SuspendedGate } from '@/components/SuspendedGate';
import { GoogleAnalytics } from '@/components/GoogleAnalytics';

const inter = Inter({ subsets: ['latin'] });

// Force dynamic rendering for all routes to avoid SSR issues with Supabase
export const dynamic = 'force-dynamic';

// Default metadata fallback
// `manifest` and `appleWebApp` belong on EVERY branch, including the fallbacks.
// iOS reads them only at "Add to Home Screen"; if the tenant lookup happens to
// fail on the visit where someone installs, the icon is created without them and
// the install is permanently a plain bookmark.
const PWA_METADATA = {
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent' as const,
  },
};

/**
 * Platform-default favicons, used when a tenant has not uploaded their own.
 *
 * A light/dark PAIR rather than one file: the mark's D is near-black, so a
 * single favicon disappears against the dark tab strip that most desktops now
 * default to. The .ico stays as the untheme-able fallback for crawlers.
 */
const PLATFORM_FAVICONS = [
      { url: '/icons/favicon-light.png', media: '(prefers-color-scheme: light)', type: 'image/png' },
      { url: '/icons/favicon-dark.png', media: '(prefers-color-scheme: dark)', type: 'image/png' },
      { url: '/icons/favicon.ico', sizes: 'any' },
    ];

const defaultMetadata: Metadata = {
  title: 'Premium Car Rentals',
  description: 'Premium car rentals with exceptional service',
  ...PWA_METADATA,
  icons: { icon: PLATFORM_FAVICONS, apple: '/icons/apple-touch-icon.png' },
};

// Generate metadata dynamically based on tenant
export async function generateMetadata(): Promise<Metadata> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');

    if (!tenantSlug) {
      return defaultMetadata;
    }

    // Guard against missing env vars (e.g. during build or cold start)
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return defaultMetadata;
    }

    // Create Supabase client for server-side fetch
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data: tenant } = await supabase
      .from('tenants')
      .select('app_name, company_name, meta_title, meta_description, favicon_url, logo_url')
      .eq('slug', tenantSlug)
      .single();

    if (!tenant) {
      return defaultMetadata;
    }

    const title = tenant.meta_title || tenant.app_name || tenant.company_name || 'Premium Car Rentals';
    const description = tenant.meta_description || 'Premium car rentals with exceptional service';

    return {
      ...PWA_METADATA,
      title,
      description,
      openGraph: {
        title,
        description,
        siteName: tenant.app_name || tenant.company_name,
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
      },
      icons: {
        // The operator's own favicon wins when they have one; otherwise fall
        // back to the theme-aware Drive247 pair rather than a single file.
        icon: tenant.favicon_url ?? PLATFORM_FAVICONS,
        ...(tenant.favicon_url ? { shortcut: tenant.favicon_url } : {}),
        // iOS takes the Home Screen icon from here, NOT from the manifest, and
        // it must be opaque — a transparent PNG is flattened onto black.
        apple: '/icons/apple-touch-icon.png',
      },
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return defaultMetadata;
  }
}

// Resolve the tenant's customer-site theme mode server-side (same x-tenant-slug
// path as generateMetadata) so the correct theme is baked into the pre-hydration
// inline script — no dark flash. Falls back to 'dark' (today's behavior) on any
// miss or error.
async function getTenantThemeMode(): Promise<CustomerThemeMode> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');
    if (!tenantSlug || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return 'dark';
    }
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { data } = await supabase
      .from('tenants')
      .select('customer_theme_mode')
      .eq('slug', tenantSlug)
      .single();
    return (data?.customer_theme_mode as CustomerThemeMode) ?? 'dark';
  } catch {
    return 'dark';
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const themeMode = await getTenantThemeMode();
  // Map the tenant mode → next-themes props. `forcedTheme` (for the "-only"
  // modes) ignores localStorage/system entirely, so even a returning customer
  // with a stored 'dark' preference gets the forced theme on first paint.
  const themeProps =
    themeMode === 'light_only' ? { forcedTheme: 'light' } :
    themeMode === 'dark_only' ? { forcedTheme: 'dark' } :
    themeMode === 'light' ? { defaultTheme: 'light', enableSystem: false } :
    { defaultTheme: 'dark', enableSystem: true };

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} overflow-x-hidden`} suppressHydrationWarning>
        <NextTopLoader color="hsl(var(--primary))" height={2} showSpinner={false} />
        <QueryClientProvider>
          <TenantProvider>
            {/* Loads the tenant's own Google tag (gtag.js) when configured —
                reads ga_measurement_id from TenantContext, so it must sit inside
                TenantProvider. Renders nothing when unset. */}
            <GoogleAnalytics />
            <CustomerAuthProvider>
              <BookingPersistenceGuard>
              <ThemeProvider
              attribute="class"
              storageKey="vite-ui-theme"
              disableTransitionOnChange
              {...themeProps}
            >
              <ThemeInitializer>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <ScrollToTopOnNavigate />
                  <GDPRConsent />
                  <DevJumpPanel />
                  <MaintenanceBanner />
                  <SuspendedGate>{children}</SuspendedGate>
                </TooltipProvider>
              </ThemeInitializer>
              </ThemeProvider>
              </BookingPersistenceGuard>
            </CustomerAuthProvider>
          </TenantProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
