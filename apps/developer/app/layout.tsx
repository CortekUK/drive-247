import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { THEME_SCRIPT } from '@/lib/theme-script';

/** The super-admin dashboard's typeface; tailwind.config.ts's `fontFamily.sans` reads it. */
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Drive247 Developer',
  description: 'Drive247 developer hub: test signups and resets',
  // Internal tool: keep it out of search results.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/icons/favicon-light.png', media: '(prefers-color-scheme: light)', type: 'image/png' },
      { url: '/icons/favicon-dark.png', media: '(prefers-color-scheme: dark)', type: 'image/png' },
      { url: '/icons/favicon.ico', sizes: 'any' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        {/* Dark mode before first paint — see lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <NextTopLoader color="#442dd7" height={2} showSpinner={false} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
