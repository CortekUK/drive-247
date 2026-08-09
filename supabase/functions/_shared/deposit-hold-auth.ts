// Caller authorisation for the deposit-hold money endpoints.
//
// WHY THIS EXISTS
// ---------------
// capture-deposit-hold, place-deposit-hold, create-hold-checkout and
// release-deposit-hold went from `req.json()` straight to a rental fetch and
// then acted with the SERVICE-ROLE key — capturing money, authorising money,
// minting Stripe Checkout sessions, cancelling live authorisations. None of them
// read the `Authorization` header at all.
//
// `supabase/config.toml` declares no block for those four, so the gateway
// default (`verify_jwt = true`) applied — and that default is satisfied by the
// PUBLIC ANON KEY, which ships inside the booking app's JavaScript bundle.
// Drive247 also runs ONE Supabase auth project for everybody: portal staff sign
// in against `app_users`, and every renter on every tenant's public booking site
// signs in against `customer_users`. So "holds a valid session" included any
// member of the public who registered to book a car. Rental UUIDs are not
// secrets either — they travel in portal URLs, success-page query strings and
// customer emails.
//
// Net effect: any authenticated session on the project could POST `{rentalId}`
// for ANOTHER TENANT'S rental and move that tenant's money. This module is the
// boundary that was missing.
//
// WHAT IT CHECKS
// --------------
//  1. `x-platform-secret`, validated by the `platform_verify_secret(p_secret)`
//     DB RPC — the same server-to-server credential onboarding-daily-digest,
//     platform-rental-notify, refresh-deposit-holds and reconcile-deposit-holds
//     already accept. One internal credential to rotate, not five.
//  2. The service-role bearer — see the caveat on ALLOW_SERVICE_ROLE below.
//  3. A staff session: an `app_users` row for the JWT's user, which must be
//     ACTIVE, must belong to the RENTAL'S OWN TENANT (unless `is_super_admin`),
//     and must hold a role that is permitted to write. The tenant check is the
//     cross-tenant fix and is the most important line in this file.
//  4. Optionally (`allowRentalCustomer`) the renter themselves, resolved through
//     `customer_users` → the rental's own `customer_id`. Never from anything the
//     client supplied.
//
// Everything else is refused. The one deliberate exception is
// `allowUnidentifiedAutomation`, which exists for exactly one caller and is
// documented at its definition below.
//
// FAILS SAFE: every unexpected condition — a missing env var, an RPC error, a
// GoTrue outage, a failed table read — denies. An outage that made this return
// `ok: true` would re-open a money path.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

// ── Roles ───────────────────────────────────────────────────────────────────
//
// Every endpoint guarded by this module WRITES: it authorises, captures or
// cancels a card authorisation and rewrites `rentals.deposit_hold_*`. So the
// question is not "may this person see a rental?" but "may this person move
// money on it?".
//
// The portal answers the same question client-side in
// `useManagerPermissions().canEdit` (apps/portal/src/hooks/use-manager-permissions.ts).
// That is UX; this is the authorisation boundary. The two are deliberately
// aligned one-for-one so an operator never sees a button that the server will
// refuse, and never gets a hidden capability the UI does not show.
//
//   head_admin  ALLOWED. Full operator authority.
//   admin       ALLOWED. Full operator authority.
//   ops         ALLOWED. "Day-to-day operations" — the people running key
//               handover, which is precisely where holds are placed
//               (use-key-handover.ts) and released. `canEdit` returns true for
//               them today; locking them out would break handover for every
//               tenant that staffs it with ops users, which is a worse outcome
//               than the hole this file closes.
//   manager     ALLOWED ONLY with an *editor* grant on the `rentals` tab.
//               Managers have granular per-tab access (`manager_permissions`),
//               and every one of these endpoints is reached from the rental
//               page, so `rentals` is the grant that corresponds. This costs one
//               extra query and is only ever run for a manager. A manager with
//               no grant, a viewer-level grant, or a grant we could not read is
//               REFUSED — a failed lookup must never become an accidental grant.
//   viewer      REFUSED. Its entire definition in the users UI is "Viewer —
//               read-only access".
//   super admin ALLOWED regardless of role/tenant — that is the documented
//               platform-wide bypass (`is_super_admin`, `tenant_id = NULL`).
//   anything    REFUSED. Default-deny covers a NULL role and any role added to
//   else        the enum later without someone revisiting this file.
const STAFF_WRITE_ROLES = new Set(["head_admin", "admin", "ops"]);

/** The manager tab whose editor grant stands in for "may change a rental". */
const MANAGER_RENTAL_TAB_KEY = "rentals";

// ── The service-role bearer ─────────────────────────────────────────────────
//
// Accepted, because three PROVEN server-to-server callers present it and
// breaking them would silently stop deposits being placed across every tenant:
//   * supabase/functions/stripe-webhook-test/index.ts  (place-deposit-hold)
//   * supabase/functions/stripe-webhook-live/index.ts  (place-deposit-hold)
//   * supabase/functions/charge-saved-card/index.ts    (place-deposit-hold)
// verify-deposit-hold also already accepted it before this module existed, and
// this is not the pass that removes a working path.
//
// CAVEAT, recorded so the next person does not have to rediscover it: a valid
// production service_role JWT is committed in plaintext at
// supabase/migrations/20260520170000_schedule_tesla_sync_cron.sql and is pending
// rotation. refresh-deposit-holds and reconcile-deposit-holds deliberately do
// NOT trust it for that reason. Once that key is rotated — and once the three
// callers above are switched to `x-platform-secret` — this tier should be
// deleted and those functions moved to the platform secret.
const ALLOW_SERVICE_ROLE = true;

export type DepositHoldCallerKind =
  | "platform_secret"
  | "service_role"
  | "staff"
  | "customer"
  | "unidentified_automation";

export interface DepositHoldCaller {
  kind: DepositHoldCallerKind;
  /** `app_users.id` when a human operator asked; null otherwise. */
  appUserId: string | null;
  /** The caller's own tenant. NULL for super admins and machine callers. */
  tenantId: string | null;
  role: string | null;
  isSuperAdmin: boolean;
  /**
   * Stable label for `deposit_hold_links.actor` — the app_user UUID for a human,
   * a plain word for a machine. Matches what verify-deposit-hold already wrote.
   */
  actor: string;
}

/** The slice of the rental the guard needs; also handed back so callers can reuse it. */
export interface DepositHoldRentalRef {
  id: string;
  tenant_id: string | null;
  customer_id: string | null;
}

export type DepositHoldAuthResult =
  | { ok: true; caller: DepositHoldCaller; rental: DepositHoldRentalRef }
  | { ok: false; status: number; message: string };

export interface DepositHoldAuthOptions {
  /** The rental this request wants to act on. */
  rentalId: string;
  /** Log tag, e.g. "[DEPOSIT-CAPTURE]". */
  logPrefix: string;
  /**
   * The rental row, when the caller has already read it. Saves a round trip;
   * must carry `tenant_id` (and `customer_id` when `allowRentalCustomer` is on).
   * Omit it and the guard reads the three columns itself.
   */
  rental?: { id?: string | null; tenant_id?: string | null; customer_id?: string | null } | null;
  /**
   * Let the rental's OWN renter through — resolved via `customer_users`, never
   * from anything in the request body. Only place-deposit-hold sets this: a
   * renter may authorise their own deposit, but must never be able to capture
   * it, release it, or mint a Checkout session.
   */
  allowRentalCustomer?: boolean;
  /**
   * ESCAPE HATCH FOR ONE CALLER — see the long note in place-deposit-hold.
   *
   * The booking app's success page invokes place-deposit-hold from the browser
   * with `{ rentalId }` and nothing else, and GUEST bookings reach it with no
   * session at all (only the public anon key). That client call is the ONLY
   * mechanism that places a deposit hold for a website booking — the webhook
   * path needs `place_deposit_hold` metadata, which only the PORTAL sets
   * (create-checkout-session ← add-payment-dialog / rentals/new). Refusing an
   * unidentified caller there would silently stop deposits being held on every
   * customer-originated booking, for all tenants.
   *
   * So an unidentified caller is admitted ONLY on the automatic path, and only
   * for placement. It is never admitted when `manualOverride` is set, because
   * that flag bypasses the extended-rental block and is a deliberate staff
   * action. This is a KNOWN remaining gap, not an oversight: it is bounded to
   * "authorise the tenant-configured deposit on the rental's own saved card",
   * which is exactly what the system does automatically seconds later. It moves
   * no money to the caller. Closing it properly needs a change in `apps/booking`
   * (pass the Stripe checkout session id and bind the call to it), which is
   * outside this module.
   */
  allowUnidentifiedAutomation?: boolean;
  /** The request's `manualOverride` flag, if it has one. Blocks the escape hatch above. */
  manualOverride?: boolean;
}

/** Pull the bearer token out of the Authorization header. */
function readBearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Resolve the auth user behind a JWT.
 *
 * Uses the ANON-key client by preference: the anon key and the service-role key
 * are themselves valid project JWTs, but neither carries a `sub`, so getUser()
 * yields no user for them. That is exactly what stops a bare anon key — the one
 * shipped in the booking bundle — from walking through as a user. Falls back to
 * the service-role client only if SUPABASE_ANON_KEY is somehow absent, which is
 * the same verification against GoTrue with a different apikey, and is there so
 * a missing env var cannot lock every operator out of a money path.
 */
async function resolveAuthUser(
  token: string,
  serviceClient: any,
  logPrefix: string
): Promise<{ id: string } | null> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  try {
    const client = url && anonKey ? createClient(url, anonKey) : serviceClient;
    if (!anonKey) {
      console.warn(logPrefix, "SUPABASE_ANON_KEY missing; verifying JWT with the service-role client instead.");
    }
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      console.warn(logPrefix, "JWT rejected:", error.message);
      return null;
    }
    const id = data?.user?.id ?? null;
    return id ? { id } : null;
  } catch (err) {
    // Fail SAFE: a GoTrue outage denies rather than admitting an unknown caller.
    console.error(logPrefix, "getUser threw; denying:", err);
    return null;
  }
}

/** True when this manager holds an EDITOR grant on the rentals tab. Denies on any error. */
async function managerMayEditRentals(supabase: any, appUserId: string, logPrefix: string): Promise<boolean> {
  const { data: grant, error } = await supabase
    .from("manager_permissions")
    .select("id")
    .eq("app_user_id", appUserId)
    .eq("tab_key", MANAGER_RENTAL_TAB_KEY)
    .eq("access_level", "editor")
    // limit(1) so a duplicated grant row cannot turn maybeSingle()'s "more than
    // one row" error into a lockout for a legitimate manager.
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(logPrefix, "manager_permissions lookup failed; denying:", error);
    return false;
  }
  return !!grant;
}

/**
 * The guard. Call it BEFORE any Stripe call or DB write.
 *
 * @param supabase a SERVICE-ROLE client. `platform_verify_secret` is
 *   service-role-only, and the app_users / customer_users / manager_permissions
 *   lookups must not be filtered by RLS.
 */
export async function authorizeDepositHoldRequest(
  req: Request,
  supabase: any,
  opts: DepositHoldAuthOptions
): Promise<DepositHoldAuthResult> {
  const log = opts.logPrefix;

  if (!opts.rentalId) {
    return { ok: false, status: 400, message: "Missing required field: rentalId" };
  }

  // ── 1. Platform secret (server-to-server / pg_cron) ───────────────────────
  const secret = req.headers.get("x-platform-secret");
  if (secret) {
    try {
      const { data: valid, error } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
      if (error) console.error(log, "platform_verify_secret rpc failed:", error.message);
      else if (valid === true) {
        const rental = await loadRental(supabase, opts, log);
        if (!rental) return { ok: false, status: 404, message: "Rental not found" };
        return { ok: true, rental, caller: machineCaller("platform_secret", "platform") };
      }
    } catch (err) {
      console.error(log, "platform_verify_secret rpc threw:", err);
    }
    // A present-but-invalid secret is a refusal, not a fall-through to the
    // weaker tiers below.
    return { ok: false, status: 401, message: "Invalid platform credentials" };
  }

  const token = readBearer(req);

  // ── 2. Service-role bearer (Stripe webhooks, charge-saved-card) ───────────
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (ALLOW_SERVICE_ROLE && token && serviceRoleKey && token === serviceRoleKey) {
    const rental = await loadRental(supabase, opts, log);
    if (!rental) return { ok: false, status: 404, message: "Rental not found" };
    return { ok: true, rental, caller: machineCaller("service_role", "system") };
  }

  // ── 3. Who is this session? ───────────────────────────────────────────────
  // No token, or a token GoTrue does not recognise as a user (the public anon
  // key lands here — it is a project JWT with no `sub`).
  const user = token ? await resolveAuthUser(token, supabase, log) : null;

  if (!user) {
    // The one documented exception; see allowUnidentifiedAutomation.
    if (opts.allowUnidentifiedAutomation && !opts.manualOverride) {
      const rental = await loadRental(supabase, opts, log);
      if (!rental) return { ok: false, status: 404, message: "Rental not found" };
      console.warn(
        log,
        "Unidentified caller admitted on the automatic placement path for rental",
        opts.rentalId,
        "— booking-app guest flow; see allowUnidentifiedAutomation."
      );
      return { ok: true, rental, caller: machineCaller("unidentified_automation", "system") };
    }
    return {
      ok: false,
      status: 401,
      message: token ? "Invalid or expired session" : "Missing authorization",
    };
  }

  // ── 4. What is this session allowed to touch? ─────────────────────────────
  const rental = await loadRental(supabase, opts, log);
  if (!rental) return { ok: false, status: 404, message: "Rental not found" };

  const { data: appUser, error: appUserError } = await supabase
    .from("app_users")
    // `role` is selected because staff MEMBERSHIP alone is not authority to
    // write — a viewer is staff. See STAFF_WRITE_ROLES.
    .select("id, tenant_id, role, is_super_admin, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (appUserError) {
    console.error(log, "app_users lookup failed; denying:", appUserError);
    return { ok: false, status: 500, message: "Could not verify access" };
  }

  if (appUser) {
    if (appUser.is_active === false) {
      return { ok: false, status: 403, message: "This account is deactivated." };
    }

    const isSuperAdmin = appUser.is_super_admin === true;
    const role = (appUser.role as string | null) ?? null;
    const callerTenantId = (appUser.tenant_id as string | null) ?? null;

    // THE CROSS-TENANT FIX. A staff session may only act on rentals of its own
    // tenant. Super admins (tenant_id = NULL by design) are the documented
    // platform-wide exception.
    if (!isSuperAdmin && callerTenantId !== rental.tenant_id) {
      console.warn(
        log,
        "Cross-tenant deposit-hold attempt: app_user",
        appUser.id,
        "(tenant",
        callerTenantId ?? "none",
        ") requested rental",
        rental.id,
        "of tenant",
        rental.tenant_id ?? "none"
      );
      return { ok: false, status: 403, message: "Not authorised for this rental" };
    }

    let roleAllowed = isSuperAdmin || (!!role && STAFF_WRITE_ROLES.has(role));
    if (!roleAllowed && role === "manager") {
      roleAllowed = await managerMayEditRentals(supabase, appUser.id as string, log);
    }

    if (!roleAllowed) {
      console.warn(log, "Refused deposit-hold action for app_user", appUser.id, "role", role ?? "(none)");
      return {
        ok: false,
        status: 403,
        message: "Your role does not permit changing a deposit hold. Ask an admin to do this.",
      };
    }

    return {
      ok: true,
      rental,
      caller: {
        kind: "staff",
        appUserId: (appUser.id as string | null) ?? null,
        tenantId: callerTenantId,
        role,
        isSuperAdmin,
        // Matches what verify-deposit-hold already wrote to deposit_hold_links.
        actor: (appUser.id as string | null) ?? "app_user",
      },
    };
  }

  // ── 5. Not staff. Is it the renter on THIS rental? ────────────────────────
  if (opts.allowRentalCustomer && rental.customer_id) {
    const { data: link, error: linkError } = await supabase
      .from("customer_users")
      .select("id")
      .eq("auth_user_id", user.id)
      // Bound to the RENTAL's customer, never to a client-supplied id — this is
      // what stops one tenant's renter acting on another tenant's rental.
      .eq("customer_id", rental.customer_id)
      .limit(1)
      .maybeSingle();
    if (linkError) {
      console.error(log, "customer_users lookup failed; denying:", linkError);
      return { ok: false, status: 500, message: "Could not verify access" };
    }
    if (link) {
      return {
        ok: true,
        rental,
        caller: {
          kind: "customer",
          appUserId: null,
          tenantId: rental.tenant_id,
          role: null,
          isSuperAdmin: false,
          actor: "customer",
        },
      };
    }
  }

  // A signed-in renter of some OTHER rental, or an auth user with no profile at
  // all. Same 403 either way — no existence oracle.
  console.warn(log, "Refused deposit-hold action for auth user", user.id, "on rental", rental.id);
  return { ok: false, status: 403, message: "Not authorised for this rental" };
}

function machineCaller(kind: DepositHoldCallerKind, actor: string): DepositHoldCaller {
  return { kind, appUserId: null, tenantId: null, role: null, isSuperAdmin: false, actor };
}

/**
 * The rental's identity columns. Uses the caller's already-fetched row when it
 * carries a tenant_id, otherwise reads the three columns itself — a trivial
 * lookup that lets every guarded function deny BEFORE it does any work.
 */
async function loadRental(
  supabase: any,
  opts: DepositHoldAuthOptions,
  logPrefix: string
): Promise<DepositHoldRentalRef | null> {
  const supplied = opts.rental;
  if (supplied && supplied.tenant_id) {
    return {
      id: (supplied.id as string | null) ?? opts.rentalId,
      tenant_id: (supplied.tenant_id as string | null) ?? null,
      customer_id: (supplied.customer_id as string | null) ?? null,
    };
  }

  const { data, error } = await supabase
    .from("rentals")
    .select("id, tenant_id, customer_id")
    .eq("id", opts.rentalId)
    .maybeSingle();

  if (error) {
    // Deny rather than guess: without a tenant_id there is no tenant check.
    console.error(logPrefix, "rental lookup failed during authorisation; denying:", error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id as string,
    tenant_id: (data.tenant_id as string | null) ?? null,
    customer_id: (data.customer_id as string | null) ?? null,
  };
}
