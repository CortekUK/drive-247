import type { Metadata } from 'next';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'Bonzah Partner Console',
  description: 'Review and activate Bonzah insurance onboarding for Drive247 operators',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NextTopLoader color="#d6004f" height={2} showSpinner={false} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
