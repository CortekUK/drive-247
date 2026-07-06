'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, cn } from '@/lib/utils';
import { DashboardSkeleton } from '@/components/skeletons/DashboardSkeleton';

// Live = real/production tenants; Test = sandbox/demo tenants. The whole
// dashboard is scoped to one of these at a time so counts and money never mix.
type DashboardMode = 'live' | 'test';

interface ModeMetrics {
  companies: number;
  activeCompanies: number;
  vehicles: number;
  rentals: number;
  customers: number;
  // Money is kept per-currency so USD/GBP/EUR are never summed into one
  // meaningless scalar. Values are in major units (dollars), not cents.
  mrr: Record<string, number>;             // Drive247's monthly recurring subscription revenue
  lifetimeRevenue: Record<string, number>; // all-time subscription cash actually collected
  bookingVolume: Record<string, number>;   // GMV: gross rental value across the mode's tenants
}

const EMPTY_MODE_METRICS: ModeMetrics = {
  companies: 0,
  activeCompanies: 0,
  vehicles: 0,
  rentals: 0,
  customers: 0,
  mrr: {},
  lifetimeRevenue: {},
  bookingVolume: {},
};

// Rental statuses that should not count toward booking volume.
const NON_GMV_STATUSES = new Set(['cancelled', 'canceled']);

const MODE_STORAGE_KEY = 'admin_dashboard_mode';

// Generous ceiling so per-mode aggregates stay correct well beyond current
// scale; exact counts use head-count queries (below) which ignore this.
const ROW_FETCH_LIMIT = 10000;

/**
 * Format a per-currency money map for display. Joins multiple currencies with
 * " · " (e.g. "$34,924.87 · £1,200.00"); shows "$0.00" when empty.
 */
function formatMoneyMap(map: Record<string, number>): string {
  const entries = Object.entries(map).filter(([, amount]) => amount > 0);
  if (entries.length === 0) return formatCurrency(0);
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' · ');
}

export default function DashboardPage() {
  const [mode, setMode] = useState<DashboardMode>('live');
  const [metrics, setMetrics] = useState<Record<DashboardMode, ModeMetrics>>({
    live: EMPTY_MODE_METRICS,
    test: EMPTY_MODE_METRICS,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore the last-used mode (defaults to Live). Read in an effect so
    // server and first client render agree ("live") — no hydration mismatch.
    try {
      const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (saved === 'live' || saved === 'test') setMode(saved);
    } catch {
      /* localStorage unavailable — stay on the default */
    }
    loadMetrics();
  }, []);

  const changeMode = (next: DashboardMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures */
    }
  };

  const loadMetrics = async () => {
    try {
      // --- Classify every tenant into live (production) vs test ---
      const { data: tenantRows, error: tenantErr } = await supabase
        .from('tenants')
        .select('id, tenant_type, status, currency_code');
      if (tenantErr) console.error('Dashboard: tenants query failed:', tenantErr);

      const liveIds: string[] = [];
      const testIds: string[] = [];
      const tenantMode = new Map<string, DashboardMode>();
      const tenantCurrency = new Map<string, string>();
      const companyCount: Record<DashboardMode, number> = { live: 0, test: 0 };
      const activeCount: Record<DashboardMode, number> = { live: 0, test: 0 };

      for (const t of tenantRows ?? []) {
        const m: DashboardMode = t.tenant_type === 'test' ? 'test' : 'live';
        tenantMode.set(t.id, m);
        tenantCurrency.set(t.id, (t.currency_code || 'USD').toUpperCase());
        (m === 'test' ? testIds : liveIds).push(t.id);
        companyCount[m] += 1;
        if (t.status === 'active') activeCount[m] += 1;
      }

      // --- Exact counts per mode (head-count queries are limit-proof) ---
      const countFor = async (table: string, ids: string[]): Promise<number> => {
        if (ids.length === 0) return 0;
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .in('tenant_id', ids);
        if (error) console.error(`Dashboard: ${table} count failed:`, error);
        return count ?? 0;
      };

      const [liveVehicles, testVehicles, liveCustomers, testCustomers] = await Promise.all([
        countFor('vehicles', liveIds),
        countFor('vehicles', testIds),
        countFor('customers', liveIds),
        countFor('customers', testIds),
      ]);

      // --- Rentals: fetched once → derive both the count (all statuses) and
      //     the GMV (non-cancelled), per mode, using the tenant Analytics
      //     formula: base rent + fees + insurance − discount, floored at 0. ---
      const { data: rentalRows, error: rentalErr } = await supabase
        .from('rentals')
        .select('tenant_id, status, monthly_amount, collection_fee, delivery_fee, insurance_premium, discount_applied')
        .limit(ROW_FETCH_LIMIT);
      if (rentalErr) console.error('Dashboard: rentals query failed:', rentalErr);

      const rentalCount: Record<DashboardMode, number> = { live: 0, test: 0 };
      const bookingVolume: Record<DashboardMode, Record<string, number>> = { live: {}, test: {} };
      for (const r of rentalRows ?? []) {
        const m = r.tenant_id ? tenantMode.get(r.tenant_id) : undefined;
        if (!m) continue;
        rentalCount[m] += 1;
        if (NON_GMV_STATUSES.has((r.status || '').toLowerCase())) continue;
        const value = Math.max(
          0,
          (r.monthly_amount ?? 0) +
            (r.collection_fee ?? 0) +
            (r.delivery_fee ?? 0) +
            (r.insurance_premium ?? 0) -
            (r.discount_applied ?? 0)
        );
        const currency = tenantCurrency.get(r.tenant_id!) || 'USD';
        bookingVolume[m][currency] = (bookingVolume[m][currency] || 0) + value;
      }

      // --- Platform Revenue: active subscriptions → MRR (normalized to
      //     monthly, amounts in cents), grouped by mode + currency. ---
      const { data: activeSubs, error: subErr } = await supabase
        .from('tenant_subscriptions')
        .select('tenant_id, amount, currency, interval, status')
        .eq('status', 'active')
        .limit(ROW_FETCH_LIMIT);
      if (subErr) console.error('Dashboard: subscriptions query failed:', subErr);

      const mrr: Record<DashboardMode, Record<string, number>> = { live: {}, test: {} };
      for (const s of activeSubs ?? []) {
        const m = s.tenant_id ? tenantMode.get(s.tenant_id) : undefined;
        if (!m || !s.amount) continue;
        const monthlyCents = s.interval === 'year' ? s.amount / 12 : s.amount;
        const currency = (s.currency || 'USD').toUpperCase();
        mrr[m][currency] = (mrr[m][currency] || 0) + monthlyCents / 100;
      }

      // --- Lifetime collected: actual cash from PAID invoices (cents) ---
      const { data: paidInvoices, error: invErr } = await supabase
        .from('tenant_subscription_invoices')
        .select('tenant_id, amount_paid, currency, status')
        .eq('status', 'paid')
        .limit(ROW_FETCH_LIMIT);
      if (invErr) console.error('Dashboard: subscription invoices query failed:', invErr);

      const lifetime: Record<DashboardMode, Record<string, number>> = { live: {}, test: {} };
      for (const inv of paidInvoices ?? []) {
        const m = inv.tenant_id ? tenantMode.get(inv.tenant_id) : undefined;
        if (!m) continue;
        const currency = (inv.currency || 'USD').toUpperCase();
        lifetime[m][currency] = (lifetime[m][currency] || 0) + (inv.amount_paid ?? 0) / 100;
      }

      const build = (m: DashboardMode, vehicles: number, customers: number): ModeMetrics => ({
        companies: companyCount[m],
        activeCompanies: activeCount[m],
        vehicles,
        rentals: rentalCount[m],
        customers,
        mrr: mrr[m],
        lifetimeRevenue: lifetime[m],
        bookingVolume: bookingVolume[m],
      });

      setMetrics({
        live: build('live', liveVehicles, liveCustomers),
        test: build('test', testVehicles, testCustomers),
      });
    } catch (error) {
      console.error('Error loading metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  const m = metrics[mode];
  const isLive = mode === 'live';
  const tenantWord = isLive ? 'production' : 'test';
  const lifetimeLabel = formatMoneyMap(m.lifetimeRevenue);

  return (
    <div className="p-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Platform Dashboard</h1>
          <p className="mt-2 text-gray-400">
            Showing {isLive ? 'live (production)' : 'test / sandbox'} rental companies and platform metrics
          </p>
        </div>
        <ModeToggle mode={mode} onChange={changeMode} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard
          title="Total Rental Companies"
          value={m.companies}
          subtitle={`${m.activeCompanies} active`}
          icon="🏢"
          bgColor="bg-blue-900/20 border border-blue-800/50"
          textColor="text-blue-400"
        />

        <MetricCard
          title="Total Vehicles"
          value={m.vehicles}
          subtitle={`Across all ${tenantWord} companies`}
          icon="🚗"
          bgColor="bg-green-900/20 border border-green-800/50"
          textColor="text-green-400"
        />

        <MetricCard
          title="Total Rentals"
          value={m.rentals}
          subtitle="All-time bookings"
          icon="📋"
          bgColor="bg-purple-900/20 border border-purple-800/50"
          textColor="text-purple-400"
        />

        <MetricCard
          title="Total Customers"
          value={m.customers}
          subtitle={`${tenantWord} tenants`}
          icon="👥"
          bgColor="bg-yellow-900/20 border border-yellow-800/50"
          textColor="text-yellow-400"
        />

        {/* Drive247's OWN revenue — subscription fees. This is the platform's top line. */}
        <MetricCard
          title="Monthly Recurring Revenue"
          value={formatMoneyMap(m.mrr)}
          subtitle={`From tenant subscriptions · ${lifetimeLabel} collected all-time`}
          icon="💰"
          bgColor="bg-indigo-900/20 border border-indigo-800/50"
          textColor="text-indigo-400"
        />

        {/* Platform SCALE — gross rental value flowing to tenants, NOT Drive247 income. */}
        <MetricCard
          title="Booking Volume (GMV)"
          value={formatMoneyMap(m.bookingVolume)}
          subtitle={`Gross rental value · ${tenantWord} tenants · not Drive247 revenue`}
          icon="📊"
          bgColor="bg-cyan-900/20 border border-cyan-800/50"
          textColor="text-cyan-400"
        />

        <MetricCard
          title="Platform Health"
          value="Operational"
          subtitle="All systems running"
          icon="✅"
          bgColor="bg-emerald-900/20 border border-emerald-800/50"
          textColor="text-emerald-400"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-dark-card rounded-lg shadow p-6 border border-dark-border">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Activity</h2>
          <p className="text-sm text-gray-400">Activity feed coming soon...</p>
        </div>

        <div className="bg-dark-card rounded-lg shadow p-6 border border-dark-border">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <QuickActionButton href="/admin/rentals" text="Add New Rental Company" />
            <QuickActionButton href="/admin/contacts" text="View Contact Requests" />
            <QuickActionButton href="/admin/admins" text="Manage Super Admins" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: DashboardMode; onChange: (m: DashboardMode) => void }) {
  const options: { key: DashboardMode; label: string; activeClass: string; dot: string }[] = [
    { key: 'live', label: 'Live', activeClass: 'bg-emerald-500/20 text-emerald-300', dot: 'bg-emerald-400' },
    { key: 'test', label: 'Test', activeClass: 'bg-amber-500/20 text-amber-300', dot: 'bg-amber-400' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Data mode"
      className="inline-flex items-center rounded-lg border border-dark-border bg-dark-card p-1"
    >
      {options.map((opt) => {
        const active = mode === opt.key;
        return (
          <button
            key={opt.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className={cn(
              'flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              active ? opt.activeClass : 'text-gray-400 hover:text-gray-200'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', opt.dot, !active && 'opacity-40')} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  bgColor,
  textColor,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: string;
  bgColor: string;
  textColor: string;
}) {
  return (
    <div className={`${bgColor} rounded-lg p-6 shadow`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-400">{title}</h3>
        <span className="text-2xl">{icon}</span>
      </div>
      <div className={`text-3xl font-bold ${textColor}`}>{value}</div>
      <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
    </div>
  );
}

function QuickActionButton({ href, text }: { href: string; text: string }) {
  return (
    <a
      href={href}
      className="block w-full px-4 py-2 text-sm font-medium text-indigo-400 bg-indigo-900/20 rounded-lg hover:bg-indigo-900/40 border border-indigo-800/50 transition-colors"
    >
      {text} →
    </a>
  );
}
