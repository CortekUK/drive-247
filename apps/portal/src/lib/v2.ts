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
 * The canary. A real tenant row carrying synthetic data only.
 *
 * TWO ids, because `northwind` exists in both databases with DIFFERENT primary
 * keys — the staging branch was seeded separately, not cloned. Local dev points
 * at staging (`npm run db:switch`), so a prod-only id here makes every gate
 * silently resolve to v1 on localhost while working correctly in production.
 * That is a confusing failure: the code is right, the build is right, and the
 * screen is simply never the new one.
 *
 * Listing both is safe. A staging id can never match a production tenant, so
 * the extra entry widens nothing.
 */
export const NORTHWIND_PROD = '6e5c544f-b374-451f-a662-360a634bff15';
export const NORTHWIND_STAGING = '8e6bc88f-86d6-4468-8610-73f7c8a88f6e';

/** Every environment's canary. Use this in `V2_AREAS`, not a bare id. */
export const NORTHWIND: readonly string[] = [NORTHWIND_PROD, NORTHWIND_STAGING];

/**
 * One entry per v2 area. Today every list is just the canary.
 *
 * Widen one step at a time, and only once the previous step has been live long
 * enough to have failed:  northwind → 1–2 friendly tenants → everyone.
 */
const V2_AREAS = {
  /** Settings → Appearance. A new route; v1 has no counterpart. */
  appearance: [...NORTHWIND],
  /**
   * The v2 design tokens, scoped to `.v2-theme` on <body>.
   * Restyles every shadcn primitive for gated tenants without editing one of
   * them — see styles/v2-theme.css.
   */
  theme: [...NORTHWIND],
  /** The v2 dashboard — new home screen body and its widgets. */
  dashboard: [...NORTHWIND],
  /** The v2 sidebar, user menu and right-edge dock. */
  chrome: [...NORTHWIND],
  /** The v2 split-hero login screen. */
  login: [...NORTHWIND],
  /** The v2 rentals list filter panel. */
  rentals: [...NORTHWIND],
} satisfies Record<string, readonly string[]>;

export type V2Area = keyof typeof V2_AREAS;

/**
 * Is this tenant on v2 for this area?
 *
 * Fails to v1 on every unknown: a null, undefined or unrecognised tenant gets
 * the screen it already had. A gate that fails *open* puts all 57 tenants on
 * unfinished code at once, which is the one outcome this whole model exists to
 * prevent.
 */
export function isV2(area: V2Area, tenantId: string | null | undefined): boolean {
  if (!tenantId) return false;
  return V2_AREAS[area].includes(tenantId);
}
