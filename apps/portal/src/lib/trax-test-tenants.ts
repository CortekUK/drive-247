/**
 * Local manual testing only. Names tenants (by slug) that may use the V2 TRAX assistant under
 * `next dev` without being enrolled in the V2 rollout, e.g.
 *   NEXT_PUBLIC_TRAX_TEST_TENANTS=test,jangramrentals
 * Ignored in every non-development build, so production follows `isV2('chrome')` only.
 * Everything else still comes from the selected tenant: its staff access, records and Stripe
 * routing (platform, mode and connected account).
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function parseTraxTestTenants(value: string | undefined): string[] {
  const slugs = (value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => SLUG.test(s));
  return [...new Set(slugs)].slice(0, 20);
}

export function traxTestTenantSlugs(): string[] {
  // Literal property access so Next inlines both values into the client bundle.
  if (process.env.NODE_ENV !== 'development') return [];
  return parseTraxTestTenants(process.env.NEXT_PUBLIC_TRAX_TEST_TENANTS);
}

export function isTraxTestTenant(slug: string | null | undefined): boolean {
  return !!slug && traxTestTenantSlugs().includes(slug);
}
