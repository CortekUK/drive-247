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
  let tenantSlug = extractTenantSlug(hostname);

  // 2. If no slug and not a platform domain, try custom portal domain lookup
  if (!tenantSlug && !isPlatformDomain(hostname)) {
    let host = hostname.split(':')[0];
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    const { data } = await supabase
      .from('tenants')
      .select('slug')
      .eq('custom_portal_domain', host)
      .eq('status', 'active')
      .single();

    if (data) {
      tenantSlug = data.slug;
    }
  }

  // Add tenant context to headers so it's available in server components.
  const requestHeaders = new Headers(request.headers);
  if (tenantSlug) {
    requestHeaders.set('x-tenant-slug', tenantSlug);
  }

  // Continue with the request — we deliberately DO NOT redirect unsubscribed
  // tenants. The dashboard layout mounts SubscriptionGateDialog as a hard,
  // non-dismissible modal (no escape, no outside-click, no close button) that
  // blocks all interaction with the page beneath. Redirecting would skip the
  // modal and dump the user on the plain /subscription page, losing the
  // in-context block. The modal + edge-function subscription-gate helper
  // provide the hard enforcement; RLS already protects data access.
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

/**
 * Extract tenant slug from hostname for portal app
 * Portal uses the pattern: {tenant}.portal.domain.com
 * Examples:
 * - "acme.portal.localhost:3001" → "acme"
 * - "acme.portal.drive-247.com" → "acme"
 * - "fleetvana.portal.drive-247.com" → "fleetvana"
 * - "portal.localhost:3001" → null (no tenant)
 * - "portal.drive-247.com" → null (no tenant)
 */
// Subdomains with their own Vercel deployments — never treat as tenant slugs.
const RESERVED_SUBDOMAINS = ['www', 'admin', 'portal', 'api', 'app', 'bonzah'];

function extractTenantSlug(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0];
  const parts = host.split('.');

  // Handle localhost: "acme.portal.localhost" → "acme" or "acme.localhost" → "acme"
  if (parts[parts.length - 1] === 'localhost') {
    // Pattern: {tenant}.portal.localhost
    if (parts.length >= 3 && parts[parts.length - 2] === 'portal') {
      const tenant = parts[0];
      if (tenant && tenant !== 'portal') {
        return tenant;
      }
      return null;
    }
    // Pattern: {tenant}.localhost
    if (parts.length === 2) {
      const tenant = parts[0];
      if (tenant && tenant !== 'localhost') {
        return tenant;
      }
      return null;
    }
    return null;
  }

  // Handle production: "acme.portal.drive-247.com" → "acme"
  // Pattern: {tenant}.portal.{domain}.{tld}
  // Must have at least 4 parts: tenant.portal.domain.tld
  if (parts.length >= 4 && parts[1] === 'portal') {
    const tenant = parts[0];
    if (RESERVED_SUBDOMAINS.includes(tenant)) return null;
    return tenant;
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
