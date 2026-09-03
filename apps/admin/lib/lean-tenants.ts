/**
 * Lean-product tenant gate — admin-console mirror.
 *
 * MIRROR — this file is duplicated on purpose. The runtimes cannot share a
 * module (portal, booking and admin are separate Next apps with separate `@`
 * aliases — admin's maps to the project root, not `./src`; edge functions are
 * Deno with URL imports), so the same tenant list lives in:
 *   - portal  : apps/portal/src/lib/lean-areas.ts          (canonical)
 *   - booking : apps/booking/src/lib/lean-tenants.ts
 *   - admin   : this file
 *   - edge fns: supabase/functions/_shared/lean-tenants.ts
 * Changing the list in one place without the others yields a HALF-GATED mode.
 *
 * Keyed on tenant SLUG, not tenant id.
 * ------------------------------------
 * The same tenant has a DIFFERENT primary key in every environment —
 * `northwind` is 6e5c544f-… in production but 8e6bc88f-… on the staging branch,
 * because staging was seeded rather than cloned. An id-keyed gate therefore
 * resolves to the ungated path on localhost with no error and no failed build:
 * the code is right, the build is right, and the screen simply never changes.
 * The slug is stable across every environment, so it cannot drift that way.
 *
 * WHY THE ADMIN CONSOLE HAS ONE AT ALL
 * ------------------------------------
 * Almost nothing here is tenant-scoped in the sense this gate cares about — the
 * console is a super-admin tool that looks ACROSS tenants. The exception is the
 * tenant detail page, which is a view OF one tenant: its Finance Sync tab reads
 * that tenant's `financial_events` ledger and nothing else. When a feature is
 * parked for a tenant, the per-tenant view of that feature is part of the
 * surface being parked, so it is gated here too. Nothing cross-tenant is.
 */

/**
 * Tenants running the lean v2 product, by slug.
 *
 * Annotated `readonly string[]` rather than written `as const` ON PURPOSE.
 * `as const` narrows the element type to the literal union `'northwind'`, which
 * narrows `Array.prototype.includes` to accept only that literal — so
 * `LEAN_TENANTS.includes(someString)` stops being a membership test and becomes
 * a compile error rather than a runtime check. The annotation keeps
 * `.includes()` type-checking against `string`.
 *
 * Admin is one of the two apps that does NOT set `ignoreBuildErrors`, so here
 * the mistake would at least fail the build rather than ship silently — but the
 * annotation is kept identical to the other three mirrors on purpose, so the
 * four files stay diffable against each other.
 */
const LEAN_TENANTS: readonly string[] = ['northwind'];

/**
 * Is this tenant on the lean v2 product?
 *
 * Fails OPEN on every unknown: a null, undefined or not-yet-loaded slug is NOT
 * lean, so every gate built on this keeps v1 behaviour until the tenant is
 * actually known. The admin tenant page holds `tenant` as `null` until its
 * fetch resolves, so this is hit on the first render of every page load.
 */
export function isLeanTenant(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return LEAN_TENANTS.includes(tenantSlug);
}
