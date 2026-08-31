/**
 * Production tenant sites are served from HYPHENATED `drive-247.com`
 * (`{tenant}.drive-247.com`). The unhyphenated spelling used to live here, so
 * every real production host fell through subdomain extraction and resolved to
 * no tenant at all.
 */
export const BASE_DOMAIN = "drive-247.com";

/** Request header the middleware uses to hand the resolved slug to the server tree. */
export const TENANT_HEADER = "x-tenant-slug";

/**
 * Subdomains that have their own deployment and are never a tenant slug.
 * Kept in sync with apps/booking/src/middleware.ts.
 */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "admin",
  "portal",
  "api",
  "app",
  "bonzah",
]);

/** Hosts that belong to the platform — never a tenant's own custom domain. */
const PLATFORM_HOST_SUFFIXES = [BASE_DOMAIN, "localhost", "vercel.app"];

/**
 * True when the host is one of ours, so a custom-domain lookup would be wasted.
 * `127.0.0.1` is included because it is the loopback spelling Next prints.
 */
export function isPlatformHost(host: string): boolean {
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname || hostname === "127.0.0.1") return true;
  return PLATFORM_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

/**
 * Pull a tenant slug out of a hostname, or null when there is none.
 *
 *   "acme.localhost:3000"  -> "acme"
 *   "acme.drive-247.com"   -> "acme"
 *   "www.drive-247.com"    -> null (reserved)
 *   "localhost:3000"       -> null
 *   "acme-rentals.com"     -> null (custom domain — needs a DB lookup)
 *
 * Deliberately returns null rather than a fallback: the caller decides whether a
 * dev-only default is appropriate. Shared by the middleware and TenantContext so
 * the server header and the client-side resolution can never disagree.
 */
export function extractTenantSlugFromHost(host: string): string | null {
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname) return null;

  const parts = hostname.split(".");

  // Local development: "acme.localhost" -> "acme"
  if (parts.length >= 2 && parts[parts.length - 1] === "localhost") {
    const slug = parts[0];
    if (!slug || slug === "localhost") return null;
    return RESERVED_SUBDOMAINS.has(slug) ? null : slug;
  }

  // Production: "acme.drive-247.com" -> "acme"
  if (hostname === BASE_DOMAIN || !hostname.endsWith(`.${BASE_DOMAIN}`)) {
    return null;
  }

  const slug = hostname.slice(0, -1 - BASE_DOMAIN.length).split(".")[0];
  if (!slug) return null;
  return RESERVED_SUBDOMAINS.has(slug) ? null : slug;
}

/**
 * Tenant slug used when the host carries none. Gated on development so a
 * production host that fails to resolve serves NO tenant instead of serving one
 * arbitrary tenant's data to every visitor.
 */
export const DEV_FALLBACK_TENANT_SLUG: string | null =
  process.env.NODE_ENV === "development" ||
  // Vercel PREVIEW builds only. A preview is served from a bare
  // *.vercel.app host, which carries no tenant subdomain, so without this a
  // reviewer opening the deployment link sees a tenantless shell. Vercel sets
  // VERCEL_ENV itself and it is 'production' on production deployments, so
  // this can never widen the rule there — the guarantee above still holds
  // where it matters.
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
    ? process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || null
    : null;

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/fleet", label: "Fleet and Pricing" },
  { href: "/reviews", label: "Reviews" },
  { href: "/promotions", label: "Promotions" },
  { href: "/contact", label: "Contact" },
] as const;

export const FOOTER_LINKS = {
  Company: [
    { href: "/about", label: "About us" },
    { href: "/contact", label: "Contact us" },
    { href: "/careers", label: "Careers" },
    { href: "/press", label: "Press" },
  ],
  "Popular Models": [
    { href: "/fleet/audi-a4", label: "Audi A4" },
    { href: "/fleet/porsche-911", label: "Porsche 911 Carrera" },
    { href: "/fleet/mercedes-e-class", label: "Mercedes-Benz E-Class" },
    { href: "/fleet/bmw-m4", label: "BMW M4" },
    { href: "/fleet/lexus-es-350", label: "Lexus ES 350" },
  ],
  Services: [
    { href: "/fleet", label: "Fleet and Pricing" },
    { href: "/booking", label: "Book a Vehicle" },
    { href: "/promotions", label: "Promotions" },
  ],
  Legal: [
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms", label: "Terms & Conditions" },
    { href: "/return-policy", label: "Return Policy" },
  ],
} as const;

export const CONTACT_INFO = {
  email: "support@carrentals.io",
  phone: "+133-394-3439-1435",
} as const;
