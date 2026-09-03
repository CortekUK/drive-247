/**
 * Lean-product area gates.
 *
 * The lean v2 product ships a deliberately smaller surface than v1. Areas that
 * v1 tenants depend on but the lean product does not carry are hidden HERE,
 * in the presentation layer only — nothing is removed.
 *
 * That distinction is load-bearing. Measured against production:
 *   - `enquiries_enabled`      is ON for 51 tenants
 *   - `lead_management_enabled` is ON for 3 tenants (4 live rows)
 *   - `automations_enabled`     is ON for 1 tenant
 * Enquiries in particular is one of the most-used features in the product.
 * Deleting any of it would be an outage, so this gate decides what a lean
 * tenant's operator SEES; the routes, hooks, components, edge functions and
 * cron jobs behind them are untouched and keep serving everyone else.
 *
 * Keyed on tenant SLUG, not tenant id.
 * ------------------------------------
 * The same tenant has a DIFFERENT primary key in every environment —
 * `northwind` is 6e5c544f-… in production but 8e6bc88f-… on the staging
 * branch, because staging was seeded rather than cloned. An id-keyed gate
 * therefore resolves to the ungated path on localhost with no error and no
 * failed build: the code is right, the build is right, and the screen simply
 * never changes. The slug is stable across every environment, so it cannot
 * drift that way.
 *
 * TODO: fold into `lib/v2.ts` once the in-flight v2 gating work lands. That
 * module owns the same idea (id-keyed, with both environments' ids listed);
 * this one exists separately only to avoid editing a file another session is
 * currently rewriting. When merging, prefer this module's slug key.
 */

/**
 * Tenants running the lean v2 product, by slug.
 *
 * Annotated `readonly string[]` rather than written `as const` ON PURPOSE.
 * `as const` narrows the element type to the literal union `'northwind'`,
 * which narrows `Array.prototype.includes` to accept only that literal — so
 * `LEAN_TENANTS.includes(someString)` stops being a membership test and
 * becomes a compile error. Portal builds with `ignoreBuildErrors: true`, so
 * that error is discarded at build time and the gate ships broken. The
 * annotation keeps `.includes()` type-checking against `string`.
 */
const LEAN_TENANTS: readonly string[] = ['northwind'];

/**
 * Areas hidden from lean tenants.
 *
 * `quotes` is here for a different reason than the other three, and the
 * difference is worth recording. Enquiries/Leads/Automations are v1 areas the
 * lean product does not carry. Fleet Quotes was briefly DELETED from main
 * instead of gated (43b97af1, reverted in 5acae08a) on the mistaken reading
 * that it was the same kind of thing. It was not: its nav entry sat
 * unconditionally next to Rentals behind no flag, so all 35+ paying tenants
 * had it. Hiding it from the canary belongs here, in the presentation layer,
 * exactly like the other three — the route, hook and pricing rules stay on
 * main and keep serving everyone else.
 *
 * `tesla` is the same story, and a costlier one. The Tesla Fleet integration
 * was DELETED from main (2ee1fd13 + 40dbdcbb, both reverted in c37e0f55)
 * rather than gated. Jangram Rentals — a live Denver operator with 6 Teslas,
 * 5 of them wired to the Fleet API — lost automatic Supercharger billing for
 * the duration: no hourly poll, no session-to-rental matching, no Supercharger
 * line to Charge or Waive. Open Bay Rental also has the integration connected.
 * Only the UI is gated here; the edge functions, `tesla-sync-engine` and cron
 * job 36 `sync-tesla-charges-hourly` are deliberately NOT touched, because the
 * canary has no Tesla vehicles and no Tesla connection — the server side is
 * already inert for it, and reaching into that path would put the very billing
 * we just repaired back at risk.
 *
 * `welcome` is the Welcome Pack — the in-portal operator guide at `/welcome`.
 * It is gated here rather than removed because it is being READ RIGHT NOW:
 * `welcome_pack_reads` holds 184 rows from 16 operators across 14 tenants,
 * the newest at 2026-09-02 20:45 UTC, against 12 chapters / 59 sections /
 * 62 FAQs of content. Deleting it from main would take the guide from all 35+
 * paying tenants at once to hide it from one canary — the exact inversion the
 * Fleet Quotes and Tesla Fleet removals above already cost us. So the route,
 * the components, the `use-welcome-pack` hook, the four `welcome_pack_*`
 * tables and the super-admin authoring screen in apps/admin all stay exactly
 * where they are and keep serving everyone else; only what northwind SEES
 * changes.
 */
export const LEAN_HIDDEN_AREAS = ['enquiries', 'leads', 'automations', 'quotes', 'tesla', 'welcome'] as const;

export type LeanHiddenArea = (typeof LEAN_HIDDEN_AREAS)[number];

/**
 * Should `area` be hidden from the tenant identified by `tenantSlug`?
 *
 * Fails OPEN on every unknown: a null, undefined or not-yet-resolved slug
 * gets everything it has today. The gate exists to take three areas away from
 * one canary tenant — never to take them away from a tenant whose identity we
 * simply have not resolved yet (the slug is null for a tick on first paint,
 * and stays null on an unrecognised host).
 */
export function isAreaHidden(
  area: LeanHiddenArea,
  tenantSlug: string | null | undefined,
): boolean {
  if (!tenantSlug) return false;
  if (!LEAN_HIDDEN_AREAS.includes(area)) return false;
  return isLeanTenant(tenantSlug);
}

/**
 * Is this tenant on the lean v2 product?
 *
 * Same fail-open contract as `isAreaHidden`: an unresolved slug is NOT lean, so
 * every gate built on this keeps v1 behaviour until the tenant is known.
 */
export function isLeanTenant(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return LEAN_TENANTS.includes(tenantSlug);
}

/**
 * The lean product has NO test modes — BoldSign is always live.
 *
 * Resolves the mode a *tenant* signs in. Lean tenants get `live` whatever
 * `tenants.boldsign_mode` says; everyone else keeps the historical default of
 * `test` unless the column explicitly says `live`.
 *
 * SCOPE — tenant-level resolution only. Callers still prefer the mode recorded
 * on the agreement/rental row when there is one, and that history is NOT
 * rewritten: a document created in the BoldSign sandbox must keep being read
 * with the sandbox key or it 404s. New records for a lean tenant simply record
 * `live`, because creation resolves through here.
 *
 * Mirrored, because the three runtimes cannot share a module:
 *  - booking : apps/booking/src/lib/lean-tenants.ts
 *  - edge fns: supabase/functions/_shared/lean-tenants.ts
 * Every mirror must carry the same tenant list.
 */
export function resolveBoldSignMode(
  tenantMode: string | null | undefined,
  tenantSlug: string | null | undefined,
): 'test' | 'live' {
  if (isLeanTenant(tenantSlug)) return 'live';
  return tenantMode === 'live' ? 'live' : 'test';
}

/**
 * Should test/live mode switches, TEST badges and sandbox-override UI be hidden?
 *
 * PRESENTATION ONLY, and the distinction is load-bearing. This changes nothing
 * about what a tenant's mode actually IS: `tenants.stripe_mode` and
 * `tenants.bonzah_mode` are untouched, and the 66 edge functions that branch on
 * `stripe_mode` keep seeing exactly what they saw before. A lean tenant still
 * transacts in whatever mode its columns say — it is simply not shown a switch
 * and a badge for a concept the lean product does not have.
 *
 * Flipping a lean tenant's Stripe to live for real is a money decision, not a
 * UI cleanup, and is deliberately NOT done here.
 */
export function isTestModeUiHidden(tenantSlug: string | null | undefined): boolean {
  return isLeanTenant(tenantSlug);
}
