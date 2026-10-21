"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";

import { supabase } from "@nw/integrations/supabase/client";
import type { Database } from "@nw/integrations/supabase/types";

/**
 * Customer authentication — the CUSTOMER chain, not the staff one.
 *
 * Ported from `apps/booking/src/stores/customer-auth-store.ts`. The identity
 * model is unchanged and is the whole reason this store exists separately from
 * anything an operator uses:
 *
 *     auth.users  ──▶  customer_users (one row PER TENANT)  ──▶  customers
 *
 * A person is a Supabase auth user exactly once, globally, but is a *customer*
 * once per tenant. Being signed in is therefore NOT the same as having an
 * account on the site you are looking at: the same email can hold a real
 * account on `alpha.drive-247.com` and none at all on `northwind.…`. Every read
 * below is scoped by `tenant_id` for that reason, and a session with no link
 * for the current tenant is rejected rather than quietly admitted.
 *
 * ── WHAT v2 CHANGES, AND WHY ────────────────────────────────────────────────
 *
 *  1. SIGN-UP GOES THROUGH THE `customer-signup` EDGE FUNCTION.
 *     v1 writes the three rows from the browser: `auth.signUp`, then an OTP
 *     round-trip, then client-side INSERTs into `customers` and
 *     `customer_users`. That path cannot clean up after itself — deleting a
 *     half-created auth user needs the admin API, which a browser must never
 *     hold — so a failure between step 1 and step 3 leaves an auth user with no
 *     customer record: an account that can log in nowhere and can never be
 *     created again. v1 accumulated a "self-heal the orphan" branch to cope.
 *     The edge function already performs v1's exact ordering (auth user →
 *     customers → customer_users) with service-role privileges AND deletes the
 *     freshly-created auth user if either write fails, so v2 asks for the whole
 *     thing atomically instead of reproducing the orphan and then healing it.
 *     It is also the only path that works here at all: staging has
 *     `mailer_autoconfirm: false`, so a browser-side `auth.signUp` produces an
 *     UNCONFIRMED user who cannot then sign in — while the function creates the
 *     user with `email_confirm: true`.
 *
 *  2. MEMBERSHIP IS NEVER RESOLVED WITHOUT A TENANT.
 *     v1 calls `fetchCustomerUser(user, tenantId || undefined)`, and when the
 *     tenant has not loaded yet the `.eq('tenant_id', …)` filter is simply
 *     dropped — so whichever link row comes back first is accepted, on ANY
 *     tenant. On a shared auth domain that admits a customer of one operator to
 *     another operator's portal for as long as it takes the tenant query to
 *     return. Here `resolveMembership` refuses to run until the tenant is
 *     known, and `isLoading` stays true meanwhile.
 *
 *  3. SIGN-OUT SCOPE IS DELIBERATE. A person pressing "Sign out" gets
 *     `scope: "local"` — this device only. The two forced sign-outs (blocked
 *     customer, blacklisted email) get the default GLOBAL scope, because there
 *     killing every session is the entire point. The rejection in `signIn` for
 *     "no account on this site" is local too: that session may be perfectly
 *     valid on another operator's site and must not be destroyed from here.
 *
 * ── KNOWN TRAP, CARRIED OVER VERBATIM ───────────────────────────────────────
 * Everything that touches the Supabase client from inside `onAuthStateChange`
 * runs in `setTimeout(…, 0)`. The callback holds an internal lock, and calling
 * back into the client from within it deadlocks — the request never settles and
 * the app hangs on its loading state. Do not "simplify" that away.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * The blocked / blacklisted checks below are UX, not security. They run with
 * the anon key against tables the browser can read, so they tell a blocked
 * customer why they are being turned away instead of showing them an empty
 * portal. The boundary that actually holds is RLS.
 */

/* ────────────────────────────── row shapes ───────────────────────────────── */

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];

/**
 * The customer fields the site reads.
 *
 * `Pick` over the generated Row, exactly as `TenantContext` does it: a column
 * that does not exist fails to compile here rather than 400-ing the request at
 * runtime — and PostgREST rejects the WHOLE row for one unknown column, so a
 * single typo would not blank one field, it would sign everybody out.
 */
export type CustomerProfile = Pick<
  CustomerRow,
  | "id"
  | "name"
  | "email"
  | "phone"
  | "type"
  | "status"
  | "tenant_id"
  | "is_blocked"
  | "blocked_reason"
  | "identity_verification_status"
  | "profile_photo_url"
  | "date_of_birth"
  | "timezone"
  | "address_street"
  | "address_city"
  | "address_state"
  | "address_zip"
  | "license_number"
  | "license_state"
  | "is_gig_driver"
>;

const CUSTOMER_SELECT = [
  "id",
  "name",
  "email",
  "phone",
  "type",
  "status",
  "tenant_id",
  "is_blocked",
  "blocked_reason",
  "identity_verification_status",
  "profile_photo_url",
  "date_of_birth",
  "timezone",
  "address_street",
  "address_city",
  "address_state",
  "address_zip",
  "license_number",
  "license_state",
  "is_gig_driver",
] satisfies readonly (keyof CustomerProfile)[];

/**
 * Compile-time proof that the select list and `CustomerProfile` cannot drift.
 * The `satisfies` above rejects a column that is not on the type; this rejects
 * a column that is on the type but missing from the select — which would leave
 * the field typed as present and `undefined` forever.
 */
type AssertTrue<T extends true> = T;
type _EveryCustomerColumnIsSelected = AssertTrue<
  [Exclude<keyof CustomerProfile, (typeof CUSTOMER_SELECT)[number]>] extends [
    never,
  ]
    ? true
    : false
>;

const CUSTOMER_SELECT_CLAUSE = CUSTOMER_SELECT.join(", ");

/** One person's membership of ONE tenant: the `customer_users` link plus its customer. */
export interface CustomerMembership {
  /** `customer_users.id`. Notifications and portal reads hang off this, not the customer id. */
  id: string;
  authUserId: string;
  customerId: string;
  tenantId: string | null;
  customer: CustomerProfile;
}

/** The shape `customer_users` is read back in. */
interface MembershipRow {
  id: string;
  auth_user_id: string;
  customer_id: string;
  tenant_id: string | null;
  /**
   * PostgREST embeds a many-to-one as a single object. It is typed explicitly
   * because `customer_users.customer_id` carries four same-named foreign keys
   * (the table plus three reporting views), which leaves the generated
   * relationship ambiguous to the client's inference.
   */
  customer: CustomerProfile | null;
}

/* ─────────────────────────────── failures ────────────────────────────────── */

/**
 * Why an auth attempt did not succeed.
 *
 * A `kind` rather than a bare string because the pages render more than copy
 * from it: "no account on this site" gets a link to sign up, "already
 * registered" gets a link to sign in, and a blocked account gets neither.
 */
export type AuthFailureKind =
  /** The tenant has not resolved, so we do not know which site this is. */
  | "no-tenant"
  /** Supabase rejected the email/password pair. It will not say which half. */
  | "invalid-credentials"
  /** The password is right, but this person has no customer record HERE. */
  | "no-account-for-tenant"
  /** Blocked by the operator, or blacklisted across operators. */
  | "account-blocked"
  /** Sign-up: a usable account for this site already exists. */
  | "email-taken"
  | "weak-password"
  /** Password reset: the six-digit code was wrong or has expired. */
  | "invalid-code"
  /** Password reset: no account anywhere carries that address. */
  | "no-such-account"
  | "network"
  | "unexpected";

export interface AuthFailure {
  kind: AuthFailureKind;
  /** Ready to show a customer. Never a raw Postgres or Supabase string. */
  message: string;
}

export type AuthResult = { ok: true } | { ok: false; failure: AuthFailure };

function fail(kind: AuthFailureKind, message: string): AuthResult {
  return { ok: false, failure: { kind, message } };
}

/* ──────────────────────────────── helpers ────────────────────────────────── */

/** Who the current site belongs to. The name is used in customer-facing copy. */
export interface TenantIdentity {
  id: string;
  name: string;
  /** For the auth emails' redirect, which must sit on <slug>.drive-247.com. */
  slug?: string | null;
}

const NO_TENANT_MESSAGE =
  "We could not work out which rental site you are on, so we cannot sign you " +
  "in. Please reload the page.";

const UNEXPECTED_MESSAGE =
  "Something went wrong at our end. Please try again in a moment.";

/**
 * Read the `{ error }` body an edge function returns on a 4xx/5xx.
 *
 * supabase-js hands back a `FunctionsHttpError` whose `context` is the raw
 * `Response`; the message on the error object itself is only ever
 * "Edge Function returned a non-2xx status code", which tells a customer
 * nothing.
 */
async function readFunctionError(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body: unknown = await error.context.clone().json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // A non-JSON body (a gateway page, a truncated response) is not a message
    // worth showing; fall through to the caller's generic copy.
  }
  return null;
}

/** The `code` an edge function's error body carries ('blocked', 'taken' …), if any. */
async function readFunctionCode(error: FunctionsHttpError): Promise<string | null> {
  try {
    const body: unknown = await error.context.clone().json();
    if (typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string") {
      return (body as { code: string }).code;
    }
  } catch {
    // Not JSON: no code.
  }
  return null;
}

/**
 * Load the membership for one auth user on one tenant.
 *
 * Returns `null` for "no account here", which is a legitimate answer and not an
 * error. A genuine query failure also returns `null` after logging — the caller
 * treats both as "not a customer of this site", which is the safe direction:
 * the alternative is admitting somebody because a request timed out.
 */
async function fetchMembership(
  authUserId: string,
  tenantId: string,
): Promise<CustomerMembership | null> {
  const { data, error } = await supabase
    .from("customer_users")
    .select(
      `id, auth_user_id, customer_id, tenant_id, customer:customers(${CUSTOMER_SELECT_CLAUSE})`,
    )
    .eq("auth_user_id", authUserId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
    .overrideTypes<MembershipRow, { merge: false }>();

  if (error) {
    console.error("[customer-auth] Failed to load membership", {
      authUserId,
      tenantId,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return null;
  }

  // A link row whose customer did not come back is not a usable account — it
  // means the customer row was deleted, or is unreadable under RLS.
  if (!data || !data.customer) return null;

  return {
    id: data.id,
    authUserId: data.auth_user_id,
    customerId: data.customer_id,
    tenantId: data.tenant_id,
    customer: data.customer,
  };
}

/**
 * Blocked across operators. An entry that has been whitelisted does not count —
 * that flag is how an operator reverses a block.
 */
async function isGloballyBlacklisted(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (address === "") return false;

  const { data, error } = await supabase
    .from("global_blacklist")
    .select("id, is_whitelisted")
    .eq("email", address)
    .maybeSingle();

  if (error) {
    console.error("[customer-auth] global_blacklist check failed", error.message);
    // Fail OPEN. This is a courtesy message, and RLS is what actually stops a
    // blocked customer doing anything — locking everybody out because one
    // advisory query failed would be the worse bug.
    return false;
  }

  return data !== null && !data.is_whitelisted;
}

/** Blocked by THIS operator, by email. */
async function isIdentityBlocked(
  tenantId: string,
  email: string,
): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (address === "") return false;

  const { data, error } = await supabase
    .from("blocked_identities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("identity_number", address)
    .eq("is_active", true)
    .in("identity_type", ["license", "id_card", "passport", "email"])
    .maybeSingle();

  if (error) {
    console.error("[customer-auth] blocked_identities check failed", error.message);
    return false;
  }

  return data !== null;
}

const BLOCKED_MESSAGE =
  "This account has been blocked. Please contact support if you think that is a mistake.";

/**
 * Both block checks in one call. Returns the customer-facing reason, or null.
 *
 * Run in parallel: they hit different tables and a sign-in already costs three
 * serial round-trips.
 */
async function findBlockReason(
  tenantId: string,
  email: string,
  profile: CustomerProfile,
): Promise<string | null> {
  if (profile.is_blocked) {
    return profile.blocked_reason ?? BLOCKED_MESSAGE;
  }

  const [globally, locally] = await Promise.all([
    isGloballyBlacklisted(email),
    isIdentityBlocked(tenantId, email),
  ]);

  return globally || locally ? BLOCKED_MESSAGE : null;
}

/**
 * Reset the persisted booking draft to empty.
 *
 * `booking-store` keeps the customer's name, email, phone and date of birth in
 * `localStorage` so a half-finished booking survives a reload. On a shared
 * device that must not outlive the session that created it.
 *
 * Two non-obvious things make this work from anywhere, including the portal:
 *
 *  • `booking-store` is `skipHydration: true`, so on a page that never called
 *    `useHydrateBookingStore` its in-memory state is still `INITIAL`. That does
 *    not matter — `reset()` sets `INITIAL` either way, and zustand's `persist`
 *    writes on every `set`, so the stored draft is overwritten regardless of
 *    whether it was ever read back in.
 *  • the storage KEY survives; it is the VALUE that goes blank. `INITIAL` has
 *    empty strings for all four personal fields, so nothing identifying is left
 *    behind.
 *
 * Imported lazily so the two stores do not form a cycle — the same reason v1
 * does it this way.
 */
async function clearBookingDraft(): Promise<void> {
  try {
    const { useBookingStore } = await import("./booking-store");
    useBookingStore.getState().reset();
  } catch (error: unknown) {
    console.error("[customer-auth] Failed to clear the booking draft", error);
  }
}

/* ───────────────────────────────── store ─────────────────────────────────── */

interface CustomerAuthState {
  user: User | null;
  session: Session | null;
  membership: CustomerMembership | null;
  tenant: TenantIdentity | null;

  /** The Supabase session question has been answered (either way). */
  sessionResolved: boolean;
  /** The tenant question has been answered — `setTenant` has been called once. */
  tenantResolved: boolean;
  /** Membership has been looked up for the current (user, tenant) pair. */
  membershipResolved: boolean;
  /** `initialize()` has run. Guards against a second listener on remount. */
  initialized: boolean;

  initialize: () => Promise<void>;
  /** Called by `CustomerAuthProvider` once `TenantContext` settles. */
  setTenant: (tenant: TenantIdentity | null) => void;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** Step 1 of a password reset: email a six-digit code. */
  resetPassword: (email: string) => Promise<AuthResult>;
  /** Step 2: verify the code and set the new password. */
  confirmPasswordReset: (
    email: string,
    code: string,
    newPassword: string,
  ) => Promise<AuthResult>;
  /** Re-read the customer row — after a profile edit, say. */
  refresh: () => Promise<void>;
  /**
   * "Continue with Google", step 1: leave for Google. It comes back to the
   * page it left from, with `?oauth=google` (GOOGLE_RETURN_PARAM) added.
   */
  startGoogleSignIn: () => Promise<AuthResult>;
  /**
   * Step 2, on the page Google returned to: make the Google account a customer
   * of THIS site (the `customer-google-link` function: an existing customer
   * with the same verified email is claimed, else one is created), then run the
   * same membership and block checks every other sign-in runs.
   */
  completeGoogleSignIn: () => Promise<AuthResult>;
}

/** Marks the page Google returned to, so it knows to finish the sign-in. */
export const GOOGLE_RETURN_PARAM = "oauth";

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  /** Optional at sign-up; the booking flow collects it later if it is missing. */
  phone?: string;
}

/**
 * Discards superseded membership lookups.
 *
 * Three things can start one — the auth listener, `setTenant`, and an explicit
 * `refresh()` — and they overlap routinely (a sign-in on a page that is still
 * loading its tenant fires all three within a few hundred ms). Without a token
 * the slowest response wins, which is how a signed-in customer briefly sees
 * "no account on this site".
 */
let membershipToken = 0;

const SIGNED_OUT = {
  user: null,
  session: null,
  membership: null,
} as const;

export const useCustomerAuthStore = create<CustomerAuthState>()((set, get) => {
  /**
   * Resolve membership for whatever (user, tenant) pair is current.
   *
   * Deliberately does nothing until BOTH are known — see note 2 in the file
   * header. `membershipResolved` therefore stays false while the tenant loads,
   * which is what keeps `isLoading` honest instead of flashing a signed-out
   * portal at a signed-in customer.
   */
  const resolveMembership = async (): Promise<void> => {
    const token = ++membershipToken;
    const { user, tenant } = get();

    if (!user) {
      if (token === membershipToken) {
        set({ membership: null, membershipResolved: true });
      }
      return;
    }

    if (!tenant) {
      // No tenant yet — or resolution finished with no tenant at all. Either
      // way there is nothing to scope the lookup to.
      if (token === membershipToken && get().tenantResolved) {
        set({ membership: null, membershipResolved: true });
      }
      return;
    }

    const membership = await fetchMembership(user.id, tenant.id);
    if (token !== membershipToken) return;

    // A customer blocked while signed in keeps a valid Supabase session until
    // it expires, so the check has to run here too, not only at sign-in.
    if (membership?.customer.is_blocked) {
      await supabase.auth.signOut();
      await clearBookingDraft();
      if (token !== membershipToken) return;
      set({ ...SIGNED_OUT, membershipResolved: true });
      return;
    }

    set({ membership, membershipResolved: true });
  };

  /**
   * The current tenant, once `setTenant` has answered (up to 10s). Null when
   * it answered "no tenant here", or never answered.
   */
  const waitForTenant = async (): Promise<TenantIdentity | null> => {
    const deadline = Date.now() + 10_000;
    while (!get().tenantResolved && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return get().tenant;
  };

  return {
    ...SIGNED_OUT,
    tenant: null,
    sessionResolved: false,
    tenantResolved: false,
    membershipResolved: false,
    initialized: false,

    setTenant: (tenant) => {
      const previous = get().tenant;
      const changed = previous?.id !== tenant?.id;

      set({ tenant, tenantResolved: true });

      // Re-scope on a real change only. `TenantContext` refetches on window
      // focus, so this runs on every tab return with the same tenant.
      if (changed || !get().membershipResolved) {
        set({ membershipResolved: false });
        void resolveMembership();
      }
    },

    initialize: async () => {
      if (get().initialized) return;
      set({ initialized: true });

      supabase.auth.onAuthStateChange((event, session) => {
        // Captured BEFORE the set below, which overwrites it — the whole guard
        // downstream turns on whether this is the same person as a moment ago.
        const previousUserId = get().user?.id ?? null;

        // Assigning state is safe inside the callback; CALLING the client is
        // not. Everything that does is deferred below.
        set({ session, user: session?.user ?? null, sessionResolved: true });

        if (!session?.user) {
          set({ membership: null, membershipResolved: true });
          return;
        }

        /*
         * THE SAME PERSON, AGAIN — do nothing.
         *
         * This guard used to read `event === "TOKEN_REFRESHED"`, which covered
         * the hourly refresh and nothing else. Supabase also re-emits
         * `SIGNED_IN` whenever a tab regains focus and revalidates the session,
         * and that fell straight through to `membershipResolved: false` below.
         *
         * `CustomerAuthContext` derives `isLoading` from exactly that flag, and
         * `(portal)/layout.tsx` refuses to mount its children while loading —
         * deliberately, so no page ever runs a query against a stale customer
         * id. Together those meant every switch away and back to the portal tab
         * tore the whole tree down, flashed the skeleton, and replayed every
         * query on the page. Reported as "if I go to another tab and then come
         * back to the customer portal it refreshes again".
         *
         * Keyed on the user id rather than the event name so it holds for any
         * event Supabase chooses to re-emit. A genuinely different user still
         * falls through and re-resolves, which is the case that must not break.
         */
        if (get().membership && session.user.id === previousUserId) return;

        set({ membershipResolved: false });

        /*
          KNOWN TRAP — DO NOT REMOVE THIS setTimeout.
          `onAuthStateChange` holds an internal lock for the duration of its
          callback. Awaiting any supabase call inside it deadlocks the client:
          the request never settles, and the app sits on its loading state
          forever. Yielding to the macrotask queue first releases the lock.
          Carried over verbatim from apps/booking's store.
        */
        setTimeout(() => {
          void resolveMembership();
        }, 0);
      });

      // The listener above emits INITIAL_SESSION on subscribe, but only after a
      // tick. Reading the session directly means the first render already knows
      // the answer instead of flashing signed-out.
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("[customer-auth] getSession failed", error.message);
      }

      set({
        session: session ?? null,
        user: session?.user ?? null,
        sessionResolved: true,
      });

      await resolveMembership();
    },

    signIn: async (email, password) => {
      const { tenant } = get();
      if (!tenant) return fail("no-tenant", NO_TENANT_MESSAGE);

      const address = email.trim().toLowerCase();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: address,
        password,
      });

      if (error || !data.user) {
        // Supabase answers "Invalid login credentials" for a wrong password AND
        // for an address it has never seen — deliberately, so the form cannot
        // be used to enumerate accounts. Do not try to tell them apart.
        if (error && error.status !== undefined && error.status >= 500) {
          return fail(
            "network",
            "We could not reach the sign-in service. Please try again in a moment.",
          );
        }
        return fail(
          "invalid-credentials",
          "That email and password do not match. Check both and try again.",
        );
      }

      let membership = await fetchMembership(data.user.id, tenant.id);

      if (!membership) {
        /*
          Signed in, but no link row for THIS tenant. Before rejecting, look for
          a customer this operator already created — someone who booked as a
          guest, or was added by staff, and is now claiming the account. Their
          `customers` row exists; only the link is missing.
        */
        membership = await linkExistingCustomer(data.user.id, tenant.id, address);
      }

      if (!membership) {
        // Local scope only: this session may be a perfectly good account on
        // ANOTHER operator's site, and rejecting them here must not destroy it.
        await supabase.auth.signOut({ scope: "local" });
        set({ ...SIGNED_OUT, membershipResolved: true });
        return fail(
          "no-account-for-tenant",
          `That email is not registered with ${tenant.name}. Create an account to continue.`,
        );
      }

      const blockReason = await findBlockReason(
        tenant.id,
        address,
        membership.customer,
      );

      if (blockReason) {
        // Global scope: a blocked customer should lose every session they hold.
        await supabase.auth.signOut();
        await clearBookingDraft();
        set({ ...SIGNED_OUT, membershipResolved: true });
        return fail("account-blocked", blockReason);
      }

      // Supersede any lookup the auth listener started for this same sign-in;
      // this one already has the answer.
      membershipToken += 1;
      set({
        user: data.user,
        session: data.session,
        membership,
        sessionResolved: true,
        membershipResolved: true,
      });

      return { ok: true };
    },

    signUp: async ({ email, password, name, phone }) => {
      const { tenant } = get();
      if (!tenant) return fail("no-tenant", NO_TENANT_MESSAGE);

      const address = email.trim().toLowerCase();

      // Refuse before creating anything. v1 does the same, and the ordering
      // matters: an auth user created for a blocked address is an orphan that
      // has to be reclaimed later.
      const [globally, locally] = await Promise.all([
        isGloballyBlacklisted(address),
        isIdentityBlocked(tenant.id, address),
      ]);
      if (globally || locally) {
        return fail("account-blocked", BLOCKED_MESSAGE);
      }

      /*
        One call, three rows, service-role. See note 1 in the file header: this
        is v1's ordering (auth user → customers → customer_users) executed
        somewhere that can actually roll the auth user back when a later write
        fails, which a browser cannot. It also reclaims an orphaned auth user
        left behind by an older half-finished signup, rather than dead-ending
        the customer in the signup ⇄ login loop v1 was patched for.
      */
      const { data, error } = await supabase.functions.invoke("customer-signup", {
        body: {
          email: address,
          password,
          tenant_id: tenant.id,
          customer_name: name.trim(),
          customer_phone: phone?.trim() || null,
        },
      });

      if (error) {
        const reported = await readFunctionError(error);

        if (reported === null) {
          console.error("[customer-auth] customer-signup failed", error);
          return fail("network", UNEXPECTED_MESSAGE);
        }

        if (reported.toLowerCase().includes("already exists")) {
          return fail(
            "email-taken",
            `An account with that email already exists at ${tenant.name}. Sign in instead.`,
          );
        }

        if (reported.toLowerCase().includes("password")) {
          return fail("weak-password", reported);
        }

        console.error("[customer-auth] customer-signup rejected", reported);
        return fail("unexpected", UNEXPECTED_MESSAGE);
      }

      // A 2xx with no `success` is not a shape this function produces; treating
      // it as a win would leave the customer on a portal with no account.
      if (
        typeof data !== "object" ||
        data === null ||
        (data as { success?: unknown }).success !== true
      ) {
        console.error("[customer-auth] customer-signup returned no success", data);
        return fail("unexpected", UNEXPECTED_MESSAGE);
      }

      // The account exists and its email is already confirmed, so this is a
      // plain sign-in — and it runs the same membership + block checks every
      // other sign-in does rather than trusting the write we just made.
      const signedIn = await get().signIn(address, password);

      if (!signedIn.ok) {
        console.error(
          "[customer-auth] Sign-in immediately after signup failed",
          signedIn.failure,
        );
        return fail(
          "unexpected",
          "Your account was created, but we could not sign you in. Please try signing in.",
        );
      }

      return { ok: true };
    },

    startGoogleSignIn: async () => {
      const tenant = await waitForTenant();
      if (!tenant) return fail("no-tenant", NO_TENANT_MESSAGE);

      // Back to this very page (its `?next=` included), marked as the return.
      const back = new URL(window.location.href);
      back.searchParams.set(GOOGLE_RETURN_PARAM, "google");
      back.hash = "";

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: back.toString(),
          // A shared machine must not silently sign the last person back in.
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) {
        console.error("[customer-auth] Google sign-in could not start", error.message);
        return fail("network", "We could not reach Google. Please try again in a moment.");
      }
      // The browser is leaving for Google.
      return { ok: true };
    },

    completeGoogleSignIn: async () => {
      // Google's return lands on a fresh page load, where this runs in the
      // page's first effects: before CustomerAuthProvider's own effect has
      // handed the store the tenant (React runs a child's effects before its
      // parent's). Wait for it rather than reporting "which site is this?".
      const tenant = await waitForTenant();
      if (!tenant) return fail("no-tenant", NO_TENANT_MESSAGE);

      // The session Supabase read from the address Google returned to.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        return fail("unexpected", "Google sign-in was cancelled or did not finish. Please try again.");
      }

      const { data, error } = await supabase.functions.invoke("customer-google-link", {
        body: { tenant_id: tenant.id },
      });

      if (error || (data as { ok?: unknown } | null)?.ok !== true) {
        const reported = error ? await readFunctionError(error) : null;
        // Local scope: the Google session may be a real account on another
        // operator's site, and failing to join this one must not end it.
        await supabase.auth.signOut({ scope: "local" });
        set({ ...SIGNED_OUT, membershipResolved: true });
        const code = error instanceof FunctionsHttpError ? await readFunctionCode(error) : null;
        if (code === "blocked") return fail("account-blocked", reported ?? BLOCKED_MESSAGE);
        if (code === "taken") return fail("email-taken", reported ?? UNEXPECTED_MESSAGE);
        console.error("[customer-auth] customer-google-link failed", reported ?? error);
        return fail("unexpected", reported ?? UNEXPECTED_MESSAGE);
      }

      const user = session.user;
      const membership = await fetchMembership(user.id, tenant.id);
      if (!membership) {
        await supabase.auth.signOut({ scope: "local" });
        set({ ...SIGNED_OUT, membershipResolved: true });
        return fail("unexpected", UNEXPECTED_MESSAGE);
      }

      const blockReason = await findBlockReason(tenant.id, (user.email ?? "").toLowerCase(), membership.customer);
      if (blockReason) {
        await supabase.auth.signOut();
        await clearBookingDraft();
        set({ ...SIGNED_OUT, membershipResolved: true });
        return fail("account-blocked", blockReason);
      }

      // Supersede any lookup the auth listener started for this sign-in.
      membershipToken += 1;
      set({ user, session, membership, sessionResolved: true, membershipResolved: true });
      return { ok: true };
    },

    signOut: async () => {
      // Local scope: signing out of this browser must not end the same person's
      // session on their phone.
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        console.error("[customer-auth] signOut failed", error.message);
      }

      membershipToken += 1;
      set({ ...SIGNED_OUT, membershipResolved: true });
      await clearBookingDraft();
    },

    resetPassword: async (email) => {
      const { tenant } = get();
      const address = email.trim().toLowerCase();

      /*
        Supabase's own recovery code (Oct 21 2026), as the operator's
        forgot-password does: Supabase mints a single-use code and checks it
        itself, which is what proves the customer holds the inbox. This used to
        go through `send-verification-otp` + `verify-otp` +
        `reset-password-with-otp`, and that last function sets ANY account's
        password from an email address alone — it never checks a code.

        `?otp=1` asks the auth email hook (custom-auth-email) for a six-digit
        code in the tenant's branding instead of a link. It rides on the
        tenant's drive-247.com address because that is on the auth allow-list;
        a custom domain or localhost would be swapped for the site URL and the
        marker lost. Supabase answers the same whether or not the address has
        an account, so the page still cannot be used to discover accounts.
      */
      const origin =
        tenant?.slug
          ? `https://${tenant.slug}.drive-247.com`
          : typeof window !== "undefined"
            ? window.location.origin
            : "";
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${origin}/forgot-password?otp=1`,
      });

      if (error) {
        console.error("[customer-auth] resetPasswordForEmail failed", error.message);
        if (error.status === 429) {
          return fail("network", "Too many codes were requested. Please wait a few minutes and try again.");
        }
        return fail(
          "network",
          "We could not send the code. Please try again in a moment.",
        );
      }

      return { ok: true };
    },

    confirmPasswordReset: async (email, code, newPassword) => {
      const address = email.trim().toLowerCase();

      // Checking the code signs the customer in for the recovery session.
      const { error: codeError } = await supabase.auth.verifyOtp({
        type: "recovery",
        email: address,
        token: code.trim(),
      });
      if (codeError) {
        return fail(
          "invalid-code",
          "That code is not right, or it has expired. Request a new one.",
        );
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

      // Either way the recovery session ends here: the customer signs in with
      // the new password, which runs this site's membership and block checks
      // exactly as before.
      await supabase.auth.signOut({ scope: "local" });

      if (updateError) {
        const reported = updateError.message ?? "";
        if (reported.toLowerCase().includes("password")) {
          return fail("weak-password", reported);
        }
        console.error("[customer-auth] updateUser(password) failed", reported);
        return fail("unexpected", UNEXPECTED_MESSAGE);
      }

      return { ok: true };
    },

    refresh: async () => {
      await resolveMembership();
    },
  };
});

/**
 * Claim an existing customer record that has no auth link yet.
 *
 * The case: this operator already holds a `customers` row for the address —
 * from a guest booking, or created by staff — and the person has now signed up
 * for the portal. Their profile and rental history are already there; only the
 * `customer_users` row is missing.
 *
 * Returns null when there is nothing to claim, which is the caller's signal to
 * reject the sign-in. Match is on email AND tenant: an unscoped match would
 * hand somebody another operator's customer record.
 */
async function linkExistingCustomer(
  authUserId: string,
  tenantId: string,
  email: string,
): Promise<CustomerMembership | null> {
  const { data: existing, error: lookupError } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();

  if (lookupError) {
    console.error("[customer-auth] Customer lookup failed", lookupError.message);
    return null;
  }

  if (!existing) return null;

  const { error: linkError } = await supabase.from("customer_users").insert({
    auth_user_id: authUserId,
    customer_id: existing.id,
    tenant_id: tenantId,
  });

  if (linkError) {
    // 23505 is `customer_users_auth_user_tenant_unique`: a concurrent sign-in
    // (a second tab) created the link first. That is the outcome we wanted, so
    // read it back rather than failing.
    if (linkError.code !== "23505") {
      console.error("[customer-auth] Auto-link failed", {
        message: linkError.message,
        code: linkError.code,
        details: linkError.details,
      });
      return null;
    }
  }

  return fetchMembership(authUserId, tenantId);
}
