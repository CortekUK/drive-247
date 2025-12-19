import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';

  // Extract subdomain from hostname
  const subdomain = extractSubdomain(hostname);

  // Add tenant context to headers so it's available in server components
  const requestHeaders = new Headers(request.headers);
  if (subdomain) {
    requestHeaders.set('x-tenant-slug', subdomain);
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
