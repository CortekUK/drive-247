/**
 * integration-billing — who is calling, and for which tenant. PURE: the
 * service-role client is passed in. Mirrors agreements-v2/auth.ts:
 *
 *  1. a Supabase access token is required (`supabase.functions.invoke` sends
 *     it) and verified with `auth.getUser(token)`. The gateway's verify_jwt
 *     also admits the public anon key, which is a JWT but no user, so this is
 *     the check that actually matters;
 *  2. the tenant comes from the caller's own `app_users` row, NEVER the body.
 *     A super admin has no tenant (tenant_id NULL); theirs is the portal they
 *     are on, read from the `Origin` header's `{slug}.portal.` subdomain;
 *  3. the tenant must be the integration-billing tenant (gate.ts);
 *  4. a WRITE (subscribe) needs the same right the Billing page asks for
 *     (`canEditSettings('subscription')` in hooks/use-manager-permissions.ts):
 *     never a viewer, and a manager only with editor on `settings` AND on
 *     `settings.subscription`. A READ (next invoice, invoice lines) is open to
 *     every active staff member — /subscription is open to every role.
 *
 * `authenticateSuperAdmin` is the other door: the admin app's Cancel, where the
 * tenant is named in the body because a super admin may act for any tenant.
 */
import { isIntegrationBillingTenant } from './gate.ts';

export interface DbClient {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  auth: {
    // deno-lint-ignore no-explicit-any
    getUser: (token: string) => Promise<{ data: { user: { id?: string } | null } | null; error: any }>;
  };
}

export interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

export interface BillingCaller {
  appUserId: string;
  role: string;
  isSuperAdmin: boolean;
}

export interface BillingTenant {
  id: string;
  slug: string;
}

export interface OperatorContext {
  caller: BillingCaller;
  tenant: BillingTenant;
}

export type AuthResult<T> = { ok: true; context: T } | { ok: false; outcome: Outcome };

const deny = (status: number, error: string, code?: string): { ok: false; outcome: Outcome } => ({
  ok: false,
  outcome: { status, body: { ok: false, error, ...(code ? { code } : {}) } },
});

const RESERVED_SUBDOMAINS = new Set(['www', 'admin', 'portal', 'api', 'app', 'bonzah']);

/** `{slug}.portal.drive-247.com`, `{slug}.portal.localhost`, `{slug}.localhost` → slug. Same rules as agreements-v2. */
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

// deno-lint-ignore no-explicit-any
async function signedInStaff(headers: Headers, db: DbClient): Promise<{ ok: true; appUser: any } | { ok: false; outcome: Outcome }> {
  const token = bearerToken(headers.get('authorization'));
  if (!token) return deny(401, 'Sign in to continue.');

  let userId: string | null = null;
  try {
    const { data, error } = await db.auth.getUser(token);
    if (!error && data?.user?.id) userId = data.user.id;
  } catch {
    userId = null;
  }
  if (!userId) return deny(401, 'Your session has expired. Sign in again.');

  const { data: appUser, error } = await db
    .from('app_users')
    .select('id, tenant_id, role, is_super_admin, is_active')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) return deny(500, 'Your account could not be checked. Try again.');
  if (!appUser || appUser.is_active === false) return deny(403, 'Your account does not have access to billing.');
  return { ok: true, appUser };
}

/** An operator (or a super admin on that operator's portal) acting on their own tenant's billing. */
export async function authenticateOperator(
  headers: Headers,
  db: DbClient,
  opts: { write: boolean },
): Promise<AuthResult<OperatorContext>> {
  const staff = await signedInStaff(headers, db);
  if (!staff.ok) return staff;
  const appUser = staff.appUser;

  const isSuperAdmin = appUser.is_super_admin === true;
  const role = String(appUser.role ?? '');

  if (!isSuperAdmin && opts.write) {
    if (role === 'viewer') return deny(403, 'Your role can view billing but not change it.');
    if (role === 'manager') {
      const { data: grants, error } = await db
        .from('manager_permissions')
        .select('tab_key, access_level')
        .eq('app_user_id', appUser.id)
        .in('tab_key', ['settings', 'settings.subscription']);
      if (error) return deny(500, 'Your permissions could not be checked. Try again.');
      const editor = (tab: string) =>
        (grants ?? []).some((g: { tab_key: string; access_level: string }) => g.tab_key === tab && g.access_level === 'editor');
      if (!editor('settings') || !editor('settings.subscription')) {
        return deny(403, 'You need edit access to Billing to subscribe.');
      }
    }
  }

  let tenantQuery = db.from('tenants').select('id, slug');
  if (appUser.tenant_id) {
    tenantQuery = tenantQuery.eq('id', appUser.tenant_id);
  } else if (isSuperAdmin) {
    const slug = tenantSlugFromOrigin(headers.get('origin'));
    if (!slug) return deny(403, 'Open this company’s portal to work with its billing.');
    tenantQuery = tenantQuery.eq('slug', slug);
  } else {
    return deny(403, 'Your account is not linked to a company.');
  }
  const { data: tenant, error: tenantError } = await tenantQuery.maybeSingle();
  if (tenantError) return deny(500, 'Your company could not be loaded. Try again.');
  if (!tenant?.id) return deny(403, 'Your account is not linked to a company.');

  if (!isIntegrationBillingTenant(tenant.slug)) {
    return deny(403, 'Premium integrations are not available for this company yet.', 'not_available');
  }

  return {
    ok: true,
    context: {
      caller: { appUserId: String(appUser.id), role, isSuperAdmin },
      tenant: { id: String(tenant.id), slug: String(tenant.slug) },
    },
  };
}

/** A super admin (apps/admin), for actions that name the tenant in the body. */
export async function authenticateSuperAdmin(headers: Headers, db: DbClient): Promise<AuthResult<BillingCaller>> {
  const staff = await signedInStaff(headers, db);
  if (!staff.ok) return staff;
  if (staff.appUser.is_super_admin !== true) return deny(403, 'Only a super admin can do this.');
  return {
    ok: true,
    context: { appUserId: String(staff.appUser.id), role: String(staff.appUser.role ?? ''), isSuperAdmin: true },
  };
}
