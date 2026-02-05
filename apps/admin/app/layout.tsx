import type { Metadata } from 'next';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import DevPanel from '@/components/dev/DevPanel';

export const metadata: Metadata = {
  title: 'Drive247 Admin Portal',
  description: 'Super admin dashboard for Drive247',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <NextTopLoader color="#3b82f6" height={2} showSpinner={false} />
        {children}
        <Toaster />
        <DevPanel />
      </body>
    </html>
  );
}
