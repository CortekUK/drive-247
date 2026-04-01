import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Domains that belong to us — NOT custom tenant domains
const PLATFORM_DOMAINS = ['drive-247.com', 'localhost', 'vercel.app'];

function isPlatformDomain(hostname: string): boolean {
  const host = hostname.split(':')[0];
  return PLATFORM_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';

  // 1. Try subdomain extraction first (fast path — no DB call)
  let tenantSlug = extractSubdomain(hostname);

  // 2. If no subdomain and not a platform domain, try custom domain lookup
  if (!tenantSlug && !isPlatformDomain(hostname)) {
    // Strip port and www prefix
    let host = hostname.split(':')[0];
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    const { data } = await supabase
      .from('tenants')
      .select('slug')
      .eq('custom_booking_domain', host)
      .eq('status', 'active')
      .single();

    if (data) {
      tenantSlug = data.slug;
    }
  }

  // Add tenant context to headers so it's available in server components
  const requestHeaders = new Headers(request.headers);
  if (tenantSlug) {
    requestHeaders.set('x-tenant-slug', tenantSlug);
  }

  // Continue with the request
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

/**
 * Extract subdomain from hostname
 * Examples:
 * - "acme.localhost:3000" -> "acme"
 * - "acme.drive-247.com" -> "acme"
 * - "localhost:3000" -> null
 * - "drive-247.com" -> null
 * - "www.drive-247.com" -> null
 */
function extractSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0];
  const parts = host.split('.');

  // Handle localhost: "acme.localhost" -> "acme"
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
    const subdomain = parts[0];
    if (subdomain === 'localhost') {
      return null;
    }
    return subdomain;
  }

  // Handle production: "acme.drive-247.com" -> "acme"
  // Must have at least 3 parts (subdomain.domain.tld)
  // Exclude reserved subdomains that have their own Vercel projects
  const reservedSubdomains = ['www', 'admin', 'portal', 'api', 'app'];
  if (parts.length >= 3) {
    const subdomain = parts[0];
    if (reservedSubdomains.includes(subdomain)) {
      return null;
    }
    return subdomain;
  }

  return null;
}

// Configure which paths the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|public).*)',
  ],
};
