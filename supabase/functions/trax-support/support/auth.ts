import { SupportError, UUID, type SupportContext, type SupportReads, type StaffRole } from './types.ts';
import { getTabKeyForRoute, SETTINGS_VALUE_TO_KEY } from './portal-permissions.generated.js';
import { isV2 } from './portal-v2.generated.js';

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The selected tenant is a hint; ordinary staff always use their membership. */
export async function authorize(reads: SupportReads, bearer: string, tenantHint: unknown): Promise<SupportContext> {
  const user = await reads.authenticate(bearer);
  if (!user) throw new SupportError('unauthorized', 'Sign in again to use TRAX.', 401);
  const staff = await reads.staff(user.id);
  const roles = ['head_admin', 'admin', 'manager', 'ops', 'viewer'];
  if (!staff || staff.auth_user_id !== user.id || staff.is_active !== true
      || (!staff.is_super_admin && !roles.includes(staff.role))) {
    throw new SupportError('forbidden', 'Active staff access is required.', 403);
  }
  if (tenantHint != null && (typeof tenantHint !== 'string' || !UUID.test(tenantHint))) {
    throw new SupportError('invalid_input', 'Invalid account context.');
  }
  const tenantId = staff.is_super_admin ? (tenantHint || staff.tenant_id) : staff.tenant_id;
  if (!tenantId || (tenantHint && tenantHint !== tenantId)) throw new SupportError('forbidden', 'Account access could not be verified.', 403);
  const tenant = await reads.tenant(String(tenantId));
  if (!tenant || tenant.id !== tenantId || tenant.status !== 'active' || !tenant.slug) {
    throw new SupportError('forbidden', 'Account access could not be verified.', 403);
  }
  // Scope comes from the authenticated membership and server-loaded tenant.
  // A client slug, V2 flag or super-admin role cannot enroll a V1 tenant.
  // Use the same rollout policy as the portal, including future V2 tenants.
  if (!isV2('chrome',tenant.slug)) {
    throw new SupportError('feature_unavailable','This TRAX experience is available only for tenants enabled for V2.',403);
  }
  const role = (staff.is_super_admin ? 'head_admin' : staff.role) as StaffRole;
  const permissions = role === 'manager' ? await reads.permissions(staff.id) : [];
  if (permissions.length > 100 || permissions.some((p) => !['viewer', 'editor'].includes(p.access_level))) {
    throw new SupportError('permissions_unavailable', 'Permissions could not be verified.', 503);
  }
  const ordered = [...permissions].sort((a, b) => `${a.tab_key}:${a.access_level}`.localeCompare(`${b.tab_key}:${b.access_level}`));
  const scope = await digest(JSON.stringify([user.id, staff.id, tenant, role, staff.is_super_admin, ordered]));
  return { userId: user.id, staffId: staff.id, tenant, role, superAdmin: staff.is_super_admin, permissions: ordered, scope };
}

/** Finance entitlement is unresolved: deny it for every role in Phase 1. */
const withheld = new Set(['payments', 'invoices', 'fines', 'expenses', 'reports', 'pl_dashboard', 'owner_payouts', 'settings.payments', 'settings.accounting', 'settings.subscription']);
export function canView(ctx: SupportContext, key: string): boolean {
  if (withheld.has(key)) return false;
  return ctx.role !== 'manager' || ctx.permissions.some((p) => p.tab_key === key);
}
/** Reviewed how-to text is not financial data. Guidance for withheld finance areas follows the
 * finance staff policy (head admins, admins, managers holding the tab grant; never ops or viewers)
 * and never adds navigation, records or tools: canView stays false for those keys. */
export function canReadGuidance(ctx: SupportContext, key: string): boolean {
  if (!withheld.has(key)) return canView(ctx, key);
  if (ctx.role === 'manager') return ctx.permissions.some((p) => p.tab_key === key);
  return ctx.role === 'head_admin' || ctx.role === 'admin';
}
export function canEdit(ctx: SupportContext, key: string): boolean {
  return canView(ctx, key) && ctx.role !== 'viewer'
    && (ctx.role !== 'manager' || ctx.permissions.some((p) => p.tab_key === key && p.access_level === 'editor'));
}
export function routeAllowed(ctx: SupportContext, href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\r\n]/.test(href)) return false;
  const url = new URL(href, 'https://portal.invalid');
  const key = getTabKeyForRoute(url.pathname);
  // This registry fails closed for routes absent from the verified map.
  if (!key || !canView(ctx, key)) return false;
  const tab = url.searchParams.get('tab');
  if (url.pathname === '/settings' && tab) {
    const settingsKey = (SETTINGS_VALUE_TO_KEY as Record<string, string>)[tab];
    if (!settingsKey || !canView(ctx, settingsKey)) return false;
  }
  return true;
}
