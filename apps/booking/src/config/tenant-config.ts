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

/**
 * Check if a tenant uses enquiry-based booking
 * For these tenants:
 * - Only security deposit is charged upfront (if any)
 * - If no security deposit, no payment at all - rental created as enquiry
 * - Rental charges are collected later (not upfront)
 */
export const isEnquiryBasedTenant = (tenantId: string | undefined | null): boolean => {
  if (!tenantId) return false;
  return tenantId === KEDIC_TENANT_ID;
};

/**
 * Per-tenant legal-entity notation shown on the server-rendered compliance
 * pages (/privacy, /terms, /sms-opt-in). Carrier A2P 10DLC reviewers must be
 * able to connect the public brand name on the page to the legal entity on
 * the registered messaging Brand — without this line the pages appear to
 * belong to a different company and campaign vetting fails (errors
 * 30908/30882). Keyed by tenant slug. Only listed tenants get a line; all
 * others render nothing extra.
 */
const TENANT_LEGAL_ENTITY_LINES: Record<string, string> = {
  revtekrentals:
    'RevTek Rentals is a trade name of RevTek Capital Holdings, LLC. This website is operated on the Drive247 booking platform; RevTek Rentals is the sole sender of SMS messages and sole holder of customer messaging consent.',
};

export const getTenantLegalEntityLine = (slug: string | undefined | null): string | null => {
  if (!slug) return null;
  return TENANT_LEGAL_ENTITY_LINES[slug] ?? null;
};
