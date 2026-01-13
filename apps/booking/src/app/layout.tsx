import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'Drive917 - Premium Car Rentals',
  description: 'Premium luxury car rentals with exceptional service',
};

// Inline script to apply cached branding BEFORE React hydrates
const brandingScript = `
(function() {
  try {
    var cached = localStorage.getItem('tenant-branding-css');
    if (cached) {
      var style = document.createElement('style');
      style.id = 'cached-branding';
      style.textContent = cached;
      document.head.appendChild(style);
    }
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: brandingScript }} />
      </head>
      <body className={inter.className} suppressHydrationWarning>
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
