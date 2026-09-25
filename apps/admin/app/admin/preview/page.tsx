'use client';

/**
 * The Super Admin design surfaces, on their own.
 *
 * Every screen in this app sits behind `(protected)`, which redirects to the
 * sign-in without a session — so there is no way to look at a card, a panel or
 * a control without an account. That made the design the one thing about this
 * app nobody could review. This route renders the same components the real
 * screens use, against fixed numbers, outside the protected group.
 *
 * NOTHING HERE IS REAL and nothing here can be. There is no Supabase client,
 * no auth, no fetch and no writable control on this page; every value below is
 * a literal in this file. It is the same convention as the operator portal's
 * `/playground/*` routes.
 *
 * Narrow the window under 768px to check the same surfaces on a phone.
 */

import {
  Building2,
  Car,
  CircleDollarSign,
  ClipboardList,
  HeartPulse,
  TrendingUp,
  Users,
} from 'lucide-react';
import { MetricCard } from '@/components/admin/metric-card';
import { FilterGroup, FilterPanel, FilterPill } from '@/components/admin/filter-panel';
import { useState } from 'react';

export default function AdminPreviewPage() {
  return (
    <div className="min-h-screen bg-app-gradient p-4 sm:p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Design preview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The Super Admin surfaces in the v2 language. Fixed numbers, no live data.
        </p>
      </header>

      <section aria-label="Metric cards">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Metric cards</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <MetricCard title="Total Rental Companies" value={57} subtitle="41 active" icon={Building2} />
          <MetricCard title="Total Vehicles" value={1284} subtitle="Across all rental companies" icon={Car} accent="info" />
          <MetricCard title="Total Rentals" value={9317} subtitle="All-time bookings" icon={ClipboardList} />
          <MetricCard title="Total Customers" value={6042} subtitle="Rental tenants" icon={Users} accent="info" />
          <MetricCard
            title="Monthly Recurring Revenue"
            value="$48,900"
            subtitle="From tenant subscriptions · $612,400 collected all-time"
            icon={TrendingUp}
            accent="success"
          />
          <MetricCard
            title="Booking Volume (GMV)"
            value="$2,410,880"
            subtitle="Gross rental value · rental tenants · not Drive247 revenue"
            icon={CircleDollarSign}
            accent="warning"
          />
          <MetricCard title="Platform Health" value="Operational" subtitle="All systems running" icon={HeartPulse} accent="success" />
        </div>
      </section>

      <section aria-label="Filters" className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Filters</h2>
        <FilterDemo />
      </section>

      <section aria-label="Panels" className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Panels and controls</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-4xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">
            <h3 className="mb-4 text-lg font-semibold text-foreground">Recent Activity</h3>
            <p className="text-sm text-muted-foreground">Activity feed coming soon…</p>
          </div>

          <div className="rounded-4xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">
            <h3 className="mb-4 text-lg font-semibold text-foreground">Quick Actions</h3>
            <div className="space-y-2">
              {['Add New Rental Company', 'View Contact Requests', 'Manage Super Admins'].map((text) => (
                <span
                  key={text}
                  className="block w-full rounded-2xl bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary ring-1 ring-primary/20"
                >
                  {text}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** The filter panel, driven by local state so the pills actually move. */
function FilterDemo() {
  const [status, setStatus] = useState('All');
  const [payment, setPayment] = useState('All');

  const active = (status !== 'All' ? 1 : 0) + (payment !== 'All' ? 1 : 0);

  return (
    <FilterPanel count={active}>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <FilterGroup label="Status">
          {['All', 'Active', 'Upcoming', 'Pending', 'Completed'].map((s) => (
            <FilterPill key={s} active={status === s} onClick={() => setStatus(s)}>
              {s}
            </FilterPill>
          ))}
        </FilterGroup>
        <FilterGroup label="Payment">
          {['All', 'Regular', 'Pay-as-you-go'].map((s) => (
            <FilterPill key={s} active={payment === s} onClick={() => setPayment(s)}>
              {s}
            </FilterPill>
          ))}
        </FilterGroup>
      </div>
    </FilterPanel>
  );
}
