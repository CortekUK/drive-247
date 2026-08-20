/**
 * PWA manifest for the super-admin dashboard.
 *
 * Static, unlike the booking and portal manifests: the admin app is
 * platform-level, not multi-tenant, so there is no tenant to resolve and no
 * `x-tenant-slug` header to read.
 *
 * Named and iconed distinctly from the operator portal on purpose — an admin
 * may well have both installed, and two indistinguishable home-screen icons is
 * a real way to end up looking at the wrong dashboard.
 */

export const dynamic = 'force-static';

export function GET() {
  const manifest = {
    name: 'Drive247 Admin',
    short_name: 'D247 Admin',
    description: 'Platform activity and tenant oversight.',
    start_url: '/admin/dashboard?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches the icon's own ground, so the splash screen does not show a white
    // icon floating on black.
    background_color: '#ffffff',
    theme_color: '#6333f7',
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
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
