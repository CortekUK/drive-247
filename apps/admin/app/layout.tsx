import type { Metadata } from 'next';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import DevPanel from '@/components/dev/DevPanel';
import { ServiceWorkerRegistrar } from '@/components/push/service-worker-registrar';

export const metadata: Metadata = {
  title: 'Drive247 Admin Portal',
  description: 'Super admin dashboard for Drive247',
  manifest: '/manifest.webmanifest',
  // iOS reads these only at "Add to Home Screen", and push does not exist on iOS
  // outside an installed app — so without them the dashboard can never notify.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
  icons: { apple: '/icons/apple-touch-icon.png' },
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
        <DevPanel />
      </body>
    </html>
  );
}
