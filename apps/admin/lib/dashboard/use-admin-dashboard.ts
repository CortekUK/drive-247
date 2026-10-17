'use client';

/**
 * Every read behind the Super Admin dashboard, in one place.
 *
 * WHICH TENANTS COUNT. The dashboard is the platform's real business, so it
 * reads LIVE companies only: `tenant_type` is not 'test' (NULL counts as live,
 * as the old dashboard did) and the slug is not the Northwind canary. Test
 * companies and Northwind's synthetic billing never reach a figure here.
 *
 * TENANT SCOPE. This app looks across every tenant on purpose; nothing here is
 * per-tenant. Reads only — the dashboard writes nothing.
 *
 * Every query is a `useQuery` on the layout's client, so the cards share one
 * tenant list and refetch together on focus.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const CANARY = 'northwind';
const STALE = 60_000;

export interface DashTenant {
  id: string;
  slug: string | null;
  name: string;
  status: string | null;
  createdAt: string;
}

/** Live tenants, and a lookup by id. Shared by every card. */
export function useLiveTenants() {
  return useQuery({
    queryKey: ['admin-dashboard', 'tenants'],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, slug, company_name, tenant_type, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        slug: string | null;
        company_name: string | null;
        tenant_type: string | null;
        status: string | null;
        created_at: string;
      }>;
      const list: DashTenant[] = rows
        .filter((t) => t.tenant_type !== 'test' && t.slug !== CANARY)
        .map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.company_name || t.slug || 'Unnamed company',
          status: t.status,
          createdAt: t.created_at,
        }));
      return { list, byId: new Map(list.map((t) => [t.id, t])) };
    },
  });
}

/* ───────────────────────────── revenue series ───────────────────────────── */

export type RevenueRange = '30d' | '90d' | '12m';
export type Bucket = 'day' | 'week' | 'month';

export interface RevenuePoint {
  /** ISO date of the bucket's start. */
  date: string;
  /** Running total collected up to and including this bucket. */
  total: number;
  /** The same running total for the period before, at the same position. */
  previous?: number;
  /** What came in during this bucket alone. */
  came: number;
}

export interface RevenueSeries {
  points: RevenuePoint[];
  bucket: Bucket;
  total: number;
  previousTotal: number;
  payments: number;
}

const DAY = 86_400_000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Bucket starts for the range ending today, oldest first, plus the span length. */
function buckets(range: RevenueRange): { starts: Date[]; bucket: Bucket } {
  const today = startOfDay(new Date());
  if (range === '12m') {
    const starts = Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1));
    return { starts, bucket: 'month' };
  }
  if (range === '90d') {
    const starts = Array.from({ length: 13 }, (_, i) => new Date(today.getTime() - (12 - i) * 7 * DAY));
    return { starts, bucket: 'week' };
  }
  const starts = Array.from({ length: 30 }, (_, i) => new Date(today.getTime() - (29 - i) * DAY));
  return { starts, bucket: 'day' };
}

/** The same bucket shifted back by one whole range. */
function shiftBack(d: Date, range: RevenueRange): Date {
  if (range === '12m') return new Date(d.getFullYear() - 1, d.getMonth(), 1);
  return new Date(d.getTime() - (range === '90d' ? 13 * 7 : 30) * DAY);
}

function bucketIndex(at: number, starts: Date[], end: number): number {
  if (at < starts[0].getTime() || at >= end) return -1;
  for (let i = starts.length - 1; i >= 0; i--) if (at >= starts[i].getTime()) return i;
  return -1;
}

/**
 * Drive247's own revenue: PAID platform-subscription invoices, net of refunds,
 * from live companies. Not booking money — that belongs to the operators.
 * All invoices to date are USD; a non-USD invoice is left out rather than
 * summed into dollars.
 */
export function useRevenueSeries(range: RevenueRange) {
  const tenants = useLiveTenants();
  return useQuery({
    queryKey: ['admin-dashboard', 'revenue', range],
    enabled: !!tenants.data,
    staleTime: STALE,
    queryFn: async (): Promise<RevenueSeries> => {
      const live = tenants.data!.byId;
      const { starts, bucket } = buckets(range);
      const prevStarts = starts.map((s) => shiftBack(s, range));
      const now = Date.now() + DAY;
      const from = prevStarts[0].toISOString();

      const { data, error } = await supabase
        .from('tenant_subscription_invoices')
        .select('tenant_id, amount_paid, amount_refunded, currency, paid_at, created_at')
        .eq('status', 'paid')
        .gte('created_at', new Date(prevStarts[0].getTime() - 31 * DAY).toISOString())
        .limit(10_000);
      if (error) throw error;

      const cur = new Array<number>(starts.length).fill(0);
      const prev = new Array<number>(starts.length).fill(0);
      let payments = 0;
      for (const r of (data ?? []) as Array<{
        tenant_id: string | null;
        amount_paid: number | null;
        amount_refunded: number | null;
        currency: string | null;
        paid_at: string | null;
        created_at: string;
      }>) {
        if (!r.tenant_id || !live.has(r.tenant_id)) continue;
        if ((r.currency || 'usd').toLowerCase() !== 'usd') continue;
        const at = Date.parse(r.paid_at || r.created_at);
        if (!Number.isFinite(at) || at < Date.parse(from)) continue;
        const net = Math.max(0, (r.amount_paid ?? 0) - (r.amount_refunded ?? 0)) / 100;
        const i = bucketIndex(at, starts, now);
        if (i >= 0) {
          cur[i] += net;
          payments++;
          continue;
        }
        const j = bucketIndex(at, prevStarts, starts[0].getTime());
        if (j >= 0) prev[j] += net;
      }

      let run = 0;
      let runPrev = 0;
      const points = starts.map((s, i) => {
        run += cur[i];
        runPrev += prev[i];
        return { date: s.toISOString(), total: run, previous: runPrev, came: cur[i] };
      });
      return { points, bucket, total: run, previousTotal: runPrev, payments };
    },
  });
}

/* ─────────────────────────────── subscriptions ─────────────────────────── */

export interface SubRow {
  tenantId: string;
  status: string;
  planName: string | null;
  monthly: number;
  periodEnd: string | null;
  trialEnd: string | null;
}

/** Every live company's subscriptions, normalised to a monthly amount. */
export function useSubscriptions() {
  const tenants = useLiveTenants();
  return useQuery({
    queryKey: ['admin-dashboard', 'subscriptions'],
    enabled: !!tenants.data,
    staleTime: STALE,
    queryFn: async () => {
      const live = tenants.data!.byId;
      const { data, error } = await supabase
        .from('tenant_subscriptions')
        .select('tenant_id, status, plan_name, amount, interval, currency, current_period_end, trial_end')
        .in('status', ['active', 'trialing', 'past_due', 'unpaid'])
        .limit(5_000);
      if (error) throw error;
      const rows: SubRow[] = (
        (data ?? []) as Array<{
          tenant_id: string | null;
          status: string;
          plan_name: string | null;
          amount: number | null;
          interval: string | null;
          currency: string | null;
          current_period_end: string | null;
          trial_end: string | null;
        }>
      )
        .filter((s) => s.tenant_id && live.has(s.tenant_id))
        .map((s) => ({
          tenantId: s.tenant_id!,
          status: s.status,
          planName: s.plan_name,
          monthly: ((s.amount ?? 0) / 100) / (s.interval === 'year' ? 12 : 1),
          periodEnd: s.current_period_end,
          trialEnd: s.trial_end,
        }));
      const active = rows.filter((r) => r.status === 'active');
      return {
        rows,
        mrr: active.reduce((a, r) => a + r.monthly, 0),
        active: active.length,
        trialing: rows.filter((r) => r.status === 'trialing').length,
        pastDue: rows.filter((r) => r.status === 'past_due' || r.status === 'unpaid'),
      };
    },
  });
}

/* ──────────────────────────────── needs you ─────────────────────────────── */

export interface GoLiveRow {
  id: string;
  tenantId: string;
  kind: string;
  createdAt: string;
}

export interface OpenInvoiceRow {
  tenantId: string;
  amount: number;
  dueDate: string | null;
  attempts: number;
}

/** Pending go-live requests and unpaid platform invoices. */
export function useNeedsYou() {
  const tenants = useLiveTenants();
  return useQuery({
    queryKey: ['admin-dashboard', 'needs-you'],
    enabled: !!tenants.data,
    staleTime: 30_000,
    queryFn: async () => {
      const live = tenants.data!.byId;
      const [golive, invoices] = await Promise.all([
        supabase
          .from('go_live_requests')
          .select('id, tenant_id, integration_type, created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(200),
        supabase
          .from('tenant_subscription_invoices')
          .select('tenant_id, amount_due, due_date, attempt_count, created_at')
          .eq('status', 'open')
          .order('created_at', { ascending: true })
          .limit(200),
      ]);
      if (golive.error) throw golive.error;
      if (invoices.error) throw invoices.error;
      const requests: GoLiveRow[] = (
        (golive.data ?? []) as Array<{ id: string; tenant_id: string | null; integration_type: string | null; created_at: string }>
      )
        .filter((r) => r.tenant_id && live.has(r.tenant_id))
        .map((r) => ({ id: r.id, tenantId: r.tenant_id!, kind: r.integration_type ?? '', createdAt: r.created_at }));
      const open: OpenInvoiceRow[] = (
        (invoices.data ?? []) as Array<{
          tenant_id: string | null;
          amount_due: number | null;
          due_date: string | null;
          attempt_count: number | null;
          created_at: string;
        }>
      )
        .filter((r) => r.tenant_id && live.has(r.tenant_id))
        .map((r) => ({
          tenantId: r.tenant_id!,
          amount: (r.amount_due ?? 0) / 100,
          dueDate: r.due_date ?? r.created_at,
          attempts: r.attempt_count ?? 0,
        }));
      return { requests, open };
    },
  });
}

/* ──────────────────────────────── activity ─────────────────────────────── */

export interface ActivityRow {
  id: string;
  tenantId: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

/**
 * The latest lifecycle events across live companies. Renewal reminders are
 * left out (noise), and so is anything dated in the future — a scheduled
 * cancellation can carry a 2027 date.
 */
export function useActivity(limit = 40) {
  const tenants = useLiveTenants();
  return useQuery({
    queryKey: ['admin-dashboard', 'activity', limit],
    enabled: !!tenants.data,
    staleTime: 30_000,
    queryFn: async (): Promise<ActivityRow[]> => {
      const live = tenants.data!.byId;
      const { data, error } = await supabase
        .from('tenant_lifecycle_events')
        .select('id, tenant_id, event_type, occurred_at, payload')
        .neq('event_type', 'billing.charge_upcoming')
        .lte('occurred_at', new Date().toISOString())
        .order('occurred_at', { ascending: false })
        .limit(limit * 2);
      if (error) throw error;
      return (
        (data ?? []) as Array<{ id: string; tenant_id: string | null; event_type: string; occurred_at: string; payload: unknown }>
      )
        .filter((e) => e.tenant_id && live.has(e.tenant_id))
        .slice(0, limit)
        .map((e) => ({
          id: e.id,
          tenantId: e.tenant_id!,
          type: e.event_type,
          at: e.occurred_at,
          payload: e.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : {},
        }));
    },
  });
}

/* ──────────────────────────────── the platform ─────────────────────────── */

/**
 * Head counts across live companies (`count: exact, head: true` — no rows
 * come back, so no row limit can truncate them).
 */
export function usePlatformCounts() {
  const tenants = useLiveTenants();
  return useQuery({
    queryKey: ['admin-dashboard', 'counts'],
    enabled: !!tenants.data,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ids = tenants.data!.list.map((t) => t.id);
      const count = async (table: 'vehicles' | 'customers' | 'rentals', since?: string) => {
        if (ids.length === 0) return 0;
        let q = supabase.from(table).select('id', { count: 'exact', head: true }).in('tenant_id', ids);
        if (since) q = q.gte('created_at', since);
        const { count: n, error } = await q;
        if (error) throw error;
        return n ?? 0;
      };
      const monthAgo = new Date(Date.now() - 30 * DAY).toISOString();
      const [vehicles, customers, rentals, rentals30] = await Promise.all([
        count('vehicles'),
        count('customers'),
        count('rentals'),
        count('rentals', monthAgo),
      ]);
      return { companies: ids.length, vehicles, customers, rentals, rentals30 };
    },
  });
}
