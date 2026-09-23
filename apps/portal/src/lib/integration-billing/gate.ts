/**
 * Who has integration billing — premium integrations on the platform bill,
 * and no e-sign credits (docs/integration-billing/build-spec.md, D1).
 *
 * NORTHWIND ONLY, BY SLUG, and deliberately NOT a `V2Area` in lib/v2.ts:
 * `isV2()` also answers true for every `portal_experience = 'v2'` tenant, and
 * this changes real billing — "northwind gets it, every other tenant keeps
 * their current billing". Widening it is adding a slug here AND in the two
 * mirrors below, which a test pins equal:
 *   apps/booking/src/lib/integration-billing-gate.ts
 *   supabase/functions/integration-billing/gate.ts
 *
 * PURE and dependency-free, so server routes (/api/esign) and client hooks
 * import the same answer.
 */
import { NORTHWIND } from '@/lib/v2';

export const INTEGRATION_BILLING_TENANTS: readonly string[] = [NORTHWIND];

export function isIntegrationBillingTenant(slug: string | null | undefined): boolean {
  return !!slug && INTEGRATION_BILLING_TENANTS.includes(slug);
}

/**
 * May a SERVER send skip credits for this rental?
 *
 * Only when the tenant named in the request is the tenant that OWNS the rental
 * and that tenant (its row's slug, read by that id) is on the list. Both
 * esign routes take `tenantId` from the request body; without the ownership
 * check, naming northwind's id would make another tenant's send free.
 */
export function creditsRetiredForSend(input: {
  requestTenantId: string | null | undefined;
  rentalTenantId: string | null | undefined;
  tenantSlug: string | null | undefined;
}): boolean {
  return (
    !!input.requestTenantId &&
    !!input.rentalTenantId &&
    input.requestTenantId === input.rentalTenantId &&
    isIntegrationBillingTenant(input.tenantSlug)
  );
}
