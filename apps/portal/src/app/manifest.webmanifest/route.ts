/**
 * Per-tenant PWA manifest for the OPERATOR portal.
 *
 * Same reasoning as the booking app's: the portal is multi-tenant, so the
 * installed app has to carry the operator's own name. Resolved from the
 * `x-tenant-slug` header the middleware injects.
 *
 * Named "<Company> Ops" rather than just the company name because an operator
 * may well install the customer booking site too — two Home Screen icons with
 * the same label is a support call waiting to happen.
 */

import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { portalAppName, portalAppShortName, pwaIconPath, pwaIconVersion } from '@/lib/pwa-manifest';

export const dynamic = 'force-dynamic';

const FALLBACK_NAME = 'Drive247 Ops';
// Drive247 brand purple, sampled from the mark's ring gradient.
const FALLBACK_THEME = '#6333f7';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

/** The platform's own icons, for a request no tenant answers to. */
const PLATFORM_ICONS: ManifestIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/**
 * The operator's icons, drawn on request by app/pwa-icon/[name]/route.tsx:
 * their favicon on an opaque square at exactly these sizes, or the first
 * letter of their name on their brand colour when they have none. Until this
 * the manifest said "Acme Ops" over Drive247's icon for every operator.
 */
/**
 * Versioned per tenant (lib/pwa-manifest): the route caches for a day at the
 * CDN, so a changed icon must be a changed URL to reach a reopened app.
 */
const tenantIcons = (version: string): ManifestIcon[] => [
  { src: pwaIconPath('192.png', version), sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: pwaIconPath('512.png', version), sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: pwaIconPath('512-maskable.png', version), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

export async function GET() {
  let name = FALLBACK_NAME;
  let shortName = 'Ops';
  let themeColor = FALLBACK_THEME;
  let icons = PLATFORM_ICONS;

  try {
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');

    if (tenantSlug && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      );
      const { data: tenant } = await supabase
        .from('tenants')
        .select('app_name, company_name, primary_color, favicon_url')
        .eq('slug', tenantSlug)
        .maybeSingle();

      // The portal name (Settings → Branding) when the tenant set one, else
      // the company name — the same rule the icon's initial follows.
      const appName = portalAppName(tenant?.app_name, tenant?.company_name);
      if (tenant && appName) {
        name = appName;
        // iOS clips the Home Screen label around 12 characters.
        shortName = portalAppShortName(tenant.app_name, tenant.company_name) ?? shortName;
        // The installed app's title bar and splash take the operator's brand
        // colour, as the v2 portal itself does.
        if (tenant.primary_color && /^#[0-9a-f]{6}$/i.test(tenant.primary_color)) {
          themeColor = tenant.primary_color;
        }
        icons = tenantIcons(pwaIconVersion([tenant.favicon_url, tenant.primary_color, tenant.app_name || tenant.company_name]));
      }
    }
  } catch (error) {
    console.error('[portal manifest] Falling back to defaults:', error);
  }

  const manifest = {
    name,
    short_name: shortName,
    description: 'Manage your fleet, bookings and customers.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: themeColor,
    icons,
    categories: ['business', 'productivity'],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}
