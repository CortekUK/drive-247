import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';
import { isV2Experience } from '@/lib/v2';

/**
 * THE one server-side read of the portal's tenant row.
 *
 * Lifted out of `app/layout.tsx`, where it started life serving
 * `generateMetadata` and the <body> brand colour, because a third caller now
 * needs it: the v2 gates. `tenants.portal_experience` decides whether a tenant
 * is on v2, and gates are resolved for every request in the root layout — so
 * the flag has to come out of the same round trip the metadata already makes,
 * not a second query per gate or per component.
 *
 * ── The ordering trap this file exists to remove ─────────────────────────────
 *
 * The previous version took a `withBrand` flag and only selected
 * `primary_color` / `light_primary_color` when the caller had already decided
 * the tenant was on the v2 theme. Once the decision itself lives in the row,
 * that is circular: you cannot know whether to ask for the brand columns until
 * you have read the column that tells you, and reading it twice is the thing we
 * are avoiding. So the column list is now FIXED — three extra columns on a
 * round trip `generateMetadata` already makes for every tenant — and the brand
 * paint stays behind the resolved flag in the layout. A v1 tenant's rendered
 * output is unchanged; only the SELECT is wider.
 *
 * ── Why the retry ───────────────────────────────────────────────────────────
 *
 * `anon` holds COLUMN-level SELECT grants on `public.tenants`, not a table
 * grant, and this read runs with the anon key before any session exists. A
 * column `anon` cannot read does not come back null — Postgres refuses the
 * ENTIRE row. So naming `portal_experience` here before its GRANT is applied in
 * production would cost every tenant their <title>, favicon and OG image, on
 * every page, for as long as the deploy was ahead of the SQL.
 *
 * The ladder below makes that window harmless: try the full list, and on a
 * column-or-permission error retry the list this file used to send. The retry is
 * a strict SUBSET of the first attempt, which is what makes it a safety net
 * rather than a re-run of the query that just failed — the same two-tier shape
 * `TenantContext` already uses on the client, for the same reason and after the
 * same outage.
 *
 * It is stateless on purpose: no module-level "the column is missing" latch.
 * This module is shared across every request the server process handles, so a
 * latch is one tenant's answer leaking into the next tenant's request, and a
 * stale one would keep every tenant on v1 long after the grant landed. One
 * extra round trip, only while the column is genuinely absent, is the cheaper
 * mistake.
 */
export type PortalTenantRow = {
  app_name: string | null;
  company_name: string | null;
  meta_title: string | null;
  meta_description: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  primary_color: string | null;
  light_primary_color: string | null;
  /**
   * 'v1' | 'v2', with a CHECK constraint behind it. Typed as a loose string
   * because this is what came back over the wire: `undefined` when the retry
   * path dropped the column, and anything at all if a future value is ever
   * added. `isV2Experience` is the only thing that reads it, and it fails closed.
   */
  portal_experience?: string | null;
};

/** What `generateMetadata` and the brand paint have always needed. */
const BASE_COLUMNS =
  'app_name, company_name, meta_title, meta_description, favicon_url, og_image_url, primary_color, light_primary_color';

/** The v2 switch. Ships with `GRANT SELECT (portal_experience) … TO anon, authenticated`. */
const EXPERIENCE_COLUMN = 'portal_experience';

/**
 * Postgres error codes that mean "that column is not readable", as opposed to
 * "that row does not exist".
 *
 *  - 42703 undefined_column     — the migration has not been applied
 *  - 42501 insufficient_privilege — applied, but the GRANT was forgotten
 *
 * PGRST116 ("no rows") is deliberately NOT here: an unknown slug is a real
 * answer, and retrying it would double the queries for every 404 host.
 */
const COLUMN_UNREADABLE_CODES = new Set(['42703', '42501']);

function isColumnUnreadable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && COLUMN_UNREADABLE_CODES.has(error.code)) return true;
  // PostgREST does not always forward the SQLSTATE for a schema-cache miss on a
  // brand-new column; it reports the column by name instead.
  return Boolean(error.message?.includes(EXPERIENCE_COLUMN));
}

/**
 * Read the tenant row for `tenantSlug`, or null.
 *
 * React `cache` memoises it for the request, so `generateMetadata`, the layout's
 * brand paint and the gate resolution share a single round trip. `cache` is
 * per-request by construction — it is not a module-level Map — which is the
 * whole reason it is safe here.
 *
 * Null when Supabase is not configured, when the slug matches nothing, or when
 * the query fails for a reason the retry cannot help with. Every caller treats
 * null as "no tenant", and for the gates that means v1.
 */
export const readPortalTenant = cache(
  async (tenantSlug: string): Promise<PortalTenantRow | null> => {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return null;
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const select = (columns: string) =>
      supabase.from('tenants').select(columns).eq('slug', tenantSlug).single();

    const first = await select(`${BASE_COLUMNS}, ${EXPERIENCE_COLUMN}`);
    if (!first.error) {
      // A select built from a runtime string is untyped to supabase-js.
      return (first.data as unknown as PortalTenantRow | null) ?? null;
    }

    if (!isColumnUnreadable(first.error)) return null;

    // Rung 2: the column list this file sent before `portal_experience`
    // existed. The tenant keeps its title, favicon and brand; the gates
    // resolve to v1 because `portal_experience` comes back undefined.
    console.debug(
      '[portal-tenant] `portal_experience` is not readable; retrying without ' +
        'it and resolving every gate to v1. Expected until the column and its ' +
        'GRANT are applied. Cause:',
      first.error.message
    );
    const second = await select(BASE_COLUMNS);
    if (second.error) return null;
    return (second.data as unknown as PortalTenantRow | null) ?? null;
  }
);

/**
 * Is this tenant on the v2 portal experience, per its row?
 *
 * Fails closed to false — i.e. v1 — on every one of:
 *  - a null / empty slug (no query is made: we do not know who this is)
 *  - a slug that matches no row
 *  - Supabase not configured
 *  - a failed query, including one the retry above could not rescue
 *  - the column present but NULL, '', 'V2' or any value this build has not
 *    heard of
 *  - the column not selected at all because the GRANT is missing
 *
 * Never throws. A gate lookup must not be able to take a page down, and the
 * answer on the way down has to be the screen the tenant already had.
 */
export const readPortalOnV2 = cache(
  async (tenantSlug: string | null | undefined): Promise<boolean> => {
    if (!tenantSlug) return false;
    try {
      const tenant = await readPortalTenant(tenantSlug);
      return isV2Experience(tenant?.portal_experience);
    } catch (error) {
      console.error('[portal-tenant] portal_experience lookup failed; staying on v1:', error);
      return false;
    }
  }
);

/**
 * The narrowest thing this needs from a Supabase client, so a route handler can
 * pass the service-role client it already built without dragging generated
 * table generics through here.
 *
 * `from` returns `any` DELIBERATELY. Spelling the builder chain out structurally
 * made TypeScript compare it against the generated `Database` types and answer
 * TS2589 ("type instantiation is excessively deep") at the call site in
 * `app/api/esign/route.ts` — a real new error in a file that had none. This is
 * the same reason `supabaseUntyped` exists.
 */
type TenantByIdReader = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Is the tenant with this id on v2, asked BY ID and in a query of its own?
 *
 * For the `app/api/esign/**` route handlers. They resolve BoldSign's test/live
 * mode from the tenant row, and a lean tenant is always live — so they need the
 * same flag the portal's screens do, or a self-serve tenant gets a portal that
 * says "Live" and agreements actually issued against the BoldSign SANDBOX,
 * which watermarks them and deletes them after 14 days.
 *
 * DELIBERATELY A SECOND QUERY rather than one more column on the select those
 * routes already make. Those selects name `boldsign_mode`, and if
 * `portal_experience` is not yet readable — the migration not applied, or
 * applied without its GRANT — adding it there makes Postgres refuse the WHOLE
 * row. `boldsign_mode` would come back undefined, every tenant currently on
 * `live` would silently fall back to `test`, and their signed documents would
 * 404 against the wrong API key. A separate query cannot do that: it fails on
 * its own, answers false, and the existing select is untouched.
 *
 * Not `cache()`d: a route handler resolves one tenant per request, and these
 * routes are called from webhooks and signing redirects where the request scope
 * React `cache` relies on is not something to depend on.
 *
 * Fails closed to false — v1 — on a missing id, a missing row, an unreadable
 * column, an unknown value, or any thrown error.
 */
export async function readTenantOnV2ById(
  client: TenantByIdReader,
  tenantId: string | null | undefined
): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const { data, error } = (await client
      .from('tenants')
      .select(EXPERIENCE_COLUMN)
      .eq('id', tenantId)
      .maybeSingle()) as {
      data: { portal_experience?: string | null } | null;
      error: { message?: string } | null;
    };
    if (error) return false;
    return isV2Experience(data?.portal_experience);
  } catch {
    return false;
  }
}
