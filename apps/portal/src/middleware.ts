import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server-only client used for the subscription gate. Service role is required
// to read tenant_subscriptions / subscription_plans without a user session —
// the middleware runs before client-side React, so we can't use the user JWT.
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  : null;

// Paths a tenant MUST be able to reach even when unsubscribed, otherwise
// they'd have no way to subscribe, manage billing, contact support, or log in.
const SUBSCRIPTION_EXEMPT_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/subscription',
  '/credits',
  '/settings',
];

function isExemptPath(pathname: string): boolean {
  return SUBSCRIPTION_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
}

/**
 * Returns true if the tenant has an active/trialing/past_due subscription,
 * OR has no configured plans (in which case the gate would be unrecoverable —
 * super admin needs to set up plans before we can block them).
 *
 * Fails OPEN (returns true) on any error so we don't take everyone offline
 * during a DB hiccup. The client-side gate is still in place as a backstop.
 */
async function tenantHasSubscriptionOrNoPlans(tenantSlug: string): Promise<boolean> {
  if (!supabaseAdmin) return true;
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', tenantSlug)
      .eq('status', 'active')
      .maybeSingle();

    if (!tenant?.id) return true;

    const { data: activeSub } = await supabaseAdmin
      .from('tenant_subscriptions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .in('status', ['active', 'trialing', 'past_due'])
      .maybeSingle();

    if (activeSub) return true;

    const { count: planCount } = await supabaseAdmin
      .from('subscription_plans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('is_active', true);

    // No plans configured → can't subscribe → don't lock them out.
    return !planCount || planCount === 0;
  } catch (err) {
    console.error('[middleware] subscription gate check failed:', err);
    return true;
  }
}

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

  // Add tenant context to headers so it's available in server components
  const requestHeaders = new Headers(request.headers);
  if (tenantSlug) {
    requestHeaders.set('x-tenant-slug', tenantSlug);
  }

  // Hard server-side subscription gate. Runs before any page renders, so a
  // tenant without an active subscription literally cannot reach the dashboard
  // — no client-side bypass possible. Exempt paths (/login, /subscription,
  // /settings, etc.) are always allowed so the user can recover.
  if (tenantSlug && !isExemptPath(request.nextUrl.pathname)) {
    const allowed = await tenantHasSubscriptionOrNoPlans(tenantSlug);
    if (!allowed) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/subscription';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl, { status: 307 });
    }
  }

  // Continue with the request
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
