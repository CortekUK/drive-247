import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import { Providers } from "./providers";
import { v2BrandVars } from "@/lib/appearance/color";
import "@/global.css";
// Scoped v2 design tokens. Inert unless <body> carries `v2-theme`, which is
// decided per-tenant below — so importing it changes nothing for v1 tenants.
import "@/styles/v2-theme.css";
import { V2Provider } from "@/lib/v2-context";
import { readPortalTenant } from "@/lib/portal-tenant";
import { resolvePortalGates } from "@/lib/v2-server";

export const dynamic = "force-dynamic";

/**
 * The platform's own brand string that `tenants.app_name` used to default to.
 * Treated as "unset" so it is never rendered as a tenant's own brand.
 */
const PLATFORM_DEFAULT_APP_NAME = "Drive 917";

// Applied on EVERY metadata branch, fallbacks included. iOS reads these only at
// "Add to Home Screen" — if the tenant lookup happens to fail on the visit where
// an operator installs, the icon is created without them and that install can
// never receive push.
const PWA_METADATA = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default" as const },
};

/**
 * Platform-default favicons, used when a tenant has not uploaded their own.
 * A light/dark pair because the mark's D is near-black and would vanish against
 * the dark tab strip most desktops now default to.
 */
const PLATFORM_FAVICONS = [
  { url: "/icons/favicon-light.png", media: "(prefers-color-scheme: light)", type: "image/png" },
  { url: "/icons/favicon-dark.png", media: "(prefers-color-scheme: dark)", type: "image/png" },
  { url: "/icons/favicon.ico", sizes: "any" },
];

const defaultMetadata: Metadata = {
  title: "Drive247 Portal",
  description: "Multi-tenant fleet management portal",
  ...PWA_METADATA,
  icons: { icon: PLATFORM_FAVICONS, apple: "/icons/apple-touch-icon.png" },
};

/**
 * `readPortalTenant` now lives in `lib/portal-tenant.ts`, because a third
 * caller needs it: the v2 gates. `tenants.portal_experience` decides whether a
 * tenant is on v2, and that has to come out of the SAME round trip
 * `generateMetadata` already makes rather than a second query.
 *
 * It no longer takes `withBrand`. That argument was the ordering trap — you
 * cannot decide whether to select the brand columns from a flag that is itself
 * one of the columns, and reading twice is the thing being avoided. The column
 * list is fixed there; the brand PAINT below stays behind the resolved flag, so
 * a v1 tenant's rendered output is byte for byte what it was.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (!tenantSlug) return defaultMetadata;

    const tenant = await readPortalTenant(tenantSlug);

    if (!tenant) return defaultMetadata;

    // Belt-and-braces: `tenants.app_name` used to carry the platform default
    // 'Drive 917' as a column default. The default was dropped and every row
    // backfilled, but treat the literal as "unset" so a stale/reintroduced value
    // is never served as a tenant's own <title> / og:site_name.
    const ownAppName =
      tenant.app_name?.trim() && tenant.app_name.trim() !== PLATFORM_DEFAULT_APP_NAME
        ? tenant.app_name.trim()
        : null;
    const brandName =
      ownAppName || tenant.company_name || "Drive247";
    const title =
      tenant.meta_title || `${brandName} - Portal`;
    const description =
      tenant.meta_description ||
      `${brandName} fleet management portal`;

    return {
      ...PWA_METADATA,
      title,
      description,
      openGraph: {
        title,
        description,
        siteName: brandName,
        type: "website",
        images: tenant.og_image_url ? [tenant.og_image_url] : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: tenant.og_image_url ? [tenant.og_image_url] : undefined,
      },
      icons: {
        // The operator's own favicon wins when they have one; otherwise fall
        // back to the theme-aware Drive247 pair rather than a single file.
        icon: tenant.favicon_url ?? PLATFORM_FAVICONS,
        ...(tenant.favicon_url ? { shortcut: tenant.favicon_url } : {}),
        // iOS takes the Home Screen icon from here, NOT the manifest, and it
        // must be opaque — a transparent PNG gets flattened onto black.
        apple: "/icons/apple-touch-icon.png",
      },
    };
  } catch (error) {
    console.error("Error generating portal metadata:", error);
    return defaultMetadata;
  }
}

/**
 * The v2 design's typeface. Defines --font-manrope only; nothing reads it
 * outside `.v2-theme`, so v1 tenants neither render it nor fetch the files.
 */
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const brandingScript = `
(function() {
  try {
    var cached = localStorage.getItem('portal-tenant-branding-css');
    if (cached) {
      var style = document.createElement('style');
      style.id = 'cached-branding';
      style.textContent = cached;
      document.head.appendChild(style);
    }
  } catch(e) {}
})();
`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Every gate for this request, answered once, on the server, so the page
  // paints correctly on the first byte. Two sources, OR'd: the `V2_AREAS` slug
  // list and the tenant's own `portal_experience` column — see lib/v2-server.
  //
  // Fails closed the whole way down. The slug comes from `x-tenant-slug` and is
  // null on anything unresolvable; the column read answers false on a missing
  // row, a read error, an unknown value or a missing GRANT. So a lookup problem
  // leaves every tenant on the v1 theme rather than repainting them.
  //
  // Client components read these through useV2() / useIsLean() instead of
  // looking the tenant up again — see lib/v2-context and lib/lean-context.
  const { tenantSlug, onV2, flags: v2Flags, lean } = await resolvePortalGates();

  const themeClass = v2Flags.theme ? "v2-theme" : undefined;
  // The font variable rides with the theme gate, so v1 tenants are untouched.
  const fontClass = v2Flags.theme ? manrope.variable : undefined;

  // The tenant's brand colour on the first byte, for the v2 theme only. The
  // stylesheet derives every brand-coloured token from these vars on <body>;
  // use-dynamic-theme writes the same vars after hydration and on every
  // change, so without this the page would paint indigo and then switch.
  // Fails open: any error, or no colour, leaves the stylesheet's defaults.
  // v1 tenants skip it entirely — no query, no style attribute.
  let brandStyle: CSSProperties | undefined;
  if (v2Flags.theme && tenantSlug) {
    try {
      const tenant = await readPortalTenant(tenantSlug, true);
      const vars = v2BrandVars(tenant?.light_primary_color || tenant?.primary_color);
      brandStyle = vars ? (vars as CSSProperties) : undefined;
    } catch {
      brandStyle = undefined;
    }
  }

  return (
    <html lang="en" suppressHydrationWarning className={fontClass}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* v1 only. The cached CSS is v1's tokens on :root, which the v2
            theme overrides on <body> anyway; v2 gets its colour from the
            brand vars on <body> below instead. */}
        {v2Flags.theme ? null : (
          <script dangerouslySetInnerHTML={{ __html: brandingScript }} />
        )}
      </head>
      <body suppressHydrationWarning className={themeClass} style={brandStyle}>
        <V2Provider flags={v2Flags}>
          <Providers>{children}</Providers>
        </V2Provider>
      </body>
    </html>
  );
}
