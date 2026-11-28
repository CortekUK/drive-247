// =============================================================================
// drive247-sites — our own sites, as a FIXED list (review 1, Ghulam 28 Nov 2026).
//
// Staging, ray1, ray2 and ray3 share one database, so they share one
// PORTAL_ROOT_DOMAIN and a setting cannot say which portal a signup belongs to.
// The site a signup came from (the request's Origin) picks it instead, but ONLY
// from this list: an address the browser sends that is not on it is never used
// (answers 2.2 and 2.7). Anything else falls back to today's behaviour.
//
// Pure (no Deno, no network) so it can be tested in Node.
// =============================================================================

export interface Drive247Site {
  /** host[:port] values that count as this site, lowercase */
  hosts: readonly string[];
  /** Where "finish later" sends someone back to (answer 2.7). */
  siteUrl: string;
  /** The portal root a tenant's portal sits under: https://{slug}.{portalRoot} (answer 2.2). */
  portalRoot: string;
  /** http for localhost, https everywhere else. */
  protocol: "https" | "http";
}

export const DRIVE247_SITES: readonly Drive247Site[] = [
  { hosts: ["drive-247.com", "www.drive-247.com"], siteUrl: "https://www.drive-247.com", portalRoot: "portal.drive-247.com", protocol: "https" },
  { hosts: ["staging.drive-247.com"], siteUrl: "https://staging.drive-247.com", portalRoot: "portal.staging.drive-247.com", protocol: "https" },
  { hosts: ["ray1.drive-247.com"], siteUrl: "https://ray1.drive-247.com", portalRoot: "portal.ray1.drive-247.com", protocol: "https" },
  { hosts: ["ray2.drive-247.com"], siteUrl: "https://ray2.drive-247.com", portalRoot: "portal.ray2.drive-247.com", protocol: "https" },
  { hosts: ["ray3.drive-247.com"], siteUrl: "https://ray3.drive-247.com", portalRoot: "portal.ray3.drive-247.com", protocol: "https" },
  { hosts: ["localhost:4003"], siteUrl: "http://localhost:4003", portalRoot: "portal.localhost:4002", protocol: "http" },
];

/** The default "finish later" site: www, as before review 1. */
export const DEFAULT_SITE_URL = "https://www.drive-247.com";

/**
 * Which of our sites a request came from, or null. `origin` is the request's
 * Origin header (or any URL on the site). The scheme must match the site's
 * own (https, or http for localhost), so `http://ray2.drive-247.com` is not ray2.
 */
export function siteForOrigin(origin: string | null | undefined): Drive247Site | null {
  if (!origin || typeof origin !== "string") return null;
  let url: URL;
  try {
    url = new URL(origin.trim());
  } catch {
    return null;
  }
  const host = url.host.toLowerCase();
  const protocol = url.protocol.replace(":", "");
  return DRIVE247_SITES.find((s) => s.hosts.includes(host) && s.protocol === protocol) ?? null;
}

/**
 * A tenant's portal address for a signup from `origin` (answer 2.2):
 * `https://{slug}.portal.ray2.drive-247.com` for a ray2 signup, and so on.
 * Not one of our sites: `fallback(slug)`, which is today's PORTAL_ROOT_DOMAIN.
 */
/**
 * The portal address for someone coming BACK to a signup that was already
 * provisioned (a second tab, a retry, a returning Google user). The site they
 * are on now wins over the address saved on the first run: a business set up
 * from ray3 and reopened from ray2 belongs on the ray2 portal, both sharing
 * the staging database. Only when the request is not from one of our sites
 * does the saved address (or the default) stand.
 */
export function portalUrlForReturn(
  origin: string | null | undefined,
  slug: string,
  saved: string | null | undefined,
  fallback: (slug: string) => string,
): string {
  const site = siteForOrigin(origin);
  if (site) return `${site.protocol}://${slug}.${site.portalRoot}`;
  return saved ?? fallback(slug);
}

/**
 * A sign-in link saved on the first run lands on the portal address of THAT
 * run. When the address has changed, the link would sign them in somewhere
 * else, so it is dropped and they sign in on the new portal instead.
 */
export function signInUrlFor(
  savedSignInUrl: string | null | undefined,
  savedPortalUrl: string | null | undefined,
  portalUrl: string,
): string | null {
  if (!savedSignInUrl) return null;
  return savedPortalUrl && savedPortalUrl !== portalUrl ? null : savedSignInUrl;
}

export function portalUrlForSignup(
  origin: string | null | undefined,
  slug: string,
  fallback: (slug: string) => string,
): string {
  const site = siteForOrigin(origin);
  return site ? `${site.protocol}://${slug}.${site.portalRoot}` : fallback(slug);
}

/** Where a "finish later" link goes back to (answer 2.7). Not one of ours: www. */
export function finishLaterSiteFor(origin: string | null | undefined): string {
  return siteForOrigin(origin)?.siteUrl ?? DEFAULT_SITE_URL;
}
