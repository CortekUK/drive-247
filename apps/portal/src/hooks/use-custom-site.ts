"use client";

import { useTenant } from "@/contexts/TenantContext";

/**
 * Whether this tenant's custom website is live.
 *
 * Both halves have to be true: the platform must have made the tenant eligible,
 * and a super admin must have turned the switch on. They are separate columns
 * so an operator can be switched off without losing eligibility, and so an
 * ineligible tenant cannot be switched on at all — the database enforces the
 * second rule with a trigger, whatever any client believes.
 *
 * This is the single place the portal asks the question, so the menu entry, the
 * route guard and anything added later cannot drift apart.
 */
export function useCustomSiteEnabled(): { enabled: boolean; ready: boolean } {
  const { tenant, loading } = useTenant();
  return {
    enabled: !!tenant?.booking_v2_enabled && !!tenant?.custom_site_eligible,
    ready: !loading && !!tenant,
  };
}
