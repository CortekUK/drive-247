/**
 * Loads the facts behind the customer health score and scores them, for
 * every company (Customer Management → Customer Health) or for one (a
 * company's page), and one company's weekly trend. One loader for all, so
 * they can never disagree.
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

interface Facts {
  tenants: HealthTenantRow[];
  logins: { tenant_id: string; created_at: string }[];
  rentals: { tenant_id: string; created_at: string }[];
  subs: (SubscriptionFacts & { tenant_id: string })[];
  invoices: (InvoiceFacts & { tenant_id: string })[];
  bonzah: { tenant_id: string }[];
}

/** The raw facts, logins and bookings from the given dates on. */
async function fetchFacts(tenantId: string | undefined, loginsSince: Date, rentalsSince: Date): Promise<Facts> {
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
          .gte('created_at', loginsSince.toISOString())
          .not('tenant_id', 'is', null),
      )
        .order('created_at', { ascending: false })
        .range(a, b),
    ),
    fetchAll<{ tenant_id: string; created_at: string }>((a, b) =>
      scope(db.from('rentals').select('tenant_id, created_at').gte('created_at', rentalsSince.toISOString())).order('created_at').range(a, b),
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
  return { tenants, logins, rentals, subs, invoices, bonzah };
}

/** Scores the facts as they stood at `now`: anything later is ignored. */
function scoreAt(f: Facts, now: Date): ScoredTenant[] {
  const at = now.toISOString();
  const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  const lastLogin = new Map<string, string>();
  for (const l of f.logins) {
    if (l.created_at > at || l.created_at < since90) continue;
    const prev = lastLogin.get(l.tenant_id);
    if (!prev || l.created_at > prev) lastLogin.set(l.tenant_id, l.created_at);
  }
  const bookings = new Map<string, number>();
  for (const r of f.rentals) {
    if (r.created_at > at || r.created_at < since30) continue;
    bookings.set(r.tenant_id, (bookings.get(r.tenant_id) ?? 0) + 1);
  }
  const subsBy = groupBy(f.subs.filter((x) => x.created_at <= at));
  const invoicesBy = groupBy(f.invoices.filter((x) => x.created_at <= at));
  const bonzahSent = new Set(f.bonzah.map((b) => b.tenant_id));

  return f.tenants.map((tenant) => ({
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

/**
 * Scores every company, or only `tenantId` when given. Throws on any failed
 * read: a half-loaded score is a wrong score.
 */
export async function loadScoredTenants(tenantId?: string): Promise<ScoredTenant[]> {
  const now = new Date();
  const facts = await fetchFacts(tenantId, new Date(now.getTime() - 90 * DAY_MS), new Date(now.getTime() - 30 * DAY_MS));
  return scoreAt(facts, now);
}

/**
 * One company's score each week for the last `weeks` weeks, oldest first,
 * ending today — from one read of the facts.
 *
 * Logins and bookings are counted as they stood each week. Subscriptions
 * and invoices are only those that existed by then, but in their CURRENT
 * status: the tables keep no status history, so a past week's payment part
 * is an approximation.
 */
export async function loadHealthTrend(tenantId: string, weeks = 8): Promise<{ date: string; score: number }[]> {
  const now = new Date();
  const first = new Date(now.getTime() - weeks * 7 * DAY_MS);
  const facts = await fetchFacts(tenantId, new Date(first.getTime() - 90 * DAY_MS), new Date(first.getTime() - 30 * DAY_MS));
  const points: { date: string; score: number }[] = [];
  for (let i = weeks; i >= 0; i--) {
    const at = new Date(now.getTime() - i * 7 * DAY_MS);
    const row = scoreAt(facts, at)[0];
    if (row) points.push({ date: at.toISOString(), score: row.health.score });
  }
  return points;
}
