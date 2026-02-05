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
import { ThemeInitializer } from '@/components/ThemeInitializer';
import GDPRConsent from '@/components/GDPRConsent';
import ScrollToTopOnNavigate from '@/components/ScrollToTopOnNavigate';
import { TenantProvider } from '@/contexts/TenantContext';
import { CustomerAuthProvider } from '@/providers/CustomerAuthProvider';
import DevJumpPanel from '@/components/DevJumpPanel';

const inter = Inter({ subsets: ['latin'] });

// Force dynamic rendering for all routes to avoid SSR issues with Supabase
export const dynamic = 'force-dynamic';

// Default metadata fallback
const defaultMetadata: Metadata = {
  title: 'Premium Car Rentals',
  description: 'Premium car rentals with exceptional service',
};

// Generate metadata dynamically based on tenant
export async function generateMetadata(): Promise<Metadata> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');

    if (!tenantSlug) {
      return defaultMetadata;
    }

    // Create Supabase client for server-side fetch
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
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
      icons: tenant.favicon_url ? {
        icon: tenant.favicon_url,
        shortcut: tenant.favicon_url,
      } : undefined,
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return defaultMetadata;
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <NextTopLoader color="hsl(var(--primary))" height={2} showSpinner={false} />
        <QueryClientProvider>
          <TenantProvider>
            <CustomerAuthProvider>
              <ThemeProvider
              attribute="class"
              defaultTheme="dark"
              enableSystem={true}
              storageKey="vite-ui-theme"
              disableTransitionOnChange
            >
              <ThemeInitializer>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <ScrollToTopOnNavigate />
                  <GDPRConsent />
                  <DevJumpPanel />
                  {children}
                </TooltipProvider>
              </ThemeInitializer>
              </ThemeProvider>
            </CustomerAuthProvider>
          </TenantProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
