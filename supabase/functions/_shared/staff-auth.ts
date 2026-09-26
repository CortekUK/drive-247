// Staff authorisation for edge functions that move money or rewrite money rows
// on behalf of a portal operator.
//
// WHY THIS EXISTS
// ---------------
// reverse-payment, adjust-customer-balance (v1), undo-manual-payment and a
// family of rental-page money functions built a SERVICE-ROLE client and went
// straight from `req.json()` to the write. None of them asked who was calling.
//
// None of them has a block in supabase/config.toml, so the gateway default
// (`verify_jwt = true`) applies — and that default is satisfied by the PUBLIC
// ANON KEY, which ships inside the booking site's JavaScript bundle. Drive247
// also runs ONE Supabase auth project for everybody: portal staff sign in
// against `app_users`, and every renter on every tenant's booking site signs in
// against `customer_users`. So "the gateway let it through" meant "anyone on
// the internet" — and a payment, customer or rental UUID is not a secret (they
// travel in portal URLs, success-page query strings and customer emails).
//
// This is the same boundary _shared/deposit-hold-auth.ts draws for the deposit
// endpoints and _shared/payment-plans-deno/auth.ts draws for payment plans, cut
// down to the one tier these functions have: a signed-in operator. It does not
// invent anything new — each step below is the step those two files take, in
// the same order, with the same fail-safe direction.
//
// WHAT IT CHECKS
// --------------
//  1. A bearer token is present, and it is not the project's anon key or
//     service-role key. Both are project JWTs with no `sub`, so GoTrue would
//     refuse them anyway; refusing them by value first means a GoTrue quirk can
//     never turn the public key into a user. → 401
//  2. GoTrue resolves the token to an auth user. Any error, a throw, or no user
//     denies. → 401
//  3. That user has an `app_users` row, and it is ACTIVE. A booking-site renter
//     has none — this is the line that stops them. → 403
//  4. The role may write here:
//       head_admin, admin, ops  ALLOWED (the portal's `canEdit` is true for all
//                               three; see STAFF_WRITE_ROLES)
//       manager                 ALLOWED only with an EDITOR grant, in
//                               `manager_permissions`, on one of the tabs the
//                               caller names — the server side of the portal's
//                               `canEdit(tab)`
//       super admin             ALLOWED (`is_super_admin`, tenant_id NULL by design)
//       viewer, anything else   REFUSED (default-deny covers a NULL role and any
//                               role added to the enum later). → 403
//  5. The TARGET ROW's tenant equals the caller's tenant (super admins
//     excepted). The tenant comes from the row the request is about — the
//     payment, the rental, the customer — never from the request body. → 403
//
// Steps 1–4 need nothing but the token, so a function calls `authorizeStaff`
// BEFORE it reads the row the request names: an unidentified caller learns
// nothing, not even whether the id exists. Step 5 then runs on the loaded row
// via `checkStaffTenant` (or inside `authorizeStaff` when the tenant is already
// known).
//
// FAILS SAFE: every unexpected condition — a missing env var, a GoTrue outage,
// a failed table read — denies. An outage that answered `ok: true` would
// re-open a money path.
//
// NO REMOTE IMPORTS, deliberately: the caller hands in its own clients. That is
// what lets the offline contract tests in tests/integrations/** import this
// file and drive it with a recording fake.

// deno-lint-ignore-file no-explicit-any

/**
 * Roles with full operator authority over money on their own tenant.
 *
 * Deliberately aligned one-for-one with the portal's `canEdit`
 * (apps/portal/src/hooks/use-manager-permissions.ts), which returns true for
 * every role except `viewer`, and gates a manager on the tab. That is the gate
 * on every button that reaches these functions (Reverse Payment, Undo, Edit
 * Balance, Approve, Reject, Cancel), so an operator never sees a button the
 * server refuses, and never gets a capability the UI does not show. `ops` is
 * here for the same reason _shared/deposit-hold-auth.ts gives: it is a working
 * role ("Day-to-day operations"), and adjust-customer-balance's v2 path and the
 * balance_adjust SQL function already admit it. Narrowing a single function
 * below this is a per-call `roles` option, not an edit here.
 */
export const STAFF_WRITE_ROLES: readonly string[] = ["head_admin", "admin", "ops"];

export interface StaffCaller {
  authUserId: string;
  appUserId: string;
  /** The caller's own tenant. NULL for a super admin. */
  tenantId: string | null;
  role: string | null;
  isSuperAdmin: boolean;
}

export type StaffAuthResult =
  | { ok: true; status: 200; error: null; caller: StaffCaller }
  | { ok: false; status: number; error: string; caller: null };

/** The slice of a supabase-js client this module uses. */
export interface StaffAuthDb {
  from: (table: string) => any;
}
export interface StaffAuthClient {
  auth: { getUser: (jwt: string) => PromiseLike<{ data: { user: { id: string } | null } | null; error: any }> };
}

export interface StaffAuthDeps {
  /** A SERVICE-ROLE client: app_users / manager_permissions must not be RLS-filtered. */
  db: StaffAuthDb;
  /**
   * The client that verifies the JWT against GoTrue. The anon-key client by
   * preference (as deposit-hold-auth does); the service-role client is the
   * same verification with a different apikey, and is the fallback.
   */
  authClient?: StaffAuthClient | null;
  /** Environment reader; defaults to Deno.env.get. Tests pass their own. */
  env?: (name: string) => string | undefined;
}

export interface StaffAuthOptions {
  /** Log tag, e.g. "[reverse-payment]". */
  logPrefix: string;
  /** A manager is allowed with an EDITOR grant on ANY of these tabs. */
  managerTabs: readonly string[];
  /** Full-authority roles. Defaults to STAFF_WRITE_ROLES. */
  roles?: readonly string[];
  /**
   * The target row's tenant, when the caller already has it. Omit it and call
   * `checkStaffTenant` once the row is loaded.
   */
  tenantId?: string | null;
}

const deny = (status: number, error: string): StaffAuthResult => ({ ok: false, status, error, caller: null });

function defaultEnv(name: string): string | undefined {
  try {
    return (globalThis as any).Deno?.env?.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The anon-key client to verify JWTs with, built with the caller's own
 * createClient (this module imports nothing remote). Null when the env is
 * incomplete — authorizeStaff then verifies with the service-role client,
 * which is the same GoTrue check with a different apikey.
 */
export function anonAuthClient(
  createClient: (url: string, key: string) => any,
  env: (name: string) => string | undefined = defaultEnv,
): StaffAuthClient | null {
  const url = env("SUPABASE_URL") ?? "";
  const anonKey = env("SUPABASE_ANON_KEY") ?? "";
  return url && anonKey ? (createClient(url, anonKey) as StaffAuthClient) : null;
}

/** The HTTP answer for a refusal, in the `{ success: false, error }` shape most money functions use. */
export function staffRefusal(result: { status: number; error: string | null }, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ success: false, error: result.error }), {
    status: result.status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** The bearer token from the Authorization header, or "" when there is none. */
export function readBearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Steps 1–4 (and 5 when `opts.tenantId` is passed). Call it before reading the
 * row the request names, and before any write or processor call.
 */
export async function authorizeStaff(
  req: Request,
  deps: StaffAuthDeps,
  opts: StaffAuthOptions,
): Promise<StaffAuthResult> {
  const log = opts.logPrefix;
  const env = deps.env ?? defaultEnv;

  // ── 1. A token, and not one of the project's own keys ─────────────────────
  const token = readBearer(req);
  if (!token) return deny(401, "Sign in to continue.");
  const anonKey = env("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if ((anonKey && token === anonKey) || (serviceKey && token === serviceKey)) {
    console.warn(log, "Refused a project key presented as a user session.");
    return deny(401, "Sign in to continue.");
  }

  // ── 2. Who is this session? ───────────────────────────────────────────────
  let authUserId: string | null = null;
  try {
    const verifier = deps.authClient ?? (deps.db as unknown as StaffAuthClient);
    const { data, error } = await verifier.auth.getUser(token);
    if (error) console.warn(log, "JWT rejected:", error?.message ?? error);
    else authUserId = data?.user?.id ?? null;
  } catch (err) {
    console.error(log, "getUser threw; denying:", err);
  }
  if (!authUserId) return deny(401, "Sign in to continue.");

  // ── 3. Staff, and active ──────────────────────────────────────────────────
  const { data: appUser, error: appUserError } = await deps.db
    .from("app_users")
    .select("id, tenant_id, role, is_super_admin, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (appUserError) {
    console.error(log, "app_users lookup failed; denying:", appUserError?.message ?? appUserError);
    return deny(500, "Could not verify access.");
  }
  // maybeSingle, not single: a booking-site renter legitimately has no row, and
  // that must read as "not staff" (403), never as a 500 to retry.
  if (!appUser) return deny(403, "Only a member of staff can do this.");
  if (appUser.is_active === false) return deny(403, "This account is deactivated.");

  const isSuperAdmin = appUser.is_super_admin === true;
  const role = (appUser.role as string | null) ?? null;
  const caller: StaffCaller = {
    authUserId,
    appUserId: appUser.id as string,
    tenantId: (appUser.tenant_id as string | null) ?? null,
    role,
    isSuperAdmin,
  };

  // ── 4. May this role write here? ──────────────────────────────────────────
  const roles = opts.roles ?? STAFF_WRITE_ROLES;
  let allowed = isSuperAdmin || (!!role && roles.includes(role));
  if (!allowed && role === "manager" && opts.managerTabs.length > 0) {
    const { data: grants, error: grantError } = await deps.db
      .from("manager_permissions")
      .select("tab_key, access_level")
      .eq("app_user_id", caller.appUserId)
      .in("tab_key", [...opts.managerTabs])
      .eq("access_level", "editor");
    if (grantError) {
      // A grant we could not read is never an accidental grant.
      console.error(log, "manager_permissions lookup failed; denying:", grantError?.message ?? grantError);
      return deny(500, "Could not verify access.");
    }
    allowed = ((grants ?? []) as { tab_key?: string; access_level?: string }[]).some(
      (g) => g.access_level === "editor" && !!g.tab_key && opts.managerTabs.includes(g.tab_key),
    );
  }
  if (!allowed) {
    console.warn(log, "Refused app_user", caller.appUserId, "role", role ?? "(none)");
    return deny(403, "Your role cannot make this change. Ask an admin to do this.");
  }

  // ── 5. (when the tenant is already known) ─────────────────────────────────
  if (opts.tenantId !== undefined) return checkStaffTenant(caller, opts.tenantId, log);
  return { ok: true, status: 200, error: null, caller };
}

/**
 * Step 5: the row the request is about must belong to the caller's own tenant.
 * Super admins are the documented platform-wide exception. A row with no
 * tenant is refused for everyone else — without a tenant there is no check.
 */
export function checkStaffTenant(
  caller: StaffCaller,
  targetTenantId: string | null | undefined,
  logPrefix: string,
): StaffAuthResult {
  if (caller.isSuperAdmin) return { ok: true, status: 200, error: null, caller };
  if (!targetTenantId || caller.tenantId !== targetTenantId) {
    console.warn(
      logPrefix,
      "Cross-tenant attempt: app_user",
      caller.appUserId,
      "(tenant",
      caller.tenantId ?? "none",
      ") on a row of tenant",
      targetTenantId ?? "none",
    );
    return deny(403, "This belongs to a different business.");
  }
  return { ok: true, status: 200, error: null, caller };
}
