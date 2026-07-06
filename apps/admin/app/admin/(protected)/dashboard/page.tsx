'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { DashboardSkeleton } from '@/components/skeletons/DashboardSkeleton';

interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  totalVehicles: number;
  totalRentals: number;
  totalCustomers: number;
  // Money metrics are kept per-currency so USD/GBP/EUR are never summed into one
  // meaningless scalar. Values are in major units (dollars), not cents.
  mrr: Record<string, number>;             // Drive247's monthly recurring subscription revenue
  lifetimeRevenue: Record<string, number>; // all-time subscription cash actually collected
  bookingVolume: Record<string, number>;   // GMV: gross rental value across production tenants
}

// Rental statuses that should not count toward booking volume.
const NON_GMV_STATUSES = new Set(['cancelled', 'canceled']);

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
  const [metrics, setMetrics] = useState<PlatformMetrics>({
    totalTenants: 0,
    activeTenants: 0,
    totalVehicles: 0,
    totalRentals: 0,
    totalCustomers: 0,
    mrr: {},
    lifetimeRevenue: {},
    bookingVolume: {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      // --- Platform-wide counts (include every tenant, test or production) ---
      const [
        { count: totalTenants },
        { count: activeTenants },
        { count: totalVehicles },
        { count: totalRentals },
        { count: totalCustomers },
      ] = await Promise.all([
        supabase.from('tenants').select('*', { count: 'exact', head: true }),
        supabase.from('tenants').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('vehicles').select('*', { count: 'exact', head: true }),
        supabase.from('rentals').select('*', { count: 'exact', head: true }),
        supabase.from('customers').select('*', { count: 'exact', head: true }),
      ]);

      // --- Tenant classification: money metrics exclude test/demo tenants ---
      const { data: tenantRows, error: tenantErr } = await supabase
        .from('tenants')
        .select('id, tenant_type, currency_code');
      if (tenantErr) console.error('Dashboard: tenants query failed:', tenantErr);

      const productionTenantIds = new Set<string>();
      const tenantCurrency = new Map<string, string>();
      for (const t of tenantRows ?? []) {
        tenantCurrency.set(t.id, (t.currency_code || 'USD').toUpperCase());
        if (t.tenant_type !== 'test') productionTenantIds.add(t.id);
      }

      // --- Booking Volume (GMV): production tenants, non-cancelled rentals ---
      // Uses the same per-rental value formula as the tenant Analytics tab:
      // base rent + fees + insurance − discount, floored at 0.
      const { data: rentalRows, error: rentalErr } = await supabase
        .from('rentals')
        .select('tenant_id, status, monthly_amount, collection_fee, delivery_fee, insurance_premium, discount_applied');
      if (rentalErr) console.error('Dashboard: rentals GMV query failed:', rentalErr);

      const bookingVolume: Record<string, number> = {};
      for (const r of rentalRows ?? []) {
        if (!r.tenant_id || !productionTenantIds.has(r.tenant_id)) continue;
        if (NON_GMV_STATUSES.has((r.status || '').toLowerCase())) continue;
        const value = Math.max(
          0,
          (r.monthly_amount ?? 0) +
            (r.collection_fee ?? 0) +
            (r.delivery_fee ?? 0) +
            (r.insurance_premium ?? 0) -
            (r.discount_applied ?? 0)
        );
        const currency = tenantCurrency.get(r.tenant_id) || 'USD';
        bookingVolume[currency] = (bookingVolume[currency] || 0) + value;
      }

      // --- Platform Revenue: what Drive247 itself earns (subscriptions) ---
      // Lifetime = actual cash collected from PAID invoices (amounts stored in cents).
      const { data: paidInvoices, error: invErr } = await supabase
        .from('tenant_subscription_invoices')
        .select('amount_paid, currency')
        .eq('status', 'paid');
      if (invErr) console.error('Dashboard: subscription invoices query failed:', invErr);

      const lifetimeRevenue: Record<string, number> = {};
      for (const inv of paidInvoices ?? []) {
        const currency = (inv.currency || 'USD').toUpperCase();
        lifetimeRevenue[currency] = (lifetimeRevenue[currency] || 0) + (inv.amount_paid ?? 0) / 100;
      }

      // MRR = active subscriptions of production tenants, normalized to monthly
      // (yearly plans ÷ 12). Amounts stored in cents.
      const { data: activeSubs, error: subErr } = await supabase
        .from('tenant_subscriptions')
        .select('tenant_id, amount, currency, interval, status')
        .eq('status', 'active');
      if (subErr) console.error('Dashboard: subscriptions query failed:', subErr);

      const mrr: Record<string, number> = {};
      for (const s of activeSubs ?? []) {
        if (!s.tenant_id || !productionTenantIds.has(s.tenant_id)) continue;
        if (!s.amount) continue;
        const monthlyCents = s.interval === 'year' ? s.amount / 12 : s.amount;
        const currency = (s.currency || 'USD').toUpperCase();
        mrr[currency] = (mrr[currency] || 0) + monthlyCents / 100;
      }

      setMetrics({
        totalTenants: totalTenants || 0,
        activeTenants: activeTenants || 0,
        totalVehicles: totalVehicles || 0,
        totalRentals: totalRentals || 0,
        totalCustomers: totalCustomers || 0,
        mrr,
        lifetimeRevenue,
        bookingVolume,
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

  const lifetimeLabel = formatMoneyMap(metrics.lifetimeRevenue);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Platform Dashboard</h1>
        <p className="mt-2 text-gray-400">Overview of all rental companies and platform metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard
          title="Total Rental Companies"
          value={metrics.totalTenants}
          subtitle={`${metrics.activeTenants} active`}
          icon="🏢"
          bgColor="bg-blue-900/20 border border-blue-800/50"
          textColor="text-blue-400"
        />

        <MetricCard
          title="Total Vehicles"
          value={metrics.totalVehicles}
          subtitle="Across all companies"
          icon="🚗"
          bgColor="bg-green-900/20 border border-green-800/50"
          textColor="text-green-400"
        />

        <MetricCard
          title="Total Rentals"
          value={metrics.totalRentals}
          subtitle="All-time bookings"
          icon="📋"
          bgColor="bg-purple-900/20 border border-purple-800/50"
          textColor="text-purple-400"
        />

        <MetricCard
          title="Total Customers"
          value={metrics.totalCustomers}
          subtitle="Platform-wide"
          icon="👥"
          bgColor="bg-yellow-900/20 border border-yellow-800/50"
          textColor="text-yellow-400"
        />

        {/* Drive247's OWN revenue — subscription fees. This is the platform's top line. */}
        <MetricCard
          title="Monthly Recurring Revenue"
          value={formatMoneyMap(metrics.mrr)}
          subtitle={`From tenant subscriptions · ${lifetimeLabel} collected all-time`}
          icon="💰"
          bgColor="bg-indigo-900/20 border border-indigo-800/50"
          textColor="text-indigo-400"
        />

        {/* Platform SCALE — gross rental value flowing to tenants, NOT Drive247 income. */}
        <MetricCard
          title="Booking Volume (GMV)"
          value={formatMoneyMap(metrics.bookingVolume)}
          subtitle="Gross rental value · production tenants · not Drive247 revenue"
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
