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

const FALLBACK_NAME = 'Car Rental';
// Drive247 brand purple, sampled from the mark's ring gradient.
const FALLBACK_THEME = '#6333f7';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/**
 * The platform's own icons, correctly sized and composited onto an opaque
 * background. Used only when no tenant resolves, so an install never lands on
 * a broken icon.
 */
const LOCAL_ICONS: ManifestIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/**
 * The tenant's icons, drawn on request by app/pwa-icon/[name]/route.tsx: the
 * tenant's favicon on an opaque square at exactly these sizes, or the first
 * letter of its name on its brand colour when it has none. Until this, a
 * tenant without a favicon installed with Drive247's icon, and one with a
 * favicon had it listed at a size it probably was not, with no maskable
 * variant, so Android's masks cropped it.
 */
const TENANT_ICONS: ManifestIcon[] = [
  { src: '/pwa-icon/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/pwa-icon/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/pwa-icon/512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
        .select('app_name, company_name, meta_description, primary_color')
        .eq('slug', tenantSlug)
        .maybeSingle();

      if (tenant) {
        name = tenant.app_name || tenant.company_name || FALLBACK_NAME;
        // iOS truncates the home-screen label at roughly 12 characters; sending a
        // long string just gets it clipped mid-word.
        shortName = name.length > 12 ? name.slice(0, 12).trim() : name;
        description = tenant.meta_description || `Book your next vehicle with ${name}.`;
        themeColor = tenant.primary_color || FALLBACK_THEME;
        // The icon route reads the favicon itself (and falls back to the
        // platform icon when drawing fails), so nothing here can break an install.
        icons = TENANT_ICONS;
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
    // Matches the icon's own ground, so the PWA splash screen does not show a
    // white icon floating on black.
    background_color: '#ffffff',
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
