// =============================================================================
// signup-rehearsal — the developer's repeatable signups, for chosen addresses.
//
// Two places name a rehearsal address, and they are read in this order:
//
//   1. The super-admin Developer page (apps/admin /admin/developer) keeps one
//      row in `public.dev_signup_rehearsal`: an email, whether that email's
//      signup should land in the `northwind` canary, and which Stripe mode it
//      pays in. Unchanged; it wins when an address is in both places.
//   2. The developer hub (apps/developer, Onboarding tab) keeps a list in
//      `public.dev_signup_test_emails`. An address on it, switched on, signs up
//      on TEST Stripe and creates its own company (never northwind).
//
// The signup functions ask this module "is this a rehearsal address?" and
// nothing more.
//
// THE CONTRACT EVERY CALLER RELIES ON: for any address that is in neither
// place — i.e. every real customer — `readRehearsalFor` answers null and the
// caller runs exactly the code it ran before this file existed. It never
// throws; a missing table, a read error or an unexpected value is null.
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
 * The rehearsal settings, but only when `email` IS a rehearsal address.
 * Null for everyone else, and null on any failure.
 */
export async function readRehearsalFor(
  supabase: any,
  email: string | null | undefined,
): Promise<Rehearsal | null> {
  const wanted = String(email ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (await readDeveloperPageRehearsal(supabase, wanted)) ?? (await readHubTestEmail(supabase, wanted));
}

/** 1. The Developer page's single row. */
async function readDeveloperPageRehearsal(supabase: any, wanted: string): Promise<Rehearsal | null> {
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

/** 2. The developer hub's test list: on means test Stripe and a company of its own. */
async function readHubTestEmail(supabase: any, wanted: string): Promise<Rehearsal | null> {
  try {
    const { data, error } = await supabase
      .from("dev_signup_test_emails")
      .select("email, enabled")
      .eq("email", wanted)
      .maybeSingle();
    if (error || !data || data.enabled !== true) return null;
    return { email: wanted, linkToNorthwind: false, stripeMode: "test" };
  } catch (e) {
    console.warn("[signup-rehearsal] could not read dev_signup_test_emails (treated as not a rehearsal):", e);
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
