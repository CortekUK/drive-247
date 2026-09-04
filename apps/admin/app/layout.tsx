import type { Metadata } from 'next';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegistrar } from '@/components/push/service-worker-registrar';

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <NextTopLoader color="#a470ff" height={2} showSpinner={false} />
        {/* Installs the worker that receives platform activity push while this
            dashboard is closed. */}
        <ServiceWorkerRegistrar />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
