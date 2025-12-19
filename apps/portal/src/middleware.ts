import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';

  // Extract tenant slug from hostname
  const tenantSlug = extractTenantSlug(hostname);

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

  // Handle localhost: "acme.portal.localhost" → "acme"
  // Pattern: {tenant}.portal.localhost
  if (parts.length >= 3 && parts[parts.length - 1] === 'localhost' && parts[parts.length - 2] === 'portal') {
    const tenant = parts[0];
    if (tenant && tenant !== 'portal') {
      return tenant;
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
