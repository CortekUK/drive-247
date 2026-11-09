import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { headers } from "next/headers";

import { Providers } from "@/app/(northwind)/providers";
import { PWA_INSTALL_PROMPT_STASH_SCRIPT } from "@/lib/pwa-install-stash";
import { CmsEditOverlay } from "@nw/components/cms/edit-overlay";
import { ServiceWorkerRegistrarV2 } from "@nw/components/pwa/service-worker-registrar";
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

/**
 * The customer portal is installed as a PWA and opened from the Home Screen,
 * so it runs edge to edge (`viewport-fit=cover`: the tab bar pads for the home
 * indicator with env(safe-area-inset-bottom)) and carries the manifest, the
 * Apple web-app tags and the icons — on every branch, as (legacy)/layout.tsx
 * explains: iOS reads them only at "Add to Home Screen".
 *
 * Until Nov 2026 this layout sent no icons at all: no favicon in the tab and,
 * worse, no apple-touch-icon, so "Add to Home Screen" on an iPhone made a
 * blurred screenshot of the page its icon. The service worker was missing
 * too (the legacy registrar reads the legacy TenantContext), so the installed
 * app had no offline page and nothing to receive a push.
 */
export async function generateViewport(): Promise<Viewport> {
  const tenant = await resolveTenant();
  const brand = tenant?.primary_color;
  return {
    viewportFit: "cover",
    // The browser's own bars take the operator's brand colour, as the
    // manifest's theme_color does for the installed app.
    ...(brand && /^#[0-9a-f]{6}$/i.test(brand) ? { themeColor: brand } : {}),
  };
}

const PWA_METADATA = {
  appleWebApp: { capable: true, statusBarStyle: "black-translucent" as const },
};

/** Platform-default favicons, for a tenant who has not uploaded their own. */
const PLATFORM_FAVICONS = [
  { url: "/icons/favicon-light.png", media: "(prefers-color-scheme: light)", type: "image/png" },
  { url: "/icons/favicon-dark.png", media: "(prefers-color-scheme: dark)", type: "image/png" },
  { url: "/icons/favicon.ico", sizes: "any" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenant();
  const name = tenant?.app_name || tenant?.company_name || null;
  const title = tenant?.meta_title || name || NEUTRAL_TITLE;
  return {
    title: { default: title, template: name ? `%s · ${name}` : "%s" },
    description: tenant?.meta_description || NEUTRAL_DESCRIPTION,
    ...PWA_METADATA,
    icons: {
      icon: tenant?.favicon_url ?? PLATFORM_FAVICONS,
      ...(tenant?.favicon_url ? { shortcut: tenant.favicon_url } : {}),
    },
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
        {/* Rendered straight into <head> on purpose, NOT through metadata: Next
            streams async metadata into <body> whenever the tenant lookup has not
            finished when the shell flushes, and Chrome reads a manifest link (and
            Safari an apple-touch-icon) from <head> only — a cold start left the
            site uninstallable with Drive247's icon. Both answers are host-based,
            and /pwa-icon falls back to the platform icon when there is no tenant,
            so these two lines are right for every host. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/pwa-icon/180.png" />
        {/* Parks Chrome's install prompt before React mounts: Settings › Install app
            reads it. See lib/pwa-install-stash.ts. */}
        <script dangerouslySetInnerHTML={{ __html: PWA_INSTALL_PROMPT_STASH_SCRIPT }} />
      </head>
      <body className={`${dmSans.variable} font-sans`}>
        <Providers tenantSlug={tenantSlug}>
          {/* Installs the service worker that shows the offline page and receives push while the app is closed. */}
          <ServiceWorkerRegistrarV2 />
          {children}
          {editMode && <CmsEditOverlay />}
        </Providers>
      </body>
    </html>
  );
}
