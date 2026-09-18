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
 * True when the slug is in `LEAN_TENANTS` (the canary list) OR `onV2` says the
 * tenant's row carries `portal_experience = 'v2'`.
 *
 * Fails OPEN on every unknown: a null, undefined or unresolved slug is NOT lean,
 * so every gate built on this keeps v1 behaviour until the tenant is known —
 * and that holds even with `onV2` set, because `onV2` can only be true for a
 * tenant whose row we just read. One rule: no resolved tenant, nothing lean.
 *
 * `onV2` defaults to false, so a caller that has not been given the row answers
 * exactly what it answered before the column existed.
 */
export function isLeanTenant(
  tenantSlug: string | null | undefined,
  onV2: boolean = false,
): boolean {
  if (!tenantSlug) return false;
  if (onV2) return true;
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
 * `onV2` carries `tenants.portal_experience = 'v2'`. It MUST be passed wherever
 * this decides a live/test key, or a column-flagged tenant signs live from the
 * portal and in the sandbox from here — the half-gated state described above.
 */
export function resolveBoldSignMode(
  tenantMode: string | null | undefined,
  tenantSlug: string | null | undefined,
  onV2: boolean = false,
): 'test' | 'live' {
  if (isLeanTenant(tenantSlug, onV2)) return 'live';
  return tenantMode === 'live' ? 'live' : 'test';
}

/** The v2 switch on `public.tenants`. */
const V2_EXPERIENCE = 'v2';

/**
 * The narrowest thing this needs from a Supabase client, so a caller can pass
 * the client it already built without dragging table generics through here.
 */
type TenantByIdReader = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Is the tenant with this id on v2, per `tenants.portal_experience`?
 *
 * DELIBERATELY A SECOND QUERY rather than one more column on the select the
 * caller already makes for `boldsign_mode`. Postgres refuses the WHOLE row when
 * a named column is missing or ungranted (42703 / 42501), so widening those
 * selects would make `boldsign_mode` come back undefined for EVERY tenant while
 * the deploy is ahead of the SQL — every tenant currently on `live` would fall
 * back to `test` and their signed documents would 404 against the wrong key.
 * A separate query cannot do that: it fails on its own and answers false.
 *
 * Fails closed to false — v1 — on a missing id, a missing row, an unreadable
 * column, an unknown value, or any thrown error. Never throws.
 */
export async function readTenantOnV2ById(
  client: TenantByIdReader,
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const { data, error } = (await client
      .from('tenants')
      .select('portal_experience')
      .eq('id', tenantId)
      .maybeSingle()) as {
      data: { portal_experience?: string | null } | null;
      error: { message?: string } | null;
    };
    if (error) return false;
    return data?.portal_experience === V2_EXPERIENCE;
  } catch {
    return false;
  }
}
