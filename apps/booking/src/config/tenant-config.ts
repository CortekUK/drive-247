/**
 * Tenant-specific configuration
 * Used for applying custom business logic per tenant
 */

// Kedic Services - Insurance exempt tenant
export const KEDIC_TENANT_ID = 'e4b0fe9d-f064-421a-9618-9e997f7c1c2d';

/**
 * Check if a tenant is exempt from insurance requirements
 * These tenants skip the insurance verification step in the booking flow
 */
export const isInsuranceExemptTenant = (tenantId: string | undefined | null): boolean => {
  if (!tenantId) return false;
  return tenantId === KEDIC_TENANT_ID;
};
