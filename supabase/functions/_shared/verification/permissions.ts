// feat-003: who may do what (spec 03.11 to 03.16). Pure, so the portal's copy and Vitest agree.

/** Companies the module is switched on for (spec 03.16). One list, like integration-billing/gate.ts. */
export const VERIFICATION_TENANTS = ["northwind"];

export function isVerificationEnabled(tenantSlug: string | null | undefined): boolean {
  return !!tenantSlug && VERIFICATION_TENANTS.includes(tenantSlug.toLowerCase());
}

export type Role = "head_admin" | "admin" | "manager" | "ops" | "viewer" | string;

/** May this staff member start a check at all? Viewers never; managers only with Customers edit (03.9 to 03.11). */
export function canStart(role: Role, canEditCustomers: boolean, isSuperAdmin = false): boolean {
  if (isSuperAdmin) return true;
  if (role === "head_admin" || role === "admin" || role === "ops") return true;
  return role === "manager" && canEditCustomers;
}

/** May this staff member tick premium checks (spec 03.12, 03.13)? Ops and viewers may not. */
export function canTickPremium(role: Role, canEditCustomers: boolean, isSuperAdmin = false): boolean {
  if (isSuperAdmin) return true;
  if (role === "head_admin" || role === "admin") return true;
  return role === "manager" && canEditCustomers;
}

/** Premium checks need an active or trialing subscription (spec 03.14, Ghulam Q2). */
export function premiumAllowedBySubscription(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}
