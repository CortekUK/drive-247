/**
 * agreements-v2 edge function — who is calling, and for which tenant (D19,
 * D20). PURE: the service-role client is passed in.
 *
 * Ported from apps/portal/src/lib/agreements-v2/server/auth.ts (the Next
 * implementation this function replaces):
 *
 *  1. the caller must present a Supabase access token (`Authorization: Bearer
 *     …`, which `supabase.functions.invoke` sends), verified with
 *     `auth.getUser(token)`, or it is a 401. The gateway's verify_jwt also
 *     passes the public anon key, which is a valid JWT but no user, so this
 *     check is what actually stands between the anon key and a send;
 *  2. the caller's `app_users` row (by `auth_user_id`, active) supplies the
 *     tenant. NEVER the body. A super admin has no tenant of their own
 *     (`tenant_id` NULL); theirs is the portal they are on, read from the
 *     `Origin` header's `{slug}.portal.` subdomain (a browser sets Origin on
 *     every cross-origin call to the function and page script cannot change
 *     it). A non-browser client could send any Origin, but only a verified
 *     super admin ever reaches this branch, and a super admin can already act
 *     for every tenant, so the header can pick among what they may reach but
 *     never widen it. Anyone else's tenant comes from their row alone;
 *  3. a WRITE (send, ready) is refused to `viewer` and to `manager`, for whom
 *     the `agreements` tab is view-only (lib/permissions.ts). A READ (sync,
 *     document) is open to every staff role, a manager only with a grant on
 *     the `agreements` tab;
 *  4. the tenant must be on v2 for `agreements`: `isV2` from the portal's
 *     lib/v2.ts, compiled for Deno (trax-support's portal-v2.generated.js,
 *     checked against the source by scripts/trax-knowledge.mjs), with the
 *     row's `portal_experience` read through `_shared/lean-tenants.ts`;
 *  5. the BoldSign mode goes through the SAME lean gate every other edge
 *     function uses (`resolveBoldSignMode`, as `_shared/boldsign-client.ts`'s
 *     `getTenantBoldSignMode` does), so northwind is always LIVE.
 */

import { readTenantOnV2ById, resolveBoldSignMode } from '../_shared/lean-tenants.ts';
import { isV2 } from '../trax-support/support/portal-v2.generated.js';

/** The tenant columns the function needs: the slug for the gates, and the signing mode and brands. */
export const TENANT_COLUMNS = 'id, slug, boldsign_mode, boldsign_test_brand_id, boldsign_live_brand_id';

export interface AgreementsTenantV2 {
  id: string;
  slug: string | null;
  boldsign_mode: string | null;
  boldsign_test_brand_id: string | null;
  boldsign_live_brand_id: string | null;
}

export interface AgreementsCallerV2 {
  appUserId: string;
  role: string;
  isSuperAdmin: boolean;
}

/**
 * The narrowest client shape this function uses, so the real supabase-js
 * client and the tests' recording fake both fit without dragging table
 * generics through here.
 */
export interface DbClient {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params?: Record<string, unknown>) => any;
  auth: {
    // deno-lint-ignore no-explicit-any
    getUser: (token: string) => Promise<{ data: { user: { id?: string } | null } | null; error: any }>;
  };
}

export interface AgreementsContextV2 {
  caller: AgreementsCallerV2;
  tenant: AgreementsTenantV2;
  boldsignMode: 'test' | 'live';
}

/** An answer to send back: the HTTP status and the JSON body. */
export interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

export interface AuthResultV2 {
  ok: boolean;
  context?: AgreementsContextV2;
  outcome?: Outcome;
}

/** Roles that may never send from the Agreements tab. */
const NO_WRITE_ROLES: ReadonlySet<string> = new Set(['viewer', 'manager']);

const deny = (status: number, error: string): AuthResultV2 => ({ ok: false, outcome: { status, body: { ok: false, error } } });

const RESERVED_SUBDOMAINS = new Set(['www', 'admin', 'portal', 'api', 'app', 'bonzah']);

/**
 * The tenant slug in a portal host, by the rules the portal's src/proxy.ts
 * applies (`{slug}.portal.drive-247.com`, `{slug}.portal.localhost`,
 * `{slug}.localhost`). A custom portal domain answers null. Used for super
 * admins only. Same function as the Next implementation's.
 */
export function tenantSlugFromHost(hostHeader: string | null | undefined): string | null {
  const host = (hostHeader ?? '').split(':')[0].toLowerCase();
  const parts = host.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  let slug: string | null = null;
  if (parts[parts.length - 1] === 'localhost') {
    if (parts.length >= 3 && parts[parts.length - 2] === 'portal') slug = parts[0];
    else if (parts.length === 2) slug = parts[0];
  } else if (parts.length >= 4 && parts[1] === 'portal') {
    slug = parts[0];
  }
  if (!slug || slug === 'portal' || RESERVED_SUBDOMAINS.has(slug)) return null;
  return slug;
}

/** The portal tenant slug in an `Origin` header (`https://northwind.portal.drive-247.com`), or null. */
export function tenantSlugFromOrigin(origin: string | null | undefined): string | null {
  if (!origin || origin === 'null') return null;
  try {
    return tenantSlugFromHost(new URL(origin).host);
  } catch {
    return null;
  }
}

const bearerToken = (header: string | null): string | null => {
  const m = (header ?? '').match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
};

/**
 * Authenticate a call. `write` is true for a send (and for `ready`, which asks
 * "may I send?"), false for the status sync and the document view.
 */
export async function authenticateAgreementsV2(
  headers: Headers,
  client: DbClient,
  opts: { write: boolean },
): Promise<AuthResultV2> {
  const token = bearerToken(headers.get('authorization'));
  if (!token) return deny(401, 'Sign in to continue.');

  let userId: string | null = null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (!error && data?.user?.id) userId = data.user.id;
  } catch {
    userId = null;
  }
  if (!userId) return deny(401, 'Your session has expired. Sign in again.');

  const { data: appUser, error: appUserError } = await client
    .from('app_users')
    .select('id, tenant_id, role, is_super_admin, is_active')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (appUserError) return deny(500, 'Your account could not be checked. Try again.');
  if (!appUser || appUser.is_active === false) return deny(403, 'Your account does not have access to agreements.');

  const isSuperAdmin = appUser.is_super_admin === true;
  const role = String(appUser.role ?? '');
  if (!isSuperAdmin && opts.write && NO_WRITE_ROLES.has(role)) {
    return deny(403, 'Your role can view agreements but not send them.');
  }
  if (!isSuperAdmin && !opts.write && role === 'manager') {
    const { data: grant, error: grantError } = await client
      .from('manager_permissions')
      .select('tab_key')
      .eq('app_user_id', appUser.id)
      .eq('tab_key', 'agreements')
      .maybeSingle();
    if (grantError) return deny(500, 'Your permissions could not be checked. Try again.');
    if (!grant) return deny(403, 'You do not have access to agreements.');
  }

  let tenantQuery = client.from('tenants').select(TENANT_COLUMNS);
  if (appUser.tenant_id) {
    tenantQuery = tenantQuery.eq('id', appUser.tenant_id);
  } else if (isSuperAdmin) {
    const slug = tenantSlugFromOrigin(headers.get('origin'));
    if (!slug) return deny(403, 'Open this company’s portal to work with its agreements.');
    tenantQuery = tenantQuery.eq('slug', slug);
  } else {
    return deny(403, 'Your account is not linked to a company.');
  }
  const { data: tenant, error: tenantError } = await tenantQuery.maybeSingle();
  if (tenantError) return deny(500, 'Your company could not be loaded. Try again.');
  if (!tenant?.id) return deny(403, 'Your account is not linked to a company.');

  const onV2 = await readTenantOnV2ById(client, tenant.id);
  if (!isV2('agreements', tenant.slug, onV2)) return deny(403, 'Agreements are not available for this company yet.');

  const boldsignMode = resolveBoldSignMode(tenant.boldsign_mode, tenant.slug, onV2);

  return {
    ok: true,
    context: {
      caller: { appUserId: String(appUser.id), role, isSuperAdmin },
      tenant: tenant as AgreementsTenantV2,
      boldsignMode,
    },
  };
}
