export type StaffRole = 'head_admin' | 'admin' | 'manager' | 'ops' | 'viewer';
export type EntityKind = 'rental' | 'vehicle' | 'customer';
export type Locale = 'en' | 'ur-Latn';
export interface Staff {
  id: string; tenant_id: string | null; auth_user_id: string;
  role: string; is_active: boolean; is_super_admin: boolean;
}
export interface Tenant {
  id: string; slug: string; status: string;
  enquiries_enabled?: boolean; lead_management_enabled?: boolean;
  automations_enabled?: boolean; vehicle_owners_enabled?: boolean;
}
export interface Permission { tab_key: string; access_level: 'viewer' | 'editor' }
/** Only these bounded reads are reachable from support. No client is a tool. */
export interface SupportReads {
  authenticate(token: string): Promise<{ id: string } | null>;
  staff(authUserId: string): Promise<Staff | null>;
  tenant(id: string): Promise<Tenant | null>;
  permissions(staffId: string): Promise<Permission[]>;
  entity(kind: EntityKind, id: string, tenantId: string): Promise<{ id: string; tenant_id: string } | null>;
}
export interface SupportContext {
  userId: string; staffId: string; tenant: Tenant;
  role: StaffRole; superAdmin: boolean; permissions: Permission[];
  scope: string;
}
export interface PageContext { kind: EntityKind; id: string }
export interface NavigationAction { target: string; label: string; entityId?: string }
export interface SupportSource {
  table: 'application_knowledge'; id: string; title: string;
  knowledgeVersion: string; sourceCommit: string; verifiedAt: string;
}
export class SupportError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupportError('invalid_input', 'Invalid request.');
  return value as Record<string, unknown>;
}
export function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new SupportError('unsupported_request', 'This request is not available in application guidance.');
}
