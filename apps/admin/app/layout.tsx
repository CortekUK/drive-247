import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmHost } from '@/components/ui/confirm';
import { ServiceWorkerRegistrar } from '@/components/push/service-worker-registrar';
import { THEME_SCRIPT } from '@/lib/theme-script';

/**
 * The v2 design's typeface, matching the portal canary. Self-hosted by
 * next/font rather than pulled from fonts.googleapis.com at paint time, which
 * is what globals.css used to do for Inter — an @import at the top of a
 * stylesheet is render-blocking and costs a third-party round trip. Defines
 * --font-manrope; tailwind.config.ts's `fontFamily.sans` reads it.
 */
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Drive247 Admin Portal',
  description: 'Super admin dashboard for Drive247',
  manifest: '/manifest.webmanifest',
  // iOS reads these only at "Add to Home Screen", and push does not exist on iOS
  // outside an installed app — so without them the dashboard can never notify.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
  icons: {
    // Shipped as a light/dark PAIR wired to prefers-color-scheme. A single
    // dark-ink favicon vanishes against a dark tab strip, which is the default
    // on most desktops now; the .ico stays as the untheme-able fallback for
    // crawlers and older browsers.
    icon: [
      { url: '/icons/favicon-light.png', media: '(prefers-color-scheme: light)', type: 'image/png' },
      { url: '/icons/favicon-dark.png', media: '(prefers-color-scheme: dark)', type: 'image/png' },
      { url: '/icons/favicon.ico', sizes: 'any' },
    ],
    // iOS takes the Home Screen icon from here, NOT the manifest, and it must
    // be opaque — a transparent PNG is flattened onto black.
    apple: '/icons/apple-touch-icon.png',
  }
};

/**
 * `viewport-fit=cover`, as Northwind's: it is what makes
 * `env(safe-area-inset-*)` report anything but 0, so the phone tab bar clears
 * the home indicator and, installed to the Home Screen (the status bar is
 * `black-translucent`), the top bar clears the clock.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        {/* Dark mode before first paint — see lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {/* Indigo, matching --primary (248 68% 51%) — the loader sits above the
            page so it cannot read a CSS variable from it. */}
        <NextTopLoader color="#442dd7" height={2} showSpinner={false} />
        {/* Installs the worker that receives platform activity push while this
            dashboard is closed. */}
        <ServiceWorkerRegistrar />
        {children}
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  );
}
