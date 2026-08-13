/**
 * Finance Sync — tenant resolution for the accounting edge functions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * Every accounting function used to resolve the tenant as, literally:
 *
 *     const tenantId = appUser.tenant_id;
 *     if (!tenantId) return errorResponse("No tenant context", 403);
 *
 * Super admins carry `tenant_id = NULL` by design (see CLAUDE.md — it is what
 * lets them bypass tenant RLS). So that line made the ENTIRE Finance Sync
 * feature unusable for them. xero-oauth-start was worse than the others: its
 * guard read
 *
 *     if (!tenantId && !appUser.is_super_admin) return 403;
 *
 * which deliberately let a super admin through with a null tenant, and then
 * inserted that null straight into accounting_oauth_state.tenant_id — a NOT
 * NULL column. Production result: 23502, a 500, and the portal toast
 * "Edge Function returned a non-2xx status code" with nothing actionable in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The security rule, which is the whole point of centralising this
 *
 * A user WITH a tenant_id is pinned to it, unconditionally. Their request may
 * carry a tenant slug and we still ignore it. Trusting a client-supplied tenant
 * for a scoped user would let any tenant admin connect Xero against another
 * operator's books, push invoices into them, or read their chart of accounts.
 *
 * ONLY a super admin may name a tenant, because only they legitimately act
 * across tenants. Even then the slug is resolved against an ACTIVE tenants row
 * rather than trusted as an id.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export interface AppUserLike {
  tenant_id: string | null;
  is_super_admin?: boolean | null;
}

/**
 * Deliberately a single flat shape rather than a discriminated union
 * (`{ok:true,...} | {ok:false,...}`). The edge functions are typechecked under
 * Deno's own config, where that union did not narrow on `if (!res.ok)` and
 * every call site failed with "Property 'status' does not exist". A flat record
 * where every field always exists needs no narrowing and behaves the same under
 * any compiler setting.
 *
 * `tenantId === null` is the single source of truth for "this failed".
 */
export interface TenantResolution {
  tenantId: string | null;
  errorMessage: string | null;
  errorStatus: number;
}

function fail(errorMessage: string, errorStatus: number): TenantResolution {
  return { tenantId: null, errorMessage, errorStatus };
}

/**
 * Resolve which tenant this request acts on.
 *
 * @param supabase  service-role client (needs to read tenants regardless of RLS)
 * @param req       the incoming request — read for the x-tenant-slug header
 * @param appUser   the app_users row for the caller
 * @param bodySlug  optional tenant slug supplied in the request body
 */
export async function resolveTenantId(
  supabase: SupabaseClient,
  req: Request,
  appUser: AppUserLike,
  bodySlug?: string | null,
): Promise<TenantResolution> {
  // Scoped user: pinned to their own tenant. Never negotiable.
  if (appUser.tenant_id) {
    return { tenantId: appUser.tenant_id, errorMessage: null, errorStatus: 200 };
  }

  if (!appUser.is_super_admin) {
    return fail("No tenant context", 403);
  }

  // Super admin: they must say which tenant portal they are acting in. The
  // portal sends the slug explicitly; x-tenant-slug is the fallback for
  // callers that already set it (the header is allow-listed in cors.ts).
  const slug = (bodySlug ?? req.headers.get("x-tenant-slug") ?? "").trim();
  if (!slug) {
    return fail(
      "You are signed in as a super admin, which is not scoped to a tenant. " +
      "Reload the tenant's portal so the request carries its slug, or use a " +
      "tenant admin account.",
      400,
    );
  }

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, status")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return fail(`Failed to resolve tenant "${slug}": ${error.message}`, 500);
  }
  if (!tenant) {
    return fail(`No tenant found for slug "${slug}"`, 404);
  }
  if (tenant.status !== "active") {
    return fail(`Tenant "${slug}" is not active`, 403);
  }

  return { tenantId: tenant.id as string, errorMessage: null, errorStatus: 200 };
}
