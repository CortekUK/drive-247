import { SupportError, type Permission, type Staff, type SupportReads, type Tenant } from './types.ts';

// The runtime supplies a server-side Supabase client. Only these fixed reads
// reach the handler; the client itself is never exposed as an assistant tool.
interface ReadQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: string): ReadQuery;
  limit(count: number): ReadQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface SupportDatabase {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from(table: string): { select(columns: string): ReadQuery };
}

export function createSupportReads(db: SupportDatabase): SupportReads {
  const checked = async <T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> => {
    const result = await query;
    if (result.error) throw new SupportError('access_unavailable', 'Access could not be verified.', 503);
    return result.data as T;
  };
  return {
    authenticate: async (token) => {
      const { data, error } = await db.auth.getUser(token);
      if (error) return null;
      return data.user ? { id: data.user.id } : null;
    },
    staff: (id) => checked<Staff | null>(db.from('app_users').select('id,auth_user_id,tenant_id,role,is_active,is_super_admin').eq('auth_user_id', id).maybeSingle()),
    tenant: (id) => checked<Tenant | null>(db.from('tenants').select('id,slug,status,enquiries_enabled,lead_management_enabled,automations_enabled,vehicle_owners_enabled').eq('id', id).maybeSingle()),
    permissions: (id) => checked<Permission[]>(db.from('manager_permissions').select('tab_key,access_level').eq('app_user_id', id).limit(101)),
    entity: (kind, id, tenantId) => checked<{ id: string; tenant_id: string } | null>(db.from({ rental: 'rentals', vehicle: 'vehicles', customer: 'customers' }[kind]).select('id,tenant_id').eq('tenant_id', tenantId).eq('id', id).maybeSingle()),
  };
}
