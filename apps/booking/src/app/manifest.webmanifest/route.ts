/**
 * Per-tenant PWA manifest.
 *
 * This is a route handler rather than Next's static `app/manifest.ts` because
 * the booking app is multi-tenant: the manifest has to be resolved from the
 * `x-tenant-slug` header the middleware injects, exactly like `generateMetadata`
 * in the root layout. A static manifest would install RevTek's customers an app
 * called "Drive 247" with Drive247's icon — the operator's brand is the whole
 * point of them having their own booking domain.
 *
 * iOS reads this ONCE, at "Add to Home Screen". Renaming a tenant later does not
 * rename an already-installed icon on anyone's phone.
 */

import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Branding changes must not require a redeploy to reach an install prompt, but
// this is hit on every page load, so it is cached briefly and revalidated.
export const revalidate = 0;
export const dynamic = 'force-dynamic';

const FALLBACK_NAME = 'Drive 247';
const FALLBACK_THEME = '#0a0a0e';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/**
 * Locally generated icons, correctly sized and composited onto an opaque
 * background. Always present, so an install never lands on a broken icon.
 */
const LOCAL_ICONS: ManifestIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

export async function GET() {
  let name = FALLBACK_NAME;
  let shortName = FALLBACK_NAME;
  let themeColor = FALLBACK_THEME;
  let description = 'Book your next vehicle in minutes.';
  let icons = LOCAL_ICONS;

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
        .select('app_name, company_name, meta_description, favicon_url, primary_color')
        .eq('slug', tenantSlug)
        .maybeSingle();

      if (tenant) {
        name = tenant.app_name || tenant.company_name || FALLBACK_NAME;
        // iOS truncates the home-screen label at roughly 12 characters; sending a
        // long string just gets it clipped mid-word.
        shortName = name.length > 12 ? name.slice(0, 12).trim() : name;
        description = tenant.meta_description || `Book your next vehicle with ${name}.`;
        themeColor = tenant.primary_color || FALLBACK_THEME;

        // A favicon is square by convention, which a logo very often is not — a
        // wide logo squeezed into a square icon slot is the usual way tenant
        // branding makes an install look broken. Only the favicon is promoted,
        // and the local set stays behind it as a guaranteed fallback.
        if (tenant.favicon_url) {
          icons = [
            { src: tenant.favicon_url, sizes: '192x192', type: 'image/png', purpose: 'any' },
            ...LOCAL_ICONS,
          ];
        }
      }
    }
  } catch (error) {
    console.error('[manifest] Falling back to defaults:', error);
  }

  const manifest = {
    name,
    short_name: shortName,
    description,
    // Land on the customer portal, not marketing — someone who installed the app
    // is a customer, and the query flag lets analytics separate app from web.
    start_url: '/portal?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0e',
    theme_color: themeColor,
    icons,
    categories: ['travel', 'business'],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}
