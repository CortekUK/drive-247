/**
 * Loads the facts behind the customer health score and scores them, for
 * every company (Customer Management → Customer Health) or for one (a
 * company's page). One loader for both, so the two can never disagree.
 *
 * The scoring rules themselves are in ./score.ts.
 */

import { supabase } from '@/lib/supabase';
import {
  scoreTenant,
  type HealthResult,
  type InvoiceFacts,
  type SubscriptionFacts,
  type TenantFacts,
} from '@/lib/customer-health/score';

export interface HealthTenantRow extends TenantFacts {
  tenant_type: string | null;
  status: string | null;
}

export interface ScoredTenant {
  tenant: HealthTenantRow;
  health: HealthResult;
}

const DAY_MS = 86_400_000;
const PAGE = 1000;

/** PostgREST caps a response, so read in pages until a short one comes back. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function groupBy<T extends { tenant_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.tenant_id);
    if (list) list.push(r);
    else map.set(r.tenant_id, [r]);
  }
  return map;
}

/**
 * Scores every company, or only `tenantId` when given. Throws on any failed
 * read: a half-loaded score is a wrong score.
 */
export async function loadScoredTenants(tenantId?: string): Promise<ScoredTenant[]> {
  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const db = supabase as any;
  // Narrows a query to the one company when asked for one.
  const scope = (q: any, column = 'tenant_id') => (tenantId ? q.eq(column, tenantId) : q);

  const [tenants, logins, rentals, subs, invoices, bonzah] = await Promise.all([
    fetchAll<HealthTenantRow>((a, b) =>
      scope(
        db
          .from('tenants')
          .select(
            'id, company_name, slug, created_at, tenant_type, status, stripe_onboarding_complete, stripe_account_status, own_stripe_account_id, own_stripe_test_account_id, integration_bonzah',
          ),
        'id',
      )
        .order('created_at', { ascending: true })
        .range(a, b),
    ),
    // Operator logins only — a super admin opening the portal as them is
    // logged as 'super_admin' and must not make a company look active.
    fetchAll<{ tenant_id: string; created_at: string }>((a, b) =>
      scope(
        db
          .from('audit_logs')
          .select('tenant_id, created_at')
          .eq('action', 'login_success')
          .eq('activity_source', 'tenant_user')
          .gte('created_at', since90)
          .not('tenant_id', 'is', null),
      )
        .order('created_at', { ascending: false })
        .range(a, b),
    ),
    fetchAll<{ tenant_id: string }>((a, b) =>
      scope(db.from('rentals').select('tenant_id').gte('created_at', since30)).order('created_at').range(a, b),
    ),
    fetchAll<SubscriptionFacts & { tenant_id: string }>((a, b) =>
      scope(db.from('tenant_subscriptions').select('tenant_id, status, cancel_at, current_period_end, trial_end, created_at'))
        .order('created_at')
        .range(a, b),
    ),
    fetchAll<InvoiceFacts & { tenant_id: string }>((a, b) =>
      scope(db.from('tenant_subscription_invoices').select('tenant_id, status, attempt_count, created_at'))
        .order('created_at')
        .range(a, b),
    ),
    // Pending or approved counts as sent — same rule as the Customer
    // Management "submit your Bonzah form" reminder.
    fetchAll<{ tenant_id: string }>((a, b) =>
      scope(db.from('bonzah_onboarding_submissions').select('tenant_id').in('status', ['pending', 'approved']))
        .order('tenant_id')
        .range(a, b),
    ),
  ]);

  const lastLogin = new Map<string, string>();
  for (const l of logins) {
    const prev = lastLogin.get(l.tenant_id);
    if (!prev || l.created_at > prev) lastLogin.set(l.tenant_id, l.created_at);
  }
  const bookings = new Map<string, number>();
  for (const r of rentals) bookings.set(r.tenant_id, (bookings.get(r.tenant_id) ?? 0) + 1);
  const subsBy = groupBy(subs);
  const invoicesBy = groupBy(invoices);
  const bonzahSent = new Set(bonzah.map((b) => b.tenant_id));

  return tenants.map((tenant) => ({
    tenant,
    health: scoreTenant({
      tenant,
      lastLoginAt: lastLogin.get(tenant.id) ?? null,
      bookingsLast30Days: bookings.get(tenant.id) ?? 0,
      subscriptions: subsBy.get(tenant.id) ?? [],
      invoices: invoicesBy.get(tenant.id) ?? [],
      bonzahFormSent: bonzahSent.has(tenant.id),
      now,
    }),
  }));
}
