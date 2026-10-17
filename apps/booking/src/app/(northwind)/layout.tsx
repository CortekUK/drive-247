import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { headers } from "next/headers";

import { Providers } from "./providers";
import { CmsEditOverlay } from "@nw/components/cms/edit-overlay";
import { CMS_EDIT_HEADER, TENANT_HEADER } from "@nw/lib/constants";
import { resolveTenant } from "@nw/lib/cms/server";
import { NORTHWIND_SITE_CSS } from "@nw/site-css";

/**
 * Root layout of the NEW booking design — the one Northwind's customers see.
 *
 * The booking app serves two designs from one port. Every tenant's request goes
 * through src/middleware.ts, which rewrites Northwind's pages into this route
 * group ((northwind)/northwind-site/...) and leaves everyone else on the
 * original design in (legacy)/. The two groups are separate root layouts on
 * purpose: each loads only its own stylesheet and providers, so neither design
 * can restyle the other.
 *
 * Adapted from v2/apps/web/src/app/layout.tsx, where the design was built. The
 * one real difference is the stylesheet: the design is written for Tailwind 4
 * and the booking app builds Tailwind 3, so its CSS is compiled ahead of time by
 * scripts/build-northwind-css.mjs into public/ and linked here.
 */

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

// Every page is tenant-specific and must never be cached across tenants.
export const dynamic = "force-dynamic";

/** meta_title -> app_name -> company_name -> a neutral phrase (matches the original design). */
const NEUTRAL_TITLE = "Premium Car Rentals";
const NEUTRAL_DESCRIPTION = "Premium car rentals with exceptional service";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenant();

  const name = tenant?.app_name || tenant?.company_name || null;
  const title = tenant?.meta_title || name || NEUTRAL_TITLE;
  const description = tenant?.meta_description || NEUTRAL_DESCRIPTION;

  return {
    title: {
      default: title,
      template: name ? `%s · ${name}` : "%s",
    },
    description,
    openGraph: {
      title,
      description,
      siteName: name ?? undefined,
      images: tenant?.og_image_url ? [tenant.og_image_url] : undefined,
    },
  };
}

export default async function NorthwindRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const tenantSlug = requestHeaders.get(TENANT_HEADER);
  // The portal's visual editor: mounted only when the middleware saw ?cms-edit=1.
  const editMode = requestHeaders.get(CMS_EDIT_HEADER) === "1";

  return (
    // The font's variable goes on <html>, not <body>: site.css defines
    // `--typeface-family: var(--font-dm-sans), …` on :root, and a custom
    // property that references an undefined variable is invalid at the element
    // that declares it — so with the variable only on <body>, the whole token
    // resolved to nothing and every northwind page fell back to Times.
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href={NORTHWIND_SITE_CSS} />
      </head>
      <body className="font-sans">
        <Providers tenantSlug={tenantSlug}>
          {children}
          {editMode && <CmsEditOverlay />}
        </Providers>
      </body>
    </html>
  );
}
