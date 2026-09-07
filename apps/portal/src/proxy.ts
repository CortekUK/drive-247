import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';


// Domains that belong to us — NOT custom tenant domains
const PLATFORM_DOMAINS = ['drive-247.com', 'localhost', 'vercel.app'];

function isPlatformDomain(hostname: string): boolean {
  const host = hostname.split(':')[0];
  return PLATFORM_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') || '';

  // 1. Try subdomain extraction first (fast path — no DB call)
  let tenantSlug = extractTenantSlug(hostname);

  // 2. If no slug and not a platform domain, try custom portal domain lookup
  if (!tenantSlug && !isPlatformDomain(hostname)) {
    let host = hostname.split(':')[0];
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // A missing local .env must not crash every route. Custom-domain lookup is
    // unavailable without Supabase, but localhost and platform domains still
    // work normally.
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
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
  }

  // 3. The design playground always renders as the canary.
  //
  // `/playground/*` is a fake-data sandbox whose entire purpose is to preview
  // northwind's v2 look. That theme is applied by the ROOT layout as a class on
  // <body> (src/app/layout.tsx), and the v2 base rules are keyed on
  // `body.v2-theme` — the typeface, the 14px desktop base size and the font
  // smoothing all hang off that selector, so putting the class on a nested
  // wrapper <div> gets the colour tokens and none of the rest.
  //
  // A nested layout cannot reach <body>, so pinning the slug here is the only
  // place that can make the sandbox render byte-identically to the canary on
  // plain `localhost:4002`. Visiting `northwind.portal.localhost:4002` already
  // worked; this just removes the need to know that.
  //
  // Delete this block when the playground is folded into the real app.
  //
  // DEVELOPMENT ONLY. `/playground` is a top-level route — it sits OUTSIDE the
  // `(dashboard)` group, so it inherits no auth check — and this block pins it
  // to the canary on whatever host it is reached from. Without the guard below
  // that means `revtek.portal.drive-247.com/playground`, on every operator's
  // own domain, serving unreleased v2 screens to anyone on the internet.
  //
  // It is not a DATA leak (nothing under `playground/` touches Supabase,
  // `useTenant` or `useQuery` — verified), but unreleased product design on a
  // paying tenant's domain is not something to ship by omission.
  if (
    process.env.NODE_ENV === 'development' &&
    request.nextUrl.pathname.startsWith('/playground')
  ) {
    tenantSlug = 'northwind';
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
    // Re-included explicitly: the pattern above skips any path containing a dot,
    // so the manifest would never receive the x-tenant-slug header and every
    // tenant would be offered an install named after the PLATFORM instead of
    // their own brand. Same reason the favicon paths are listed.
    '/manifest.webmanifest',
  ],
};
