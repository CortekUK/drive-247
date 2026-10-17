'use client';

/**
 * What a super admin can do TO a rental company, in one place: switch it on
 * or off, mark it production or test, delete it. The company page and the
 * Rental Companies list both call these, so the two can never disagree about
 * what "suspend" or "delete" does.
 */

import { supabase } from '@/lib/supabase';

export type TenantStatus = 'active' | 'suspended';
export type TenantType = 'production' | 'test';

/** Active ↔ suspended. Scoped to this one tenant's id. */
export async function setTenantStatus(tenantId: string, status: TenantStatus): Promise<void> {
  const { error } = await supabase.from('tenants').update({ status }).eq('id', tenantId);
  if (error) throw error;
}

/** Production ↔ test. Scoped to this one tenant's id. */
export async function setTenantType(tenantId: string, tenantType: TenantType): Promise<void> {
  const { error } = await supabase.from('tenants').update({ tenant_type: tenantType }).eq('id', tenantId);
  if (error) throw error;
}

/**
 * Deletes the tenant and everything it owns, through `admin-delete-tenant`
 * (which checks the caller is a super admin). Throws with the function's own
 * reason, not supabase-js's generic "non-2xx" message.
 */
export async function deleteTenant(tenantId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('admin-delete-tenant', {
    body: { tenant_id: tenantId },
  });

  // supabase-js collapses ANY non-2xx into a generic FunctionsHttpError and
  // hides the response body — which is exactly where admin-delete-tenant puts
  // the actionable reason (invalid session / not a super admin / the Postgres
  // error, plus per-table deletionResults). Read it back.
  if (error) {
    let detail = error.message;
    const res = (error as any)?.context;
    if (res && typeof res.json === 'function') {
      try {
        const body = await res.clone().json();
        if (body?.error) detail = String(body.error);
        const failed = Object.entries(body?.deletionResults ?? {})
          .filter(([, v]) => typeof v === 'string')
          .map(([table, v]) => `${table}: ${v}`);
        if (failed.length) detail += ` — failed: ${failed.join('; ')}`;
      } catch {
        // body wasn't JSON (e.g. a boot failure) — keep the generic message
      }
    }
    throw new Error(detail);
  }

  if (data?.error) throw new Error(data.error);
}
