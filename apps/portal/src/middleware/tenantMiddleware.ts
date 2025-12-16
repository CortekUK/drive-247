/**
 * Tenant Middleware Utilities
 *
 * This file provides middleware functionality for tenant awareness in the vexa-portal-1 React app.
 * Since this is not a Next.js app, we implement middleware as React hooks and utilities.
 */

/**
 * Extract subdomain from hostname
 * Examples:
 * - "acme.localhost:8080" -> "acme"
 * - "acme.drive-247.com" -> "acme"
 * - "localhost:8080" -> null
 * - "drive-247.com" -> null
 * - "www.drive-247.com" -> null
 */
export function extractSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0];
  const parts = host.split('.');

  // Handle localhost: "acme.localhost" -> "acme"
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
    return parts[0] !== 'localhost' ? parts[0] : null;
  }

  // Handle production: "acme.drive-247.com" -> "acme"
  // Must have at least 3 parts (subdomain.domain.tld)
  // Exclude common non-tenant subdomains like "www", "admin", "super-admin"
  if (parts.length >= 3 && !['www', 'admin', 'super-admin'].includes(parts[0])) {
    return parts[0];
  }

  return null;
}

/**
 * Get the current tenant slug from the URL
 */
export function getCurrentTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  return extractSubdomain(window.location.hostname);
}

/**
 * Check if the current request is for a tenant subdomain
 */
export function isTenantRequest(): boolean {
  return getCurrentTenantSlug() !== null;
}

/**
 * Redirect to tenant subdomain
 */
export function redirectToTenant(tenantSlug: string): void {
  if (typeof window === 'undefined') return;

  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;
  const pathname = window.location.pathname;

  // Build the new URL with tenant subdomain
  let newHostname: string;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // Development: tenant.localhost:8080
    newHostname = `${tenantSlug}.localhost`;
  } else {
    // Production: tenant.drive-247.com
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      // Replace or add subdomain
      parts[0] = tenantSlug;
      newHostname = parts.join('.');
    } else {
      newHostname = `${tenantSlug}.${hostname}`;
    }
  }

  const portString = port ? `:${port}` : '';
  const newUrl = `${protocol}//${newHostname}${portString}${pathname}`;

  window.location.href = newUrl;
}

/**
 * Redirect to main domain (remove tenant subdomain)
 */
export function redirectToMainDomain(): void {
  if (typeof window === 'undefined') return;

  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;
  const pathname = window.location.pathname;

  // Build the URL without tenant subdomain
  let newHostname: string;

  if (hostname.includes('localhost')) {
    newHostname = 'localhost';
  } else {
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      // Remove subdomain
      newHostname = parts.slice(1).join('.');
    } else {
      newHostname = hostname;
    }
  }

  const portString = port ? `:${port}` : '';
  const newUrl = `${protocol}//${newHostname}${portString}${pathname}`;

  window.location.href = newUrl;
}
