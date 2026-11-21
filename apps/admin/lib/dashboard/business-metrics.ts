'use client';

/**
 * The business figures on the Super Admin home: MRR and its history, clients,
 * churn, earnings. One fetch of the raw billing rows, then a pure function
 * (`computeBusiness`) turns them into every number on the page, for ALL live
 * clients or for a chosen few. Changing the scope never refetches.
 *
 * WHEN A SUBSCRIPTION COUNTS TOWARDS MRR. From its first real paid invoice
 * (over $1, so the $1 card-check charge on signup does not start the clock)
 * until it ended:
 *   canceled            → ended_at
 *   past_due / unpaid   → current_period_start (the period it has not paid for)
 *   trialing            → current_period_start (in a trial now, so not paying now)
 *   active              → still counting (falls back to created_at if no paid
 *                         invoice is on file)
 * `trial_end` is not used: Stripe rewrites it when a trial is extended, so it
 * does not say when paying began.
 *
 * Same tenant rules as use-admin-dashboard.ts: live companies only (not
 * tenant_type 'test', not the Northwind canary). USD only.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLiveTenants } from './use-admin-dashboard';

const DAY = 86_400_000;

export interface Span {
  tenantId: string;
  monthly: number;
  start: number;
  /** Epoch ms; Infinity while still paying. */
  end: number;
}

export interface RawBusiness {
  spans: Span[];
  /** Paid invoices, net of refunds, in dollars. */
  payments: { tenantId: string; net: number; at: number }[];
  trialing: { tenantId: string; monthly: number }[];
  pastDue: { tenantId: string; monthly: number }[];
  /** Tenants that ever held a subscription — the ones worth offering in the picker. */
  everSubscribed: Set<string>;
}

export function useBusinessRaw() {
  const tenants = useLiveTenants();
  return useQuery({
    queryKey: ['admin-dashboard', 'business-raw'],
    enabled: !!tenants.data,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<RawBusiness> => {
      const live = tenants.data!.byId;
      const [subsRes, invRes] = await Promise.all([
        supabase
          .from('tenant_subscriptions')
          .select('id, tenant_id, status, amount, interval, currency, created_at, current_period_start, ended_at, canceled_at')
          .limit(10_000),
        supabase
          .from('tenant_subscription_invoices')
          .select('subscription_id, tenant_id, amount_paid, amount_refunded, currency, paid_at, created_at')
          .eq('status', 'paid')
          .limit(20_000),
      ]);
      if (subsRes.error) throw subsRes.error;
      if (invRes.error) throw invRes.error;

      type Inv = {
        subscription_id: string | null;
        tenant_id: string | null;
        amount_paid: number | null;
        amount_refunded: number | null;
        currency: string | null;
        paid_at: string | null;
        created_at: string;
      };
      const invoices = ((invRes.data ?? []) as Inv[]).filter(
        (i) => i.tenant_id && live.has(i.tenant_id) && (i.currency || 'usd').toLowerCase() === 'usd',
      );

      // First real payment per subscription.
      const firstPaid = new Map<string, number>();
      const payments: RawBusiness['payments'] = [];
      for (const i of invoices) {
        const at = Date.parse(i.paid_at || i.created_at);
        if (!Number.isFinite(at)) continue;
        const net = Math.max(0, (i.amount_paid ?? 0) - (i.amount_refunded ?? 0)) / 100;
        if (net > 0) payments.push({ tenantId: i.tenant_id!, net, at });
        if (i.subscription_id && (i.amount_paid ?? 0) > 100) {
          const was = firstPaid.get(i.subscription_id);
          if (was === undefined || at < was) firstPaid.set(i.subscription_id, at);
        }
      }

      type Sub = {
        id: string;
        tenant_id: string | null;
        status: string;
        amount: number | null;
        interval: string | null;
        currency: string | null;
        created_at: string;
        current_period_start: string | null;
        ended_at: string | null;
        canceled_at: string | null;
      };
      const spans: Span[] = [];
      const trialing: RawBusiness['trialing'] = [];
      const pastDue: RawBusiness['pastDue'] = [];
      const everSubscribed = new Set<string>();
      for (const s of (subsRes.data ?? []) as Sub[]) {
        if (!s.tenant_id || !live.has(s.tenant_id)) continue;
        if ((s.currency || 'usd').toLowerCase() !== 'usd') continue;
        if (s.status === 'incomplete' || s.status === 'incomplete_expired') continue;
        everSubscribed.add(s.tenant_id);
        const monthly = (s.amount ?? 0) / 100 / (s.interval === 'year' ? 12 : 1);
        if (s.status === 'trialing') trialing.push({ tenantId: s.tenant_id, monthly });
        if (s.status === 'past_due' || s.status === 'unpaid') pastDue.push({ tenantId: s.tenant_id, monthly });

        let start = firstPaid.get(s.id);
        if (start === undefined && s.status === 'active') start = Date.parse(s.created_at);
        if (start === undefined || monthly <= 0) continue;

        let end = Infinity;
        if (s.status === 'canceled') end = Date.parse(s.ended_at || s.canceled_at || s.created_at);
        else if (s.status !== 'active') end = Date.parse(s.current_period_start || s.created_at);
        if (!(end > start)) continue;
        spans.push({ tenantId: s.tenant_id, monthly, start, end });
      }
      return { spans, payments, trialing, pastDue, everSubscribed };
    },
  });
}

/* ─────────────────────────────── the maths ─────────────────────────────── */

export type MrrRange = '3m' | '6m' | '12m' | 'all';

export interface MrrPoint {
  date: string;
  mrr: number;
  clients: number;
}

export interface Business {
  mrr: number;
  arr: number;
  payingClients: number;
  allTimeClients: number;
  arpa: number;
  totalEarned: number;
  earned30: number;
  trialing: number;
  trialMrr: number;
  pastDue: number;
  atRiskMrr: number;
  /** Logo churn over the last 30 days, 0–1; null when nobody was paying 30 days ago. */
  churn30: number | null;
  churned30: number;
  churnedMrr30: number;
  newMrr30: number;
  newClients30: number;
  netNew30: number;
  /** Plan changes among clients paying both then and now. */
  changesMrr30: number;
  series: MrrPoint[];
  start: { date: string; mrr: number; clients: number };
  growth: number | null;
}

/** MRR per tenant at an instant. */
function perTenant(spans: Span[], t: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of spans) if (s.start <= t && t < s.end) m.set(s.tenantId, (m.get(s.tenantId) ?? 0) + s.monthly);
  return m;
}
const sum = (m: Map<string, number>) => {
  let n = 0;
  m.forEach((v) => (n += v));
  return n;
};

function rangeStart(range: MrrRange, earliest: number, now: number): number {
  if (range === 'all') return earliest;
  const months = range === '3m' ? 3 : range === '6m' ? 6 : 12;
  const d = new Date(now);
  return Math.max(earliest, new Date(d.getFullYear(), d.getMonth() - months, d.getDate()).getTime());
}

/** Every figure, for the tenants in `scope` (null = every live client). */
export function computeBusiness(raw: RawBusiness, scope: Set<string> | null, range: MrrRange): Business {
  const inScope = (id: string) => !scope || scope.has(id);
  const spans = raw.spans.filter((s) => inScope(s.tenantId));
  const payments = raw.payments.filter((p) => inScope(p.tenantId));
  const trialing = raw.trialing.filter((p) => inScope(p.tenantId));
  const pastDue = raw.pastDue.filter((p) => inScope(p.tenantId));

  const now = Date.now();
  const t30 = now - 30 * DAY;
  const nowMap = perTenant(spans, now);
  const thenMap = perTenant(spans, t30);
  const mrr = sum(nowMap);

  let churned30 = 0;
  let churnedMrr30 = 0;
  let changesMrr30 = 0;
  thenMap.forEach((v, id) => {
    const n = nowMap.get(id);
    if (n === undefined) {
      churned30++;
      churnedMrr30 += v;
    } else changesMrr30 += n - v;
  });
  let newMrr30 = 0;
  let newClients30 = 0;
  nowMap.forEach((v, id) => {
    if (!thenMap.has(id)) {
      newClients30++;
      newMrr30 += v;
    }
  });

  // The line: one point a week from the range's start, ending on today.
  const earliest = spans.reduce((a, s) => Math.min(a, s.start), now);
  const from = rangeStart(range, earliest, now);
  const step = range === '3m' ? 3 * DAY : 7 * DAY;
  const times: number[] = [];
  for (let t = from; t < now - DAY; t += step) times.push(t);
  times.push(now);
  const series = times.map((t) => {
    const m = perTenant(spans, t);
    return { date: new Date(t).toISOString(), mrr: Math.round(sum(m)), clients: m.size };
  });
  const first = series[0];
  const growth = first && first.mrr > 0 ? (mrr - first.mrr) / first.mrr : null;

  return {
    mrr,
    arr: mrr * 12,
    payingClients: nowMap.size,
    allTimeClients: new Set(spans.map((s) => s.tenantId)).size,
    arpa: nowMap.size ? mrr / nowMap.size : 0,
    totalEarned: payments.reduce((a, p) => a + p.net, 0),
    earned30: payments.filter((p) => p.at >= t30).reduce((a, p) => a + p.net, 0),
    trialing: trialing.length,
    trialMrr: trialing.reduce((a, p) => a + p.monthly, 0),
    pastDue: pastDue.length,
    atRiskMrr: pastDue.reduce((a, p) => a + p.monthly, 0),
    churn30: thenMap.size ? churned30 / thenMap.size : null,
    churned30,
    churnedMrr30,
    newMrr30,
    newClients30,
    netNew30: mrr - sum(thenMap),
    changesMrr30,
    series,
    start: first ?? { date: new Date(now).toISOString(), mrr: 0, clients: 0 },
    growth,
  };
}
