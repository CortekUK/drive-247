import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { headers } from "next/headers";

import { Providers } from "./providers";
import { CmsEditOverlay } from "@/components/cms/edit-overlay";
import { CMS_EDIT_HEADER, TENANT_HEADER } from "@/lib/constants";
import { resolveTenant } from "@/lib/cms/server";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

/**
 * Whose site is this?
 *
 * This was a static `metadata` naming DRIVE247 — so every tenant's browser tab
 * read "Drive247 — Rent the exact car you see", every sub-page appended
 * "· Drive247", and that is the string a search engine indexes and a person
 * sees when they bookmark the page. A tenant sends customers to their own
 * domain; our name has no business being the one on it.
 *
 * The chain matches the v1 site exactly (`apps/booking/src/app/layout.tsx`), so
 * a tenant moving between the two sees no change:
 *
 *     meta_title -> app_name -> company_name -> a neutral phrase
 *
 * The last link is deliberately generic. It is reached only by a tenant who has
 * filled in nothing at all, and for them a plain description of the business is
 * honest where OUR brand would be actively wrong.
 */
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
      /* The suffix is the TENANT's name, not the title: a meta_title is often a
         sentence, and "Fleet · Rent the exact car you see" reads as nonsense. */
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
  // The portal's visual editor. Mounted only when the middleware saw
  // `?cms-edit=1`, and inert even then until a portal window says hello —
  // see components/cms/edit-overlay.tsx. Costs the public site nothing.
  const editMode = requestHeaders.get(CMS_EDIT_HEADER) === "1";

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} font-sans`}>
        {/*
          The overlay sits INSIDE Providers, not beside it. It needs the React
          Query client: the FAQ questions and the customer quotes are table rows
          held in the client cache, and a `cms:refresh` has to invalidate them or
          an operator's edit to a question never appears. It renders null and
          mounts only in edit mode, so this costs a visitor nothing.
        */}
        <Providers tenantSlug={tenantSlug}>
          {children}
          {editMode && <CmsEditOverlay />}
        </Providers>
      </body>
    </html>
  );
}
