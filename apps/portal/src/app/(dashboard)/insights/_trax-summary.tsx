'use client';

import { useSearchParams } from 'next/navigation';

/**
 * Insights — Trax summary.
 *
 * Trax reads the same figures the other three views show and writes the
 * operator a proper review: a verdict, 4–6 headed sections with findings and
 * the right chart beside them, and a list of things to do now.
 *
 * ── Who decides what ────────────────────────────────────────────────────────
 * The NUMBERS are built here, from `InsightsData` — so the tenant's category
 * rules and single-entry corrections are already in them, and the prose can
 * never disagree with the page. The WORDS come from the `trax-insights-summary`
 * edge function. The CHARTS are this page's own, drawn from real data; the
 * model only chooses which one sits beside which section.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * Written on request, never on page load, at most once a week per business —
 * the edge function enforces that and saves every review to
 * `trax_insights_reports`, so the whole team reads the same one. When the
 * figures move after a review was written, the page says so.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TraxWriting } from './_trax-writing';
import { TraxReviewArt } from '@/components/illustrations-v2/scenes/trax-review';
import { Award, CalendarClock, Check, FileDown, RefreshCw, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/format-utils';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui-v2/button';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { cn } from '@/lib/utils';
import { toNumber } from './_money-model';
import { periodRange, vehicleName, type InsightsData, type PeriodMonths } from './_data';
import { MoneyInOut, OwedByAge, ProfitByCar, RevenueMix, RunningProfit } from './_analytics';

/* ────────────────────────────────────────────────────────────────────────────
 * Shape
 * ──────────────────────────────────────────────────────────────────────────── */

type Visual = 'money_in_out' | 'running_profit' | 'profit_by_car' | 'revenue_mix' | 'owed_by_age';

type Summary = {
  headline: string;
  tone: 'strong' | 'steady' | 'watch' | 'concern';
  summary: string;
  sections: {
    heading: string;
    area?: string;
    rating?: 'strong' | 'fair' | 'weak';
    metric?: { label: string; value: string } | null;
    visual: Visual | null;
    paragraphs: string[];
    bullets: string[];
  }[];
  swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  plan?: { days30: string[]; days60: string[]; days90: string[] };
  actions: {
    title: string;
    detail: string;
    impact: 'high' | 'medium' | 'low';
    when: 'today' | 'this week' | 'this month';
    estimate: string | null;
  }[];
  watch: string[];
  /** Trax's pick of the period's most valuable customer — chosen from `topCustomers` in the facts. */
  customer_pick?: { customer: string; why: string } | null;
};

type Stored = { summary: Summary; generatedAt: string; factsKey: string };

/* ────────────────────────────────────────────────────────────────────────────
 * Facts — everything Trax may say a number about
 * ──────────────────────────────────────────────────────────────────────────── */

const round = (n: number) => Math.round(n * 100) / 100;
const DAYS_PER_MONTH = 365.25 / 12;

/* ────────────────────────────────────────────────────────────────────────────
 * Deep facts — the whole operation, as a business analyst would ask for it.
 * Every figure is computed here, exactly; the model only interprets.
 * ──────────────────────────────────────────────────────────────────────────── */

const dayNo = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : round((v[m - 1] + v[m]) / 2);
};

function deepFacts(data: InsightsData, months: PeriodMonths) {
  const { from, to, days } = periodRange(months);
  const today = dayNo(to);
  const start = dayNo(from);
  const counted = data.ledger.filter((r) => !r.excluded);
  const labels = data.vehicleLabels;
  const carName = (id: string | null) => (id ? (labels.get(id) ?? 'Removed car') : 'No car');

  /* Bookings & demand */
  const rentals = data.rentals;
  const byStatus = new Map<string, number>();
  const bySource = new Map<string, number>();
  const startsByWeekday = new Array(7).fill(0);
  const lengths: number[] = [];
  let upcoming = 0;
  for (const r of rentals) {
    byStatus.set(r.status ?? 'Unknown', (byStatus.get(r.status ?? 'Unknown') ?? 0) + 1);
    bySource.set(r.source || 'Not recorded', (bySource.get(r.source || 'Not recorded') ?? 0) + 1);
    if (r.start) {
      startsByWeekday[new Date(`${r.start.slice(0, 10)}T00:00:00Z`).getUTCDay()]++;
      if (dayNo(r.start) > today) upcoming++;
    }
    if (r.start && r.end && r.status !== 'Cancelled' && r.status !== 'Rejected') lengths.push(dayNo(r.end) - dayNo(r.start) + 1);
  }
  const cancelled = (byStatus.get('Cancelled') ?? 0) + (byStatus.get('Rejected') ?? 0);

  /* Customers & retention */
  const rentalsPerCustomer = new Map<string, number>();
  for (const r of rentals) {
    if (!r.customerName || r.status === 'Cancelled' || r.status === 'Rejected') continue;
    rentalsPerCustomer.set(r.customerName, (rentalsPerCustomer.get(r.customerName) ?? 0) + 1);
  }
  const customersRenting = rentalsPerCustomer.size;
  const repeat = [...rentalsPerCustomer.values()].filter((n) => n >= 2).length;
  const top = topCustomersOf(data);
  const ownRevenue = data.totals.operatingRevenue;
  const top3Share = pct(top.slice(0, 3).reduce((s2, c) => s2 + c.money, 0), ownRevenue);

  /* Fleet, car by car */
  const perCar = new Map<string, { revenue: number; cost: number; out: Set<number> }>();
  const car = (id: string) => {
    let t = perCar.get(id);
    if (!t) {
      t = { revenue: 0, cost: 0, out: new Set<number>() };
      perCar.set(id, t);
    }
    return t;
  };
  for (const id of labels.keys()) car(id);
  for (const r of counted) {
    if (!r.vehicle_id) continue;
    if (r.bucket === 'operating_revenue') car(r.vehicle_id).revenue += toNumber(r.amount);
    else if (r.bucket === 'operating_cost') car(r.vehicle_id).cost += toNumber(r.amount);
  }
  for (const r of rentals) {
    if (!r.vehicleId || !(r.status === 'Active' || r.status === 'Closed') || !r.start || !r.end) continue;
    const a = Math.max(start, dayNo(r.start));
    const b = Math.min(today, dayNo(r.end));
    for (let d = a; d <= b; d++) car(r.vehicleId).out.add(d);
  }
  const fleet = [...perCar.entries()]
    .map(([id, t]) => {
      // Longest run of idle days, and days since last out, inside the period.
      let longest = 0;
      let run = 0;
      let lastOut: number | null = null;
      for (let d = start; d <= today; d++) {
        if (t.out.has(d)) {
          run = 0;
          lastOut = d;
        } else longest = Math.max(longest, ++run);
      }
      const out = t.out.size;
      return {
        car: carName(id),
        daysOut: out,
        utilisationPercent: pct(out, days),
        moneyIn: round(t.revenue),
        costs: round(t.cost),
        kept: round(t.revenue - t.cost),
        perRentedDay: out > 0 ? round(t.revenue / out) : null,
        longestIdleStretchDays: longest,
        daysSinceLastOut: lastOut == null ? null : today - lastOut,
        outToday: t.out.has(today),
      };
    })
    .sort((a, b) => b.kept - a.kept);

  /* Pricing over time: own revenue per rented car-day, month by month */
  const monthOut = new Map<string, number>();
  for (const t of perCar.values()) {
    for (const d of t.out) {
      const key = new Date(d * 86_400_000).toISOString().slice(0, 7);
      monthOut.set(key, (monthOut.get(key) ?? 0) + 1);
    }
  }
  const pricing = data.monthly.map((m) => {
    const out = monthOut.get(m.key) ?? 0;
    return { month: m.label, rentedCarDays: out, revenuePerRentedDay: out > 0 ? round(m.revenue / out) : null };
  });

  /* Revenue mix & attach rates */
  const byCategory = new Map<string, { amount: number; rentals: Set<string> }>();
  const rentalIds = new Set<string>();
  for (const r of counted) {
    if (r.bucket !== 'operating_revenue') continue;
    const k = r.category ?? 'Other';
    const t = byCategory.get(k) ?? { amount: 0, rentals: new Set<string>() };
    t.amount += toNumber(r.amount);
    if (r.rental_id) {
      t.rentals.add(r.rental_id);
      rentalIds.add(r.rental_id);
    }
    byCategory.set(k, t);
  }
  const revenueStreams = [...byCategory.entries()]
    .map(([kind, t]) => ({
      kind,
      amount: round(t.amount),
      shareOfRevenue: pct(t.amount, ownRevenue),
      attachRatePercent: pct(t.rentals.size, rentalIds.size),
    }))
    .sort((a, b) => b.amount - a.amount);

  /* Cash & collections */
  const paid = data.paymentsIn.filter((p) => (p.status ?? '').toLowerCase() !== 'failed');
  const byMethod = new Map<string, { count: number; amount: number }>();
  const byPayStatus = new Map<string, number>();
  for (const p of data.paymentsIn) {
    byPayStatus.set(p.status || 'Unknown', (byPayStatus.get(p.status || 'Unknown') ?? 0) + 1);
  }
  for (const p of paid) {
    const k = p.method || 'Not recorded';
    const t = byMethod.get(k) ?? { count: 0, amount: 0 };
    t.count++;
    t.amount += p.amount;
    byMethod.set(k, t);
  }
  const collected = paid.reduce((s2, p) => s2 + p.amount, 0);

  /* Momentum: last 3 months vs the 3 before */
  const m = data.monthly;
  const sum3 = (xs: typeof m, k: 'revenue' | 'profit') => xs.reduce((s2, x) => s2 + x[k], 0);
  const last3 = m.slice(-3);
  const prev3 = m.slice(-6, -3);

  return {
    bookings: {
      total: rentals.length,
      byStatus: Object.fromEntries(byStatus),
      bySource: Object.fromEntries(bySource),
      cancellationRatePercent: pct(cancelled, rentals.length),
      averageLengthDays: lengths.length ? round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null,
      medianLengthDays: median(lengths),
      startsByWeekday: Object.fromEntries(WD.map((d, i) => [d, startsByWeekday[i]])),
      upcomingBookings: upcoming,
    },
    customers: {
      renting: customersRenting,
      repeatCustomers: repeat,
      repeatRatePercent: pct(repeat, customersRenting),
      top3ShareOfRevenuePercent: top3Share,
    },
    fleetDetail: fleet,
    idleCarsAllPeriod: fleet.filter((f) => f.daysOut === 0).map((f) => f.car),
    pricingByMonth: pricing,
    revenueStreams,
    cash: {
      paymentsCount: data.paymentsIn.length,
      collected: round(collected),
      collectedVsTookInPercent: pct(collected, data.receipt.tookIn),
      byMethod: [...byMethod.entries()].map(([method, t]) => ({ method, count: t.count, amount: round(t.amount) })),
      byStatus: Object.fromEntries(byPayStatus),
      averagePayment: paid.length ? round(collected / paid.length) : null,
    },
    momentum: {
      last3Months: { moneyIn: round(sum3(last3, 'revenue')), kept: round(sum3(last3, 'profit')) },
      previous3Months: { moneyIn: round(sum3(prev3, 'revenue')), kept: round(sum3(prev3, 'profit')) },
      bestMonth: m.reduce((b, x) => (x.profit > (b?.profit ?? -Infinity) ? x : b), m[0])?.label ?? null,
      worstMonth: m.reduce((b, x) => (x.profit < (b?.profit ?? Infinity) ? x : b), m[0])?.label ?? null,
    },
    risk: {
      owedOver60Days: round(data.aging.bucket_61_90 + data.aging.bucket_90_plus),
      largestDebtorShareOfOwedPercent: pct(data.receivables[0]?.total ?? 0, data.aging.total),
      refundRatePercentOfTookIn: pct(data.receipt.gaveBack, data.receipt.tookIn),
    },
  };
}

/** Customers by their own revenue in the period, biggest first. */
function topCustomersOf(data: InsightsData) {
  const per = new Map<string, { money: number; rentals: Set<string> }>();
  for (const r of data.ledger) {
    if (r.excluded || r.bucket !== 'operating_revenue' || !r.customer_id) continue;
    const t = per.get(r.customer_id) ?? { money: 0, rentals: new Set<string>() };
    t.money += toNumber(r.amount);
    if (r.rental_id) t.rentals.add(r.rental_id);
    per.set(r.customer_id, t);
  }
  return [...per.entries()]
    .map(([id, t]) => ({ name: data.customerNames.get(id) ?? 'Customer', money: t.money, rentals: t.rentals.size }))
    .sort((a, b) => b.money - a.money);
}

function buildFacts(data: InsightsData, months: PeriodMonths, currency: string, company: string) {
  const { from, to, days } = periodRange(months);
  const counted = data.ledger.filter((r) => !r.excluded);
  const labels = data.vehicleLabels;

  const rentedDays = ((data.utilisation ?? 0) / 100) * data.fleetSize * days;
  const costByKind = new Map<string, number>();
  for (const r of counted) {
    if (r.bucket !== 'operating_cost') continue;
    const k = r.category ?? 'Other';
    costByKind.set(k, (costByKind.get(k) ?? 0) + toNumber(r.amount));
  }
  const biggestCosts = counted
    .filter((r) => r.bucket === 'operating_cost')
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount))
    .slice(0, 5)
    .map((r) => ({ date: r.entry_date, kind: r.category, car: vehicleName(labels, r.vehicle_id), amount: round(toNumber(r.amount)) }));

  const neverYours = counted.filter((r) => r.bucket === 'non_revenue');
  const deposits = neverYours.filter((r) => r.category === 'Security Deposit').reduce((s, r) => s + toNumber(r.amount), 0);
  const tax = neverYours.reduce((s, r) => s + toNumber(r.amount), 0) - deposits;

  const refunds = data.refunds.filter((r) => !r.excluded);
  const reasons = new Map<string, number>();
  for (const r of refunds) {
    const k = r.reason?.replace(/\s+/g, ' ').trim() || 'No reason recorded';
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }

  const deep = deepFacts(data, months);

  return {
    company,
    currency,
    today: to,
    period: { from, to, months, days },
    ...deep,
    receipt: {
      tookIn: round(data.receipt.tookIn),
      gaveBack: round(data.receipt.gaveBack),
      neverYours: round(data.receipt.neverYours),
      spent: round(data.receipt.spent),
      kept: round(data.receipt.kept),
      carPurchasesOutsideProfit: round(data.receipt.carPurchases),
    },
    keptPercentOfTookIn: data.receipt.tookIn > 0 ? round((data.receipt.kept / data.receipt.tookIn) * 100) : null,
    ownRevenue: round(data.totals.operatingRevenue),
    fleet: {
      cars: data.fleetSize,
      utilisationPercent: data.utilisation == null ? null : round(data.utilisation),
      rentedCarDays: Math.round(rentedDays),
      availableCarDays: data.fleetSize * days,
      ownRevenuePerRentedDay: rentedDays > 0 ? round(data.totals.operatingRevenue / rentedDays) : null,
      runningCostPerCarPerMonth:
        data.fleetSize > 0 ? round(data.receipt.spent / data.fleetSize / (days / DAYS_PER_MONTH)) : null,
    },
    months: data.monthly.map((m) => ({ month: m.label, moneyIn: round(m.revenue), spent: round(m.cost), kept: round(m.profit) })),
    cars: data.vehicleProfits.slice(0, 30).map((v) => ({ car: v.label, kept: round(v.profit) })),
    revenueMix: data.mix.map((m) => ({ kind: m.category, amount: round(m.amount), percent: round(m.share) })),
    costsByKind: [...costByKind.entries()].sort((a, b) => b[1] - a[1]).map(([kind, amount]) => ({ kind, amount: round(amount) })),
    biggestCosts,
    taxCollectedToSetAside: round(tax),
    depositsHeld: round(deposits),
    refunds: {
      count: refunds.length,
      total: round(refunds.reduce((s, r) => s + r.amount, 0)),
      reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count })),
    },
    owedAsOfToday: {
      total: round(data.aging.total),
      days0to30: round(data.aging.bucket_0_30),
      days31to60: round(data.aging.bucket_31_60),
      days61to90: round(data.aging.bucket_61_90),
      days90plus: round(data.aging.bucket_90_plus),
      customers: data.receivables.length,
      worstFirst: data.receivables.slice(0, 8).map((r) => ({
        customer: r.customerName ?? 'Unknown customer',
        total: round(r.total),
        over90: round(r.bucket_90_plus),
        days61to90: round(r.bucket_61_90),
      })),
    },
    topCustomers: topCustomersOf(data)
      .slice(0, 8)
      .map((c) => ({ customer: c.name, moneyIn: round(c.money), rentals: c.rentals })),
    operatorCorrections: {
      entriesChangedOrLeftOut: data.adjustedCount,
      categoriesMoved: data.categories.filter((c) => c.rule !== c.defaultRule).length,
    },
  };
}

/** A cheap fingerprint of the facts, so a stale summary can say it is stale. */
function keyOf(facts: unknown): string {
  const s = JSON.stringify(facts);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The view
 * ──────────────────────────────────────────────────────────────────────────── */

export function TraxSummaryView({
  data,
  months,
  currency,
}: {
  data: InsightsData | undefined;
  months: PeriodMonths;
  currency: string;
}) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const company = tenant?.company_name ?? '';

  const facts = useMemo(() => (data ? buildFacts(data, months, currency, company) : null), [data, months, currency, company]);
  const factsKey = useMemo(() => (facts ? keyOf(facts) : ''), [facts]);

  /*
   * The review lives on the server, one per business, shared by the team —
   * and so does the once-a-week limit, which the edge function enforces (see
   * ops/trax_insights_reports.sql). The browser only asks for the latest and
   * hears back when the next one is allowed.
   */
  const queryClient = useQueryClient();
  const latestQuery = useQuery({
    queryKey: ['trax-insights-report', tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: res, error } = await supabase.functions.invoke('trax-insights-summary', {
        body: { action: 'latest', tenantId },
      });
      if (error) throw error;
      return res as {
        latest: (Stored & { months: number; periodFrom: string; periodTo: string }) | null;
        nextAvailableAt: string | null;
      };
    },
  });
  const stored = latestQuery.data?.latest ?? null;
  const nextAvailableAt = latestQuery.data?.nextAvailableAt ?? null;
  const locked = !!nextAvailableAt && new Date(nextAvailableAt).getTime() > Date.now();
  const nextLabel = nextAvailableAt
    ? new Date(nextAvailableAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    : null;

  const write = useMutation({
    mutationFn: async () => {
      if (!facts) throw new Error('Your figures are still loading.');
      const { data: res, error } = await supabase.functions.invoke('trax-insights-summary', {
        body: { facts, tenantId, months, factsKey },
      });
      if (error) {
        // The function's own message is friendlier than the client's wrapper.
        let message = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          const body = ctx ? await ctx.json() : null;
          if (body?.error) message = body.error;
        } catch {
          /* keep the wrapper's message */
        }
        throw new Error(message);
      }
      if (!res?.summary) throw new Error('I came back with nothing to show. Please try again.');
      return res;
    },
    // Whatever happened — written, or refused by the weekly limit — the
    // server now holds the truth; read it back.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['trax-insights-report', tenantId] }),
  });

  const stale = !!stored && !!factsKey && !!stored.factsKey && stored.factsKey !== factsKey;

  /* Hooks stay above the early return below — React needs the same
     hooks, in the same order, on every render. */
  /* ── The checklist: ticks remembered per written summary ── */
  const tickKey = stored ? `d247.insights.trax.done.${stored.generatedAt}` : null;
  const [done, setDone] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      setDone(new Set(tickKey ? (JSON.parse(window.localStorage.getItem(tickKey) ?? '[]') as number[]) : []));
    } catch {
      setDone(new Set());
    }
  }, [tickKey]);
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      try {
        if (tickKey) window.localStorage.setItem(tickKey, JSON.stringify([...next]));
      } catch {
        /* fine */
      }
      return next;
    });

  const [pdfBusy, setPdfBusy] = useState(false);

  /* `?trax=writing` replays the writing show on demand — for reviewing and
     demoing it, since otherwise it is only on screen while a review is being
     written. Read-only: it writes nothing and calls nothing. */
  const replayWriting = useSearchParams()?.get('trax') === 'writing';

  // While Trax writes: the show, not a skeleton.
  if (write.isPending || replayWriting) return <TraxWriting facts={facts} />;

  if (latestQuery.isLoading) {
    return (
      <AutoSkeleton loading outerClassName="xl:h-full" className="xl:h-full">
        <Intro onWrite={() => {}} disabled error={null} />
      </AutoSkeleton>
    );
  }

  if (!stored) {
    return <Intro onWrite={() => write.mutate()} disabled={!facts || locked} error={write.error?.message ?? null} />;
  }

  const summary = stored.summary;

  /* ── Exact figures, never the model's: the score strip and the podiums ── */
  const money = (n: number) => formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const scores = data
    ? [
        { label: 'Kept', value: money(data.receipt.kept) },
        {
          label: 'Margin',
          value: data.receipt.tookIn > 0 ? `${Math.round((data.receipt.kept / data.receipt.tookIn) * 100)}%` : '—',
        },
        { label: 'Cars out', value: data.utilisation == null ? '—' : `${Math.round(data.utilisation)}% of the time` },
        { label: 'Still owed', value: money(data.aging.total) },
      ]
    : [];
  const topCars = (data?.vehicleProfits ?? [])
    .filter((v) => v.profit > 0)
    .slice(0, 3)
    .map((v) => ({ name: v.label.split(' · ')[0], value: money(v.profit), raw: v.profit }));
  const topCustomers = data
    ? topCustomersOf(data)
        .slice(0, 3)
        .map((c) => ({ name: c.name, value: money(c.money), raw: c.money, sub: `${c.rentals} ${c.rentals === 1 ? 'rental' : 'rentals'}` }))
    : [];

  /* ── PDF ── */
  const downloadPdf = async () => {
    if (!stored) return;
    setPdfBusy(true);
    try {
      const { traxSummaryPdf } = await import('./_trax-pdf');
      const { from, to } = periodRange(months);
      const blob = await traxSummaryPdf(stored.summary, {
        company: company || 'Drive247',
        period: `${from} to ${to}`,
        writtenAt: new Date(stored.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        scores,
        topCars,
        topCustomers: topCustomers.map((c) => ({ name: c.name, value: `${c.value} · ${c.sub}` })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(company || 'drive247').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-trax-summary-${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setPdfBusy(false);
    }
  };

  const written = stored
    ? new Date(stored.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const doneCount = summary.actions.filter((_, i) => done.has(i)).length;

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const contents = [
    ...summary.sections.map((sec, i) => ({ id: `trax-s${i}`, label: sec.area || sec.heading, rating: sec.rating })),
    ...(summary.swot ? [{ id: 'trax-swot', label: 'Where you stand', rating: undefined }] : []),
    ...(summary.plan ? [{ id: 'trax-plan', label: '30 / 60 / 90-day plan', rating: undefined }] : []),
    { id: 'trax-actions', label: 'Do this now', rating: undefined },
  ];

  /*
   * A long read, laid out like one: a single calm column (~760px) with the
   * contents pinned down the left on wide screens, generous space between
   * every part, 16–17px body text on a relaxed line height. Nothing sits in
   * a side panel competing for attention — the picks, the actions, the SWOT
   * and the plan all come in turn, in the column, each with room to breathe.
   * The whole view scrolls inside the frame; the page itself never does.
   */
  return (
    <div className="h-full overflow-y-auto">
      {/* Flush with the page: the contents start under the "Insights" title,
          the review takes the rest of the width. Long text keeps a reading
          measure (see READ); charts and lists use the full width. */}
      <div className="grid gap-12 pt-4 pb-8 xl:grid-cols-[220px_minmax(0,1fr)] xl:gap-16 2xl:gap-24">
        {/* ── Contents, pinned ─────────────────────────────────────────── */}
        <nav aria-label="Contents" className="hidden xl:block">
          <div className="sticky top-6 -ml-2 space-y-0.5">
            <p className="mb-3 px-2 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">In this review</p>
            {contents.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => jump(c.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors duration-200 hover:bg-primary/5 hover:text-foreground motion-reduce:transition-none"
              >
                <span className="truncate">{c.label}</span>
                {c.rating ? <RatingDot rating={c.rating} /> : null}
              </button>
            ))}
          </div>
        </nav>

        <article className="min-w-0">
          {/* ── Opening ──────────────────────────────────────────────── */}
          <header>
            {/* The review's two actions: top-left, as quiet text links. */}
            <div className="-ml-3 mb-6 flex items-center gap-1 text-[13px] text-muted-foreground">
              <button
                type="button"
                onClick={downloadPdf}
                disabled={pdfBusy || !stored}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 transition-colors duration-200 hover:bg-primary/5 hover:text-foreground disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none"
              >
                <FileDown className="size-3.5" aria-hidden /> {pdfBusy ? 'Preparing…' : 'Download PDF'}
              </button>
              {/* One review a week: the server enforces it; the link says when. */}
              <button
                type="button"
                onClick={() => write.mutate()}
                disabled={!facts || locked}
                title={locked ? 'One review a week — your next one unlocks then.' : undefined}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 transition-colors duration-200 hover:bg-primary/5 hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground motion-reduce:transition-none"
              >
                <RefreshCw className="size-3.5" aria-hidden /> {locked ? `Next review ${nextLabel}` : 'Regenerate'}
              </button>
            </div>
            <h2 className="max-w-[960px] font-heading text-[34px] leading-[1.15] font-semibold tracking-tight sm:text-[40px]">
              {summary.headline}
            </h2>
            <p className="mt-6 max-w-[860px] text-[18px] leading-[1.75] text-muted-foreground">{summary.summary}</p>
            {stale && !locked ? (
              <button
                type="button"
                onClick={() => write.mutate()}
                className="mt-5 cursor-pointer text-[13px] text-warning underline-offset-4 hover:underline"
              >
                Your numbers have changed since I wrote this — rewrite it
              </button>
            ) : null}
          </header>

          {/* ── The four numbers ─────────────────────────────────────── */}
          {scores.length ? (
            <dl className="mt-14 grid grid-cols-2 gap-y-10 sm:grid-cols-4">
              {scores.map((sc, i) => (
                <div key={sc.label} className={cn('px-1', i > 0 && 'sm:border-l sm:border-foreground/10 sm:pl-6')}>
                  <dt className="text-[13px] text-muted-foreground">{sc.label}</dt>
                  <dd
                    className={cn(
                      'mt-2 font-heading text-[26px] leading-none font-semibold tracking-tight tabular-nums',
                      i === 0 && 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]',
                    )}
                  >
                    {sc.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {write.error ? (
            <p className="mt-10 rounded-3xl bg-destructive/10 px-5 py-4 text-sm text-destructive">{write.error.message}</p>
          ) : null}

          {/* ── Who and what stood out ───────────────────────────────── */}
          {summary.customer_pick || topCars.length || topCustomers.length ? (
            <section className="mt-20">
              <Eyebrow>Who and what stood out</Eyebrow>
              {summary.customer_pick ? (
                <div className="relative mt-6 overflow-hidden rounded-[28px] bg-primary px-8 py-8 text-primary-foreground">
                  <svg aria-hidden className="pointer-events-none absolute -top-14 -right-14 size-56 opacity-[0.12]" viewBox="0 0 200 200">
                    {[34, 58, 82].map((r) => (
                      <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="2" />
                    ))}
                  </svg>
                  <p className="flex items-center gap-2 text-[13px] font-medium opacity-80">
                    <Award className="size-4" aria-hidden /> Customer of the period
                  </p>
                  <p className="mt-3 font-heading text-[28px] font-semibold tracking-tight">{summary.customer_pick.customer}</p>
                  <p className="mt-3 max-w-xl text-[16px] leading-relaxed opacity-90">{summary.customer_pick.why}</p>
                </div>
              ) : null}
              <div className="mt-10 grid gap-12 sm:grid-cols-2">
                <Podium title="Top cars" rows={topCars} />
                <Podium title="Top customers" rows={topCustomers} />
              </div>
            </section>
          ) : null}

          {/* ── The review, area by area ─────────────────────────────── */}
          {summary.sections.map((section, i) => {
            const hasVisual = !!(section.visual && data);
            return (
              <section key={i} id={`trax-s${i}`} className="mt-24 scroll-mt-6">
                <div className="flex items-center gap-3">
                  <span className="font-heading text-[13px] font-semibold text-muted-foreground tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <Eyebrow>{section.area || 'Finding'}</Eyebrow>
                  <RatingText rating={section.rating} />
                </div>
                <h3 className="mt-4 max-w-[960px] font-heading text-[26px] leading-snug font-semibold tracking-tight">{section.heading}</h3>
                {section.metric ? (
                  <p className="mt-4 flex items-baseline gap-3">
                    <span className="font-heading text-[30px] leading-none font-semibold tracking-tight text-primary tabular-nums dark:text-[hsl(var(--v2-link,var(--primary)))]">
                      {section.metric.value}
                    </span>
                    <span className="text-[14px] text-muted-foreground">{section.metric.label}</span>
                  </p>
                ) : null}
                <div className="mt-7 space-y-5">
                  {section.paragraphs.map((p, j) => (
                    <p key={j} className="max-w-[860px] text-[16.5px] leading-[1.8] text-foreground/85">
                      {p}
                    </p>
                  ))}
                </div>
                {section.bullets.length ? (
                  <ul className="mt-8 max-w-[860px] space-y-4 border-l-2 border-primary/20 pl-6">
                    {section.bullets.map((b, j) => (
                      <li key={j} className="text-[15.5px] leading-[1.7] text-foreground/90">
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {hasVisual ? (
                  <div data-skeleton-keep className="mt-10 h-72">
                    <VisualFor visual={section.visual!} data={data!} currency={currency} />
                  </div>
                ) : null}
              </section>
            );
          })}

          {/* ── Where you stand ──────────────────────────────────────── */}
          {summary.swot && Object.values(summary.swot).some((v) => v.length) ? (
            <section id="trax-swot" className="mt-24 scroll-mt-6">
              <Eyebrow>Where you stand</Eyebrow>
              <div className="mt-8 grid gap-x-12 gap-y-12 sm:grid-cols-2">
                {(
                  [
                    ['Strengths', summary.swot.strengths],
                    ['Weaknesses', summary.swot.weaknesses],
                    ['Opportunities', summary.swot.opportunities],
                    ['Threats', summary.swot.threats],
                  ] as const
                ).map(([title, items]) => (
                  <div key={title}>
                    <h4 className="font-heading text-[17px] font-semibold tracking-tight">{title}</h4>
                    <ul className="mt-4 space-y-3">
                      {items.map((t, j) => (
                        <li key={j} className="flex gap-3 text-[15px] leading-[1.7] text-foreground/85">
                          <span aria-hidden className="mt-[11px] size-1.5 shrink-0 rounded-full bg-primary/50" />
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* ── The plan ─────────────────────────────────────────────── */}
          {summary.plan && (summary.plan.days30.length || summary.plan.days60.length || summary.plan.days90.length) ? (
            <section id="trax-plan" className="mt-24 scroll-mt-6">
              <Eyebrow>Your 30 / 60 / 90-day plan</Eyebrow>
              <ol className="mt-8 space-y-12">
                {(
                  [
                    ['Next 30 days', summary.plan.days30],
                    ['By day 60', summary.plan.days60],
                    ['By day 90', summary.plan.days90],
                  ] as const
                ).map(([title, steps], k) => (
                  <li key={title} className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                    <p className="flex items-center gap-2.5 font-heading text-[15px] font-semibold">
                      <span
                        className={cn(
                          'flex size-8 items-center justify-center rounded-full text-[12px] tabular-nums',
                          k === 0 ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]',
                        )}
                      >
                        {(k + 1) * 30}
                      </span>
                      <span className="sm:hidden">{title}</span>
                    </p>
                    <div>
                      <p className="hidden font-heading text-[15px] font-semibold sm:block">{title}</p>
                      <ul className="mt-3 space-y-3">
                        {steps.map((t, j) => (
                          <li key={j} className="flex gap-3 text-[15px] leading-[1.7] text-foreground/85">
                            <span aria-hidden className="mt-[11px] size-1.5 shrink-0 rounded-full bg-primary/50" />
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {/* ── Do this now ──────────────────────────────────────────── */}
          <section id="trax-actions" className="mt-24 scroll-mt-6">
            <div className="flex items-baseline justify-between gap-4">
              <Eyebrow>Do this now</Eyebrow>
              {summary.actions.length ? (
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {doneCount} of {summary.actions.length} done
                </span>
              ) : null}
            </div>
            <ol className="mt-6 divide-y divide-foreground/[0.07]">
              {summary.actions.map((a, i) => {
                const isDone = done.has(i);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      aria-pressed={isDone}
                      className="group flex w-full cursor-pointer items-start gap-5 py-6 text-left"
                    >
                      <span
                        className={cn(
                          'mt-1 flex size-6 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors duration-200 motion-reduce:transition-none',
                          isDone ? 'bg-primary text-primary-foreground ring-primary' : 'ring-foreground/25 group-hover:ring-primary/60',
                        )}
                      >
                        {isDone ? <Check className="size-4" aria-hidden /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[17px] font-medium leading-snug', isDone && 'text-muted-foreground line-through')}>
                          {a.title}
                        </span>
                        {!isDone ? (
                          <>
                            <span className="mt-2 block text-[15px] leading-[1.7] text-muted-foreground">{a.detail}</span>
                            <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                              <ImpactLabel impact={a.impact} />
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <CalendarClock className="size-3.5" aria-hidden /> {a.when}
                              </span>
                              {a.estimate ? <span className="font-medium tabular-nums">{a.estimate}</span> : null}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* ── Keep an eye on ───────────────────────────────────────── */}
          {summary.watch.length ? (
            <section className="mt-20">
              <Eyebrow>Keep an eye on</Eyebrow>
              <ul className="mt-6 space-y-3">
                {summary.watch.map((w, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-[1.7] text-foreground/85">
                    <span aria-hidden className="mt-[11px] size-1.5 shrink-0 rounded-full bg-foreground/30" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ── The end: when, take it away, write the next one ───────── */}
          {/* The very end: who wrote it and when. */}
          <footer className="mt-24 border-t border-foreground/10 pt-8 text-[13px] text-muted-foreground">
            <p className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
              Written by Trax{written ? ` · ${written}` : ''}
              {stored && 'months' in stored && stored.months !== months ? ` · covers the last ${stored.months} months` : ''}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}

/** A small, spaced, uppercase label that opens a part of the review. */
function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{children}</p>;
}

/** The verdict as a small coloured dot, for the contents list. */
function RatingDot({ rating }: { rating: 'strong' | 'fair' | 'weak' }) {
  const cls = rating === 'strong' ? 'bg-success' : rating === 'fair' ? 'bg-warning' : 'bg-destructive';
  return <span className={cn('size-1.5 shrink-0 rounded-full', cls)} aria-label={rating} />;
}

/** An area's verdict, as coloured text (status is text, never a pill). */
function RatingText({ rating }: { rating?: 'strong' | 'fair' | 'weak' }) {
  if (!rating) return null;
  const map = {
    strong: ['Strong', 'text-success'],
    fair: ['Fair', 'text-warning'],
    weak: ['Weak', 'text-destructive'],
  } as const;
  const [label, cls] = map[rating];
  return <span className={cn('shrink-0 text-[11px] font-semibold normal-case tracking-normal', cls)}>{label}</span>;
}

/** A top-three list with a rank medal and a proportional accent bar. */
function Podium({ title, rows }: { title: string; rows: { name: string; value: string; raw: number; sub?: string }[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.raw), 1);
  return (
    <div>
      <h3 className="font-heading text-[17px] font-semibold tracking-tight">{title}</h3>
      <ol className="mt-5 space-y-5">
        {rows.map((r, i) => (
          <li key={r.name} className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                  i === 0 ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]',
                )}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{r.value}</span>
            </div>
            <div className="ml-[34px] flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.raw / max) * 100}%` }} />
              </span>
              {r.sub ? <span className="shrink-0 text-[11px] text-muted-foreground">{r.sub}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pieces
 * ──────────────────────────────────────────────────────────────────────────── */

function Intro({ onWrite, disabled, error }: { onWrite: () => void; disabled: boolean; error: string | null }) {
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center">
      <div className="max-w-xl space-y-5 text-center">
        <TraxReviewArt className="max-w-[360px]" />
        <div className="space-y-2">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Let me read your numbers for you.</h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            I'll go through every figure on this page — what came in, what it cost, which cars carry the
            fleet and who still owes you — and write you a proper review: what's working, what isn't, and
            exactly what to do this week.
          </p>
        </div>
        {error ? <p className="rounded-3xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}
        <Button size="lg" onClick={onWrite} disabled={disabled}>
          <Sparkles data-icon="inline-start" /> Write my summary
        </Button>
      </div>
    </div>
  );
}


function ImpactLabel({ impact }: { impact: Summary['actions'][number]['impact'] }) {
  const map = {
    high: { label: 'High impact', className: 'text-success' },
    medium: { label: 'Medium impact', className: 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]' },
    low: { label: 'Low impact', className: 'text-muted-foreground' },
  } as const;
  const m = map[impact] ?? map.medium;
  return <span className={cn('font-medium', m.className)}>{m.label}</span>;
}

function VisualFor({ visual, data, currency }: { visual: Visual; data: InsightsData; currency: string }): ReactNode {
  const props = { data, currency, className: 'h-full' };
  switch (visual) {
    case 'money_in_out':
      return <MoneyInOut {...props} />;
    case 'running_profit':
      return <RunningProfit {...props} />;
    case 'profit_by_car':
      return <ProfitByCar {...props} />;
    case 'revenue_mix':
      return <RevenueMix {...props} />;
    case 'owed_by_age':
      return <OwedByAge {...props} />;
    default:
      return null;
  }
}
