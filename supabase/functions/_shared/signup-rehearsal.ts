// =============================================================================
// signup-rehearsal — the developer's repeatable signup, for ONE email address.
//
// The super-admin Developer page (apps/admin /admin/developer) keeps one row in
// `public.dev_signup_rehearsal`: an email, whether that email's signup should
// land in the `northwind` canary, and which Stripe mode it pays in. The signup
// functions ask this module "is this the rehearsal address?" and nothing more.
//
// THE CONTRACT EVERY CALLER RELIES ON: for any address that is not the
// rehearsal email — i.e. every real customer — `readRehearsalFor` answers null
// and the caller runs exactly the code it ran before this file existed. It
// never throws; a missing table, a read error or an unexpected value is null.
// =============================================================================

import { getSignupStripeMode } from "./signup-stripe.ts";

/** The canary a linked rehearsal is provisioned into. Keyed on SLUG (V2_PLAN §2). */
export const REHEARSAL_TENANT_SLUG = "northwind";

export interface Rehearsal {
  email: string;
  linkToNorthwind: boolean;
  stripeMode: "test" | "live";
}

/**
 * The rehearsal settings, but only when `email` IS the rehearsal address.
 * Null for everyone else, and null on any failure.
 */
export async function readRehearsalFor(
  supabase: any,
  email: string | null | undefined,
): Promise<Rehearsal | null> {
  const wanted = String(email ?? "").trim().toLowerCase();
  if (!wanted) return null;
  try {
    const { data, error } = await supabase
      .from("dev_signup_rehearsal")
      .select("email, link_to_northwind, stripe_mode")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return null;
    const configured = String(data.email ?? "").trim().toLowerCase();
    if (!configured || configured !== wanted) return null;
    return {
      email: configured,
      linkToNorthwind: data.link_to_northwind === true,
      stripeMode: data.stripe_mode === "live" ? "live" : "test",
    };
  } catch (e) {
    console.warn("[signup-rehearsal] could not read dev_signup_rehearsal (treated as not a rehearsal):", e);
    return null;
  }
}

/** The Stripe mode a signup should lock: the rehearsal's choice, else the env default. */
export function signupModeFor(rehearsal: Rehearsal | null): "test" | "live" {
  return rehearsal ? rehearsal.stripeMode : getSignupStripeMode();
}

/**
 * Is this app_users row the rehearsal address's PARKED owner record?
 *
 * The Developer page's reset deletes the auth user, and
 * `app_users.auth_user_id` is `ON DELETE SET NULL` — so northwind's owner row
 * stays (with everything that references it) and simply loses its login. The
 * "already a portal account" checks in signup-begin / signup-begin-oauth must
 * not count that row against the rehearsal address, or the reset would leave
 * it unable to sign up again.
 */
export function isParkedRow(row: { auth_user_id?: string | null }): boolean {
  return !row.auth_user_id;
}
