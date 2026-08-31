import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { headers } from "next/headers";

import { Providers } from "./providers";
import { TENANT_HEADER } from "@/lib/constants";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Drive247 — Rent the exact car you see",
    template: "%s · Drive247",
  },
  description:
    "Premium digital car rental. Every vehicle is digitally inspected and safety-certified before pickup.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the slug the middleware resolved so the client tree starts with the
  // right tenant instead of re-deriving it after hydration. Reading a header
  // opts the tree into dynamic rendering, which is correct here: every page is
  // tenant-specific and must never be cached across tenants.
  const requestHeaders = await headers();
  const tenantSlug = requestHeaders.get(TENANT_HEADER);

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} font-sans`}>
        <Providers tenantSlug={tenantSlug}>{children}</Providers>
      </body>
    </html>
  );
}
