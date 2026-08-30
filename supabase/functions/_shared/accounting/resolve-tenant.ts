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
 * Subdomains that are dedicated deployments, never tenant slugs (CLAUDE.md
 * "Reserved Subdomains"). `portal` is in here on purpose: the bare
 * portal.drive-247.com is not a tenant.
 */
const RESERVED_SUBDOMAINS = new Set(["www", "admin", "portal", "api", "app"]);

/**
 * Domains a tenant slug may be read from. Without this, a host we do not own —
 * `test.portal.drive-247.com.evil.net` — parses as the tenant "test", because
 * the shape check alone only looks at the leading labels.
 *
 * Only super admins ever reach this code, so this is not a privilege boundary;
 * it is there so a stray Referer or a copy-pasted link cannot quietly point a
 * cross-tenant operator at the wrong operator's books.
 *
 * Override with TENANT_HOST_SUFFIXES (comma-separated) if the platform ever
 * serves portals from another apex.
 */
const ALLOWED_HOST_SUFFIXES = (Deno.env.get("TENANT_HOST_SUFFIXES") ?? "drive-247.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Pull a tenant slug out of a portal/booking URL.
 *
 *   https://test.portal.drive-247.com/settings   → "test"
 *   https://test.drive-247.com/booking           → "test"
 *   http://test.portal.localhost:3001/settings   → "test"
 *   https://portal.drive-247.com/...             → null  (reserved)
 *   https://drive-247.com/...                    → null  (no subdomain)
 *
 * Returns null rather than guessing whenever the host does not clearly carry a
 * slug — a wrong tenant here would mean writing one operator's rentals into
 * another operator's accounting system, so ambiguity must fail closed.
 *
 * This is only ever consulted for super admins. A scoped user never reaches it,
 * so a spoofed Origin cannot widen anyone's access: the caller must already
 * hold cross-tenant rights for this value to be read at all.
 */
export function tenantSlugFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }

  // Strip a trailing "localhost" so dev hosts reduce to the same shape as prod:
  // test.portal.localhost → test.portal
  const parts = host.split(".").filter(Boolean);
  const isLocalhost = parts.length > 0 && parts[parts.length - 1] === "localhost";

  // The host must be one we actually serve portals from. Checked before any
  // label parsing, so a lookalike domain never gets as far as the shape rules.
  if (!isLocalhost) {
    const onKnownHost = ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
    if (!onKnownHost) return null;
  }

  if (isLocalhost) parts.pop();
  if (parts.length === 0) return null;   // bare "localhost"

  const first = parts[0];
  if (RESERVED_SUBDOMAINS.has(first)) return null;

  // Only two published shapes carry a tenant slug:
  //   {slug}.portal.<apex>.<tld>   → the operator portal
  //   {slug}.<apex>.<tld>          → the booking site
  //
  // The length check is what stops an apex domain being read as a slug:
  // "drive-247.com" splits to ["drive-247","com"], and taking parts[0] there
  // would resolve the tenant "drive-247". That is wrong today (no such tenant,
  // so it 404s) but would silently point at the wrong operator's books the day
  // someone registers that slug. Ambiguity fails closed.
  const isPortal = parts[1] === "portal";
  if (isPortal) {
    if (parts.length < 2) return null;
  } else if (isLocalhost) {
    if (parts.length < 1) return null;          // {slug}.localhost — dev only
  } else if (parts.length !== 3) {
    return null;                                 // not {slug}.<apex>.<tld>
  }

  return /^[a-z0-9][a-z0-9-]*$/.test(first) ? first : null;
}

/**
 * Resolve which tenant this request acts on.
 *
 * @param supabase  service-role client (needs to read tenants regardless of RLS)
 * @param req       the incoming request — read for the x-tenant-slug header
 * @param appUser   the app_users row for the caller
 * @param bodySlug          optional tenant slug supplied in the request body
 * @param bodyRedirectBack  optional portal URL from the body — used as a last
 *                          resort so a portal build predating tenantSlug still works
 */
export async function resolveTenantId(
  supabase: SupabaseClient,
  req: Request,
  appUser: AppUserLike,
  bodySlug?: string | null,
  bodyRedirectBack?: string | null,
): Promise<TenantResolution> {
  // Scoped user: pinned to their own tenant. Never negotiable.
  if (appUser.tenant_id) {
    return { tenantId: appUser.tenant_id, errorMessage: null, errorStatus: 200 };
  }

  if (!appUser.is_super_admin) {
    return fail("No tenant context", 403);
  }

  // Super admin: work out which tenant portal they are acting in.
  //
  // Four sources, most explicit first. The last two matter because they work
  // with a portal build that predates the tenantSlug change — the operator
  // should not have to ship a frontend deploy before the backend fix takes
  // effect, and a stale cached bundle should not silently break the flow either.
  //
  //   1. tenantSlug in the body      — what the current portal sends
  //   2. x-tenant-slug header        — already allow-listed in cors.ts
  //   3. Origin / Referer            — the browser sets these on every call;
  //                                    the portal is always {slug}.portal.<domain>
  //   4. redirectBack in the body    — the older portal already sent this
  const slug = (
    bodySlug
    ?? req.headers.get("x-tenant-slug")
    ?? tenantSlugFromUrl(req.headers.get("origin"))
    ?? tenantSlugFromUrl(req.headers.get("referer"))
    ?? tenantSlugFromUrl(bodyRedirectBack)
    ?? ""
  ).trim();

  if (!slug) {
    return fail(
      "You are signed in as a super admin, which is not scoped to a tenant, and " +
      "this request did not identify one. Open the tenant's own portal " +
      "(<slug>.portal.…) and retry, or sign in as an admin of that tenant.",
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
