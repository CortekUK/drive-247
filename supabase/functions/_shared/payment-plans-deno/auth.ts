// Payment plans — who may change a plan on THIS rental (payment-plan-manage).
//
// Mirrors the staff tier of _shared/deposit-hold-auth.ts line for line — the
// same JWT resolution (anon-key client, so a bare anon or service key, which
// carry no `sub`, is never a user), the same app_users lookup, the same
// cross-tenant rule — with the role set the design names (§8):
//
//   head_admin, admin  ALLOWED.
//   manager            ALLOWED only with an EDITOR grant on the `rentals` tab
//                      (manager_permissions), the portal's canEdit('rentals').
//   super admin        ALLOWED on every tenant (tenant_id = NULL by design).
//   ops, viewer, other REFUSED. ops is deliberately narrower than the deposit
//                      endpoints: a payment plan schedules future charges on
//                      a customer's card, which the design reserves for
//                      admins and granted managers.
//
// No platform-secret or service-role tier: nothing but a signed-in operator
// ever calls this function. The rental's tenant comes from the RENTAL ROW,
// never from the request body.
//
// FAILS SAFE: any lookup error denies.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

// deno-lint-ignore no-explicit-any
type Db = any;

const WRITE_ROLES = new Set(["head_admin", "admin"]);
const MANAGER_TAB = "rentals";

export interface PlanRentalRef {
  id: string;
  tenant_id: string;
  customer_id: string;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
}

export interface PlanCaller {
  appUserId: string;
  role: string | null;
  isSuperAdmin: boolean;
}

export type PlanAuthResult =
  | { ok: true; caller: PlanCaller; rental: PlanRentalRef }
  | { ok: false; status: number; message: string };

async function resolveAuthUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) {
    console.error("[payment-plans] SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot verify a user JWT; denying.");
    return null;
  }
  try {
    const { data, error } = await createClient(url, anonKey).auth.getUser(token);
    if (error) return null;
    return data?.user?.id ?? null;
  } catch (err) {
    console.error("[payment-plans] getUser threw; denying:", err);
    return null;
  }
}

/** Read the rental the request is about. Denies (null) on any error. */
export async function loadRentalRef(db: Db, rentalId: string): Promise<PlanRentalRef | null> {
  const { data, error } = await db
    .from("rentals")
    .select("id, tenant_id, customer_id, start_date, end_date, status")
    .eq("id", rentalId)
    .maybeSingle();
  if (error) {
    console.error("[payment-plans] rental lookup failed; denying:", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * The guard. Call it before any read of plan data or any write.
 * @param db a SERVICE-ROLE client (app_users / manager_permissions must not be RLS-filtered).
 */
export async function authorizePlanStaff(req: Request, db: Db, rentalId: string): Promise<PlanAuthResult> {
  if (!rentalId) return { ok: false, status: 400, message: "A rental is required" };
  const userId = await resolveAuthUserId(req);
  if (!userId) return { ok: false, status: 401, message: "Sign in to continue." };

  const rental = await loadRentalRef(db, rentalId);
  if (!rental) return { ok: false, status: 404, message: "Rental not found" };

  const { data: appUser, error } = await db
    .from("app_users")
    .select("id, tenant_id, role, is_super_admin, is_active")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[payment-plans] app_users lookup failed; denying:", error.message);
    return { ok: false, status: 500, message: "Could not verify access" };
  }
  if (!appUser || appUser.is_active === false) return { ok: false, status: 403, message: "Not authorised for this rental" };

  const isSuperAdmin = appUser.is_super_admin === true;
  if (!isSuperAdmin && appUser.tenant_id !== rental.tenant_id) {
    console.warn("[payment-plans] cross-tenant attempt: app_user", appUser.id, "on rental", rental.id);
    return { ok: false, status: 403, message: "Not authorised for this rental" };
  }

  const role = (appUser.role as string | null) ?? null;
  let allowed = isSuperAdmin || (!!role && WRITE_ROLES.has(role));
  if (!allowed && role === "manager") {
    const { data: grant, error: grantError } = await db
      .from("manager_permissions")
      .select("id")
      .eq("app_user_id", appUser.id)
      .eq("tab_key", MANAGER_TAB)
      .eq("access_level", "editor")
      .limit(1)
      .maybeSingle();
    if (grantError) {
      console.error("[payment-plans] manager_permissions lookup failed; denying:", grantError.message);
      return { ok: false, status: 500, message: "Could not verify access" };
    }
    allowed = !!grant;
  }
  if (!allowed) return { ok: false, status: 403, message: "Your role cannot change payment plans. Ask an admin to do this." };

  return { ok: true, caller: { appUserId: appUser.id, role, isSuperAdmin }, rental };
}
