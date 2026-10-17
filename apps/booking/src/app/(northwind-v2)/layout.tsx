import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { headers } from "next/headers";

import { Providers } from "@/app/(northwind)/providers";
import { CmsEditOverlay } from "@nw/components/cms/edit-overlay";
import { CMS_EDIT_HEADER, TENANT_HEADER } from "@nw/lib/constants";
import { resolveTenant } from "@nw/lib/cms/server";
import { NORTHWIND_SITE_CSS } from "@nw/site-css";

/**
 * Root layout of Northwind's booking site v2 — the redesign being built beside
 * the current site in (northwind)/.
 *
 * src/middleware.ts rewrites a Northwind request here only when the super
 * admin's Developer-tab switch says v2 (or the visitor previews with ?site=v2),
 * and only for pages v2 has built (V2_BUILT_SEGMENTS in src/lib/booking-design.ts).
 * Everything else keeps serving from (northwind)/, which this group never edits.
 *
 * Starts from v1's providers and stylesheet so v2 pages can reuse its pieces;
 * swap either here when v2 gets its own.
 */

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const dynamic = "force-dynamic";

const NEUTRAL_TITLE = "Premium Car Rentals";
const NEUTRAL_DESCRIPTION = "Premium car rentals with exceptional service";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenant();
  const name = tenant?.app_name || tenant?.company_name || null;
  const title = tenant?.meta_title || name || NEUTRAL_TITLE;
  return {
    title: { default: title, template: name ? `%s · ${name}` : "%s" },
    description: tenant?.meta_description || NEUTRAL_DESCRIPTION,
  };
}

export default async function NorthwindV2RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const tenantSlug = requestHeaders.get(TENANT_HEADER);
  const editMode = requestHeaders.get(CMS_EDIT_HEADER) === "1";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href={NORTHWIND_SITE_CSS} />
      </head>
      <body className={`${dmSans.variable} font-sans`}>
        <Providers tenantSlug={tenantSlug}>
          {children}
          {editMode && <CmsEditOverlay />}
        </Providers>
      </body>
    </html>
  );
}
