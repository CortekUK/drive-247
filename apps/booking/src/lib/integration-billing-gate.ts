/**
 * Mirror of apps/portal/src/lib/integration-billing/gate.ts — who has
 * integration billing (no e-sign credits). NORTHWIND ONLY, by slug. A test
 * pins this list equal to the portal's and the edge function's.
 */
export const INTEGRATION_BILLING_TENANTS: readonly string[] = ['northwind'];

export function isIntegrationBillingTenant(slug: string | null | undefined): boolean {
  return !!slug && INTEGRATION_BILLING_TENANTS.includes(slug);
}

/**
 * May this send skip credits? Only when the request's tenant is the tenant
 * that OWNS the rental, and that tenant's own row is on the list — so naming
 * northwind's id in a request can never make another tenant's send free.
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
