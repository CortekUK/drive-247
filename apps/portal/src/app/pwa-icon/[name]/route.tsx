import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * The installed portal's icon, drawn for the tenant whose portal this is.
 *
 *   /pwa-icon/192.png, /pwa-icon/512.png   manifest icons, purpose "any"
 *   /pwa-icon/512-maskable.png             manifest icon, purpose "maskable"
 *   /pwa-icon/180.png                      apple-touch-icon: iOS takes the Home
 *                                          Screen icon from here, not the manifest
 *
 * Before this route every operator's installed portal carried Drive247's own
 * icon from /icons, because the manifest and the apple-touch-icon were static
 * files, while the manifest's NAME was already the operator's ("Acme Ops").
 * Now:
 *
 *   - a tenant with a favicon gets it drawn on an opaque white square. Opaque
 *     on purpose: iOS flattens a transparent PNG onto black, and a maskable
 *     icon must fill its canvas. The maskable variant insets the picture to
 *     70% so it survives Android's circle / squircle masks (the safe zone is
 *     the central 80%).
 *   - a tenant without a favicon gets the first letter of its name on its
 *     brand colour, the way every chat and mail app marks an account with no
 *     picture. That is still the tenant's branding, not ours.
 *   - no tenant (the bare platform host) gets the platform icon from /icons.
 *
 * The path carries a ".png" so src/proxy.ts skips it (its matcher leaves
 * dotted paths alone), and the tenant is resolved from the Host header here
 * the same way the proxy does: "{tenant}.portal.…" first, then a custom
 * portal domain. Only raster favicons Satori can embed are drawn (PNG, JPEG,
 * GIF); an SVG or .ico favicon falls back to the letter mark.
 *
 * apps/booking/src/app/pwa-icon/[name]/route.tsx is this file for the
 * customer site; they differ only in how a host names a tenant.
 */

export const dynamic = 'force-dynamic';

interface IconSpec {
  size: number;
  maskable: boolean;
  /** The platform icon served when no tenant resolves or drawing fails. */
  fallback: string;
}

const SPECS: Record<string, IconSpec> = {
  '180.png': { size: 180, maskable: false, fallback: '/icons/apple-touch-icon.png' },
  '192.png': { size: 192, maskable: false, fallback: '/icons/icon-192.png' },
  '512.png': { size: 512, maskable: false, fallback: '/icons/icon-512.png' },
  '512-maskable.png': { size: 512, maskable: true, fallback: '/icons/maskable-512.png' },
};

const PLATFORM_DOMAINS = ['drive-247.com', 'localhost', 'vercel.app'];
const RESERVED_SUBDOMAINS = ['www', 'admin', 'portal', 'api', 'app', 'bonzah'];
const DEFAULT_BRAND = '#6333f7';

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

interface IconTenant {
  app_name: string | null;
  company_name: string | null;
  favicon_url: string | null;
  primary_color: string | null;
}

function isPlatformDomain(host: string): boolean {
  return PLATFORM_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Mirrors the proxy: "acme.portal.localhost" and "acme.localhost" -> "acme";
 * "acme.portal.drive-247.com" -> "acme"; anything else is not a slug.
 */
function slugFromHost(host: string): string | null {
  const parts = host.split('.');
  if (parts[parts.length - 1] === 'localhost') {
    if (parts.length >= 3 && parts[parts.length - 2] === 'portal') {
      return parts[0] && parts[0] !== 'portal' ? parts[0] : null;
    }
    if (parts.length === 2) return parts[0] && parts[0] !== 'localhost' ? parts[0] : null;
    return null;
  }
  if (parts.length >= 4 && parts[1] === 'portal' && isPlatformDomain(host)) {
    return RESERVED_SUBDOMAINS.includes(parts[0]) ? null : parts[0];
  }
  return null;
}

async function resolveTenant(hostHeader: string): Promise<IconTenant | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  let host = hostHeader.split(':')[0].toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);

  const supabase = createClient(supabaseUrl, anonKey);
  const columns = 'app_name, company_name, favicon_url, primary_color';

  const slug = slugFromHost(host);
  if (slug) {
    const { data } = await supabase.from('tenants').select(columns).eq('slug', slug).maybeSingle();
    return (data as IconTenant | null) ?? null;
  }
  if (!isPlatformDomain(host)) {
    const { data } = await supabase
      .from('tenants')
      .select(columns)
      .eq('custom_portal_domain', host)
      .eq('status', 'active')
      .maybeSingle();
    return (data as IconTenant | null) ?? null;
  }
  return null;
}

/** The favicon as a data URI Satori can embed, or null when it is not a raster it can draw. */
async function loadRaster(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|gif)$/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 2_000_000) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

function brandColour(value: string | null): string {
  return value && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : DEFAULT_BRAND;
}

/** White lettering on a dark brand, near-black on a light one. */
function letterColour(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return luminance > 0.5 ? '#111111' : '#ffffff';
}

function initial(tenant: IconTenant): string | null {
  const name = (tenant.app_name || tenant.company_name || '').trim();
  if (!name) return null;
  const first = Array.from(name)[0];
  return /\p{L}|\p{N}/u.test(first) ? first.toUpperCase() : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const spec = SPECS[name];
  if (!spec) return new NextResponse('Not found', { status: 404 });

  const fallback = () => NextResponse.redirect(new URL(spec.fallback, request.url), 307);

  try {
    const tenant = await resolveTenant(request.headers.get('host') || '');
    if (!tenant) return fallback();

    const { size, maskable } = spec;
    const raster = tenant.favicon_url ? await loadRaster(tenant.favicon_url) : null;

    let picture: React.ReactElement;
    if (raster) {
      // 70% inside the maskable canvas keeps the picture clear of every mask shape.
      const inner = maskable ? Math.round(size * 0.7) : size;
      picture = (
        <div
          style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
          }}
        >
          <img src={raster} width={inner} height={inner} style={{ objectFit: 'contain' }} alt="" />
        </div>
      );
    } else {
      const letter = initial(tenant);
      if (!letter) return fallback();
      const bg = brandColour(tenant.primary_color);
      picture = (
        <div
          style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: bg,
            color: letterColour(bg),
            fontSize: Math.round(size * 0.56),
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {letter}
        </div>
      );
    }

    return new ImageResponse(picture, {
      width: size,
      height: size,
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
  } catch (error) {
    console.error('[pwa-icon] Falling back to the platform icon:', error);
    return fallback();
  }
}
