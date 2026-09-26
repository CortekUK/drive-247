/**
 * Who sees payment plans, decided in one place.
 *
 * TWO conditions, both required:
 *
 *   1. The tenant is the canary — `tenant.slug === 'northwind'`, by SLUG and
 *      never by id (northwind has different ids in production and on staging;
 *      see `NORTHWIND` in lib/v2.ts). Every other tenant sees the product
 *      exactly as it was: four booking modes, no plan card, no new entry.
 *
 *   2. The tables exist. Slice 1 ships the migration as a FILE; it is applied
 *      separately. Until it is, PostgREST answers "relation does not exist"
 *      (Postgres 42P01) or "Could not find the table … in the schema cache"
 *      (PGRST205), and the feature must simply not be there — nothing may
 *      break, nothing may show an error, before the migration is applied.
 *
 * Fails CLOSED: an unknown tenant, a probe still running, or a probe that
 * failed for any reason all mean "off". A canary operator who briefly sees the
 * old four cards is fine; a non-canary operator who sees a half-wired plan
 * form is not.
 */

import { NORTHWIND } from "@/lib/v2";

export const PAYMENT_PLANS_CANARY_SLUG = NORTHWIND;

export function isPaymentPlansTenant(slug: string | null | undefined): boolean {
  return slug === PAYMENT_PLANS_CANARY_SLUG;
}

/** The error shapes that mean "the payment-plan tables are not in this database yet". */
export function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  const text = [e.message, e.details, e.hint].filter((x) => typeof x === "string").join(" ");
  return /relation "?[\w.]*payment_plan[\w]*"? does not exist/i.test(text) || /could not find the table '?[\w.]*payment_plan/i.test(text);
}

/** The minimum a probe needs from a Supabase client — so tests can hand in a stub. */
export interface ProbeClient {
  from: (table: string) => {
    select: (columns: string) => { limit: (n: number) => PromiseLike<{ data?: unknown; error: unknown }> };
  };
}

export type ProbeResult = "available" | "missing" | "error";

/**
 * Is the `payment_plans` table reachable for this user? A GET of at most one
 * id — RLS lets tenant staff SELECT their own rows, and an empty table still
 * answers `[]`, which is "available".
 *
 * NOT a HEAD request. That is what this used to be, and it was wrong in the one
 * case the probe exists for: on a database without the table PostgREST answers
 * HEAD with a 404 and — like every HEAD response — no body, and postgrest-js
 * turns a 404 with an empty body into a SUCCESS (node_modules/@supabase/
 * postgrest-js/dist/index.mjs:151). So production, where the migration is not
 * applied, read as "available" for northwind and every plan query after it
 * failed ("Couldn't load your finances", Sep 26 2026). A GET carries the
 * PGRST205 body, and "available" now also requires an actual rows array, so a
 * body-less success can never read as a table that exists.
 */
export async function probePaymentPlans(client: ProbeClient): Promise<ProbeResult> {
  try {
    const { data, error } = await client.from("payment_plans").select("id").limit(1);
    if (error) return isMissingRelation(error) ? "missing" : "error";
    return Array.isArray(data) ? "available" : "error";
  } catch (err) {
    return isMissingRelation(err) ? "missing" : "error";
  }
}
