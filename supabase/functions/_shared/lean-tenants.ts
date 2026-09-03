/**
 * Lean-product tenant gate — edge-function (Deno) mirror.
 *
 * The lean v2 product ships a deliberately smaller surface than v1, and has NO
 * test modes: everything is live, and a missing prerequisite is reported plainly
 * rather than silently producing a broken flow.
 *
 * MIRROR — this file is duplicated on purpose. The three runtimes cannot share a
 * module (portal and booking are separate Next apps with separate `@` aliases;
 * edge functions are Deno with URL imports), so the same tenant list lives in:
 *   - portal  : apps/portal/src/lib/lean-areas.ts          (canonical)
 *   - booking : apps/booking/src/lib/lean-tenants.ts
 *   - edge fns: this file
 * Changing the list in one place without the others yields a HALF-GATED mode,
 * which is worse than no gate: signing would start live in the app while the
 * `boldsign-webhook` downloaded the signed PDF with the test key, and the
 * document 404s — leaving a signed agreement no one can retrieve.
 *
 * Keyed on tenant SLUG, not tenant id.
 * ------------------------------------
 * The same tenant has a DIFFERENT primary key in every environment (`northwind`
 * is 6e5c544f-… in production but 8e6bc88f-… on the staging branch, which was
 * seeded rather than cloned). An id-keyed gate therefore resolves to the ungated
 * path with no error and no failed deploy. The slug is stable everywhere.
 */

/**
 * Tenants running the lean v2 product, by slug.
 *
 * Annotated `readonly string[]` rather than written `as const` ON PURPOSE.
 * `as const` narrows the element type to the literal union `'northwind'`, which
 * narrows `Array.prototype.includes` to accept only that literal — so
 * `LEAN_TENANTS.includes(someString)` stops being a membership test and becomes
 * a compile error rather than a gate.
 */
const LEAN_TENANTS: readonly string[] = ['northwind'];

/**
 * Is this tenant on the lean v2 product?
 *
 * Fails OPEN on every unknown: a null, undefined or unresolved slug is NOT lean,
 * so every gate built on this keeps v1 behaviour until the tenant is known.
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
 */
export function resolveBoldSignMode(
  tenantMode: string | null | undefined,
  tenantSlug: string | null | undefined,
): 'test' | 'live' {
  if (isLeanTenant(tenantSlug)) return 'live';
  return tenantMode === 'live' ? 'live' : 'test';
}
