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

export const dynamic = 'force-dynamic';

const FALLBACK_NAME = 'Drive247 Ops';
// Drive247 brand purple, sampled from the mark's ring gradient.
const THEME = '#6333f7';

export async function GET() {
  let name = FALLBACK_NAME;
  let shortName = 'Ops';

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
        .select('company_name')
        .eq('slug', tenantSlug)
        .maybeSingle();

      if (tenant?.company_name) {
        name = `${tenant.company_name} Ops`;
        // iOS clips the Home Screen label around 12 characters.
        shortName = tenant.company_name.length > 12
          ? tenant.company_name.slice(0, 12).trim()
          : tenant.company_name;
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
    theme_color: THEME,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    categories: ['business', 'productivity'],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}
