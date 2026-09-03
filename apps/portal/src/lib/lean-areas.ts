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

/** Areas hidden from lean tenants. */
export const LEAN_HIDDEN_AREAS = ['enquiries', 'leads', 'automations'] as const;

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
  return LEAN_TENANTS.includes(tenantSlug);
}
