/**
 * Who has integration billing: premium integrations on the platform bill, and
 * no e-sign credits (docs/integration-billing/build-spec.md, D1).
 *
 * NORTHWIND ONLY, BY SLUG, and deliberately not a V2Area: `isV2()` also
 * answers true for every `portal_experience = 'v2'` tenant, and this touches
 * real billing — "northwind gets it, every other tenant keeps their current
 * billing". The same one-line list lives in
 *   apps/portal/src/lib/integration-billing/gate.ts
 *   apps/booking/src/lib/integration-billing-gate.ts
 * and a test pins the three copies equal.
 */
export const INTEGRATION_BILLING_TENANTS: readonly string[] = ['northwind'];

export function isIntegrationBillingTenant(slug: string | null | undefined): boolean {
  return !!slug && INTEGRATION_BILLING_TENANTS.includes(slug);
}
