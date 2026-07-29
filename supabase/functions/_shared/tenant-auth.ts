/**
 * Membership check for functions that act on a tenant named in the request body.
 *
 * WHY THIS EXISTS. Several billing functions authenticated the caller ("is this
 * a valid Supabase user?") and then trusted the `tenantId` in the body, which
 * answers a different question entirely. Drive247 runs ONE Supabase auth
 * project for everybody: staff sign in against `app_users`, and every rental
 * customer on every tenant's public booking site signs in against
 * `customer_users`. So "holds a valid JWT" includes any member of the public who
 * registered to book a car. Tenant UUIDs are readable before login (the portal
 * resolves the tenant from the subdomain to brand the login page), so the id
 * needed to target someone else is not a secret either.
 *
 * Concretely, that made create-subscription-portal-session hand any signed-in
 * person a Stripe Billing Portal session for any tenant — invoice history and
 * payment-method replacement both enabled — so they could read an operator's
 * platform invoices, or swap the card Drive247 charges them on.
 *
 * Requiring an `app_users` row is what rejects the booking-side customer: they
 * have none. Super admins carry `tenant_id = NULL` and are allowed through to
 * every tenant by design.
 */
export type TenantAuthResult =
  | { ok: true; appUser: { id: string; tenant_id: string | null; is_super_admin: boolean } }
  | { ok: false; status: number; message: string };

export async function authorizeTenantAccess(
  supabase: any,
  authUserId: string,
  tenantId: string
): Promise<TenantAuthResult> {
  const { data: appUser, error } = await supabase
    .from("app_users")
    .select("id, tenant_id, is_super_admin, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  // maybeSingle, not single: a booking-site customer legitimately has no row,
  // and that must read as "not staff" (403), never as a 500 the caller could
  // mistake for a transient fault and retry.
  if (error) {
    console.error("authorizeTenantAccess lookup failed:", error);
    return { ok: false, status: 500, message: "Could not verify access" };
  }
  if (!appUser) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  if (appUser.is_active === false) {
    return { ok: false, status: 403, message: "Account is deactivated" };
  }
  if (!appUser.is_super_admin && appUser.tenant_id !== tenantId) {
    console.warn(
      `Cross-tenant billing attempt: app_user ${appUser.id} (tenant ${appUser.tenant_id}) requested tenant ${tenantId}`
    );
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true, appUser };
}
