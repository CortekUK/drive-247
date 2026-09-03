import type { Metadata } from "next";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import { createClient } from "@supabase/supabase-js";
import { Providers } from "./providers";
import "@/global.css";
// Scoped v2 design tokens. Inert unless <body> carries `v2-theme`, which is
// decided per-tenant below — so importing it changes nothing for v1 tenants.
import "@/styles/v2-theme.css";
import { isV2, type V2Area } from "@/lib/v2";
import { V2Provider, type V2Flags } from "@/lib/v2-context";
import { tenantSlugFromHeaders } from "@/lib/tenant-server";

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

export async function generateMetadata(): Promise<Metadata> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (!tenantSlug) return defaultMetadata;

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return defaultMetadata;
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data: tenant } = await supabase
      .from("tenants")
      .select(
        "app_name, company_name, meta_title, meta_description, favicon_url, og_image_url"
      )
      .eq("slug", tenantSlug)
      .single();

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
  // The v2 theme gate, resolved on the server so the page paints correctly on
  // the first byte. `tenantSlugFromHeaders` never throws and returns null on any
  // failure, so a lookup problem leaves every tenant on the v1 theme rather
  // than repainting them.
  const tenantSlug = await tenantSlugFromHeaders();

  // Every gate for this request, answered once. Client components read these
  // through useV2() instead of looking the tenant up again — see lib/v2-context.
  const v2Areas: V2Area[] = [
    "appearance",
    "theme",
    "dashboard",
    "chrome",
    "login",
    "rentals",
  ];
  const v2Flags: V2Flags = Object.fromEntries(
    v2Areas.map((a) => [a, isV2(a, tenantSlug)])
  );

  const themeClass = v2Flags.theme ? "v2-theme" : undefined;
  // The font variable rides with the theme gate, so v1 tenants are untouched.
  const fontClass = v2Flags.theme ? manrope.variable : undefined;

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
        <script dangerouslySetInnerHTML={{ __html: brandingScript }} />
      </head>
      <body suppressHydrationWarning className={themeClass}>
        <V2Provider flags={v2Flags}>
          <Providers>{children}</Providers>
        </V2Provider>
      </body>
    </html>
  );
}
