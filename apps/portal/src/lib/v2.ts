/**
 * v2 area gates.
 *
 * v2 is being built on `main`, against the same production database the ~32
 * paying tenants are running on right now. Every v2 area is gated so that the
 * `northwind` canary sees it and nobody else does. See V2_PLAN.md §2.
 *
 * TWO SOURCES, ONE ANSWER (Sep 17 2026)
 * -------------------------------------
 * A tenant is on v2 for an area when EITHER
 *   (a) its slug is listed for that area in `V2_AREAS` below — the original
 *       hand-widened canary list, unchanged; or
 *   (b) `tenants.portal_experience = 'v2'` — a per-tenant switch carried on the
 *       row, passed in here as `onV2`.
 *
 * (b) exists because self-serve signups through drive-247.com must LAND on v2:
 * a tenant that does not exist yet cannot be in a list compiled at build time,
 * and "deploy a slug then tell the operator to reload" is not a signup flow.
 * (a) stays because it is how an EXISTING tenant is widened one at a time, and
 * because it cannot fail: northwind keeps working with no column, no grant and
 * no query, exactly as it does today.
 *
 * This module stays PURE — `onV2` is an argument, never a lookup. The row is
 * read once per request on the server (`lib/portal-tenant.ts`), the gates are
 * resolved once there (`lib/v2-server.ts`), and client components read the
 * answers out of context (`lib/v2-context.tsx`). Nothing here holds state,
 * because this module is shared across every request the server handles and a
 * cached answer would be one tenant's gate served to the next tenant.
 *
 * Why a column is safe NOW when the header of this file used to argue it was
 * not: the objection was never the idea, it was the GRANT. `anon` holds
 * COLUMN-level SELECT grants on `tenants`, so a new column without its own
 * GRANT makes Postgres refuse the WHOLE row — every tenant's branding, not just
 * the new flag. So the grant ships with the column (see `ops/`), and the one
 * reader retries without the column on a column/permission error, which keeps
 * a missing grant to "everybody is v1" instead of "nobody has a title".
 *
 * Widening an area by SLUG is still an edit to `V2_AREAS` and a deploy:
 * reviewed like any other change, reverted like any other change, and recorded
 * in `git log`. Retiring one is deleting its entry, deleting the branch in the
 * route, and deleting the v1 directory. Three deletions, no judgement calls.
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

export type V2Area =
  | 'appearance'
  | 'theme'
  | 'dashboard'
  | 'chrome'
  | 'login'
  | 'rentals'
  | 'customers'
  | 'cms'
  | 'vehicles'
  | 'insights'
  | 'availability'
  | 'turo'
  | 'referrals';

/**
 * One entry per v2 area. Today every list is just the canary.
 *
 * Widen one step at a time, and only once the previous step has been live long
 * enough to have failed:  northwind → 1–2 friendly tenants → everyone.
 *
 * Keyed by `V2Area` rather than by `string`, so adding a member to the union
 * without adding it here is a compile error rather than a gate that quietly
 * answers v1.
 */
const V2_AREAS: Record<V2Area, readonly string[]> = {
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
  /** The customer record — a scoped rail in place of the sidebar, no Save. */
  customers: [NORTHWIND],
  /** Website Content — the CMS overview and the per-page section editor. */
  cms: [NORTHWIND],
  /** The vehicle record — a scoped rail in place of the sidebar. LIST is still v1. */
  vehicles: [NORTHWIND],
  /**
   * `/insights` — one screen of honest money, intended to replace `/reports`
   * and `/pl-dashboard`. Neither of those is touched; both keep serving every
   * tenant until this has been proved on the canary and widened.
   */
  insights: [NORTHWIND],
  /**
   * `/blocked-dates` — the Availability screen as a week calendar, in place of
   * a table of blocked ranges plus a form of seven weekday rows.
   *
   * Currently a READ-ONLY preview: it reads the tenant's real working hours and
   * blocked dates and writes nothing, so widening this entry cannot change any
   * tenant's actual availability — only what they are shown. The v1 cards are
   * untouched and still serve everyone else.
   */
  availability: [NORTHWIND],
  /**
   * `/turo-bridge` — Turo Sync. Grafted from feat/turo-extension, where it had
   * been built, deployed and left unmerged.
   *
   * THIS GATE IS NOT THE SAME THING AS `tenants.turo_bridge_enabled`, and the
   * difference is the whole reason it exists. That column is the OPERATOR's own
   * switch and it is already `true` for five tenants in production — two of
   * them live operators (jangramrentals, nealcorentals) who were part of the
   * PoC. Landing this screen gated only on the column would have put it in
   * front of them the moment it deployed.
   *
   * So the column stays the operator's opt-in and this entry decides who may
   * reach the screen at all. Both must agree. Widening is deleting nothing and
   * adding a slug here, once the canary has run it long enough to have failed.
   */
  turo: [NORTHWIND],
  /**
   * `/referrals` — the operator's Drive247 referral programme page: their code
   * and link, their reward tier, who they referred. A new route with no v1
   * counterpart, shown in BOTH rails (v1 and v2) for every tenant listed here.
   *
   * Widening this to everyone is the plan (brief: "every operator has a
   * Referrals page"); it goes the usual way — canary, then friendly tenants,
   * then everyone. The programme itself only gives codes to subscribed
   * operators, and the page says so to anyone else.
   */
  referrals: [NORTHWIND],
};

/**
 * Every area, for the one place that has to resolve them all: the root layout.
 *
 * Derived from `V2_AREAS` rather than written out a second time. `layout.tsx`
 * used to keep its own hand-maintained copy of this list, which meant adding an
 * area here and forgetting it there produced a gate that resolved to v1 for
 * every tenant — no error, no failed build, no failed check. That is exactly
 * the failure V2_PLAN §2 calls the worst this model can produce, wearing a
 * different hat.
 */
export const V2_AREA_LIST = Object.keys(V2_AREAS) as V2Area[];

/**
 * The value `tenants.portal_experience` must hold for a tenant to be on v2.
 *
 * Compared with `===`, so NULL, '', 'V2', 'v3' and a missing column are all v1.
 * The column's CHECK constraint already restricts it to ('v1','v2'); this is
 * the second half of the same guarantee, on the read side, for the window
 * before the constraint exists and for any row that bypasses it.
 */
const V2_EXPERIENCE = 'v2';

/**
 * Is a tenant row's `portal_experience` the v2 one?
 *
 * Takes the raw column value and fails closed on everything that is not
 * exactly `'v2'` — null, undefined, a typo, a future value this build has never
 * heard of, or the `undefined` you get when the column was not selected at all
 * because the grant is missing. All of those are tenants that are running fine
 * on v1 right now, and none of them asked to be moved.
 */
export function isV2Experience(portalExperience: string | null | undefined): boolean {
  return portalExperience === V2_EXPERIENCE;
}

/**
 * Is this tenant on v2 for this area?
 *
 * Two independent ways in, OR'd:
 *  - `tenantSlug` is listed for `area` in `V2_AREAS` (the canary list), or
 *  - `onV2` is true, i.e. the tenant's row says `portal_experience = 'v2'`.
 *
 * `onV2` defaults to false so every caller that has not been given the row —
 * and every test written before the column existed — keeps answering exactly
 * what it answered before.
 *
 * Fails to v1 on every unknown, INCLUDING a missing slug with `onV2` set. That
 * combination cannot arise in the product — `onV2` is only ever true because we
 * read a row by that slug — so requiring the slug costs nothing and keeps one
 * rule to state: no resolved tenant, no v2. A gate that fails *open* puts all
 * 57 tenants on unfinished code at once, which is the one outcome this whole
 * model exists to prevent.
 */
export function isV2(
  area: V2Area,
  tenantSlug: string | null | undefined,
  onV2: boolean = false,
): boolean {
  if (!tenantSlug) return false;
  if (onV2) return true;
  return V2_AREAS[area]?.includes(tenantSlug) ?? false;
}
