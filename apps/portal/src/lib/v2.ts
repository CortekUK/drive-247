/**
 * v2 area gates.
 *
 * v2 is being built on `main`, against the same production database the ~32
 * paying tenants are running on right now. Every v2 area is gated so that the
 * `northwind` canary sees it and nobody else does. See V2_PLAN.md §2.
 *
 * Deliberately NOT a column on `public.tenants`:
 *   - `tenants` already carries 269 columns, 73 of them boolean, many orphaned
 *     from features that shipped or were withdrawn years ago.
 *   - `anon` holds COLUMN-level SELECT grants on that table, so a new column
 *     without its own GRANT makes Postgres refuse the WHOLE row — taking every
 *     tenant's branding down, not just the flag you added.
 *   - A gate here costs no column, no grant, no migration and no query.
 *
 * Widening an area is an edit to `V2_AREAS` and a deploy: reviewed like any
 * other change, reverted like any other change, and recorded in `git log`.
 * Retiring one is deleting its entry, deleting the branch in the route, and
 * deleting the v1 directory. Three deletions, no judgement calls.
 */

/**
 * The canary's SLUG, not its id.
 *
 * `northwind` exists in production and on the staging branch with DIFFERENT
 * primary keys, because staging was seeded separately rather than cloned. An
 * id-keyed gate therefore resolves to v1 in whichever environment it was not
 * written against — silently, with no error, no failed build and no failed
 * check, so the screen simply is never the new one and it reads as an
 * unfinished feature. That happened here.
 *
 * The slug is stable across every environment, and it is already in the
 * `x-tenant-slug` header the middleware sets — so keying on it also removes a
 * per-request Supabase round trip that existed only to turn the slug back into
 * an id in order to compare UUIDs.
 */
export const NORTHWIND = 'northwind';

/**
 * One entry per v2 area. Today every list is just the canary.
 *
 * Widen one step at a time, and only once the previous step has been live long
 * enough to have failed:  northwind → 1–2 friendly tenants → everyone.
 */
const V2_AREAS: Record<string, readonly string[]> = {
  /** Settings → Appearance. A new route; v1 has no counterpart. */
  appearance: [NORTHWIND],
  /** The v2 design tokens, scoped to `.v2-theme` on <body>. */
  theme: [NORTHWIND],
  /** The v2 dashboard — new home screen body and its widgets. */
  dashboard: [NORTHWIND],
  /** The v2 sidebar, user menu and right-edge dock. */
  chrome: [NORTHWIND],
  /** The v2 split-hero login screen. */
  login: [NORTHWIND],
  /** The v2 rentals list filter panel. */
  rentals: [NORTHWIND],
};

export type V2Area =
  | 'appearance'
  | 'theme'
  | 'dashboard'
  | 'chrome'
  | 'login'
  | 'rentals';

/**
 * Is this tenant on v2 for this area?
 *
 * Fails to v1 on every unknown: a null, undefined or unrecognised tenant gets
 * the screen it already had. A gate that fails *open* puts all 57 tenants on
 * unfinished code at once, which is the one outcome this whole model exists to
 * prevent.
 */
export function isV2(area: V2Area, tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return V2_AREAS[area]?.includes(tenantSlug) ?? false;
}
