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
import { FilterChip, FilterSearch, FilterSection, FilterShell } from '@/components/admin/filter-primitives';
import { OverviewFlip } from '@/components/admin/overview-flip';
import Sidebar from '@/components/admin/Sidebar';
import { SidebarProvider } from '@/components/admin/SidebarContext';
import { SidebarSectionsProvider, useRegisterSidebarSections } from '@/components/admin/sidebar-sections';
import { useState } from 'react';

export default function AdminPreviewPage() {
  /* The real sidebar, beside the real surfaces.
     Every page behind the sign-in redirects without a session, so the rail was
     the one piece of this app nobody could look at — which is how a render
     loop in its sections reached production. It renders here against the same
     providers the protected layout gives it. No session, so it shows the
     signed-out navigation; that is enough to judge the surface, the active
     pill, the group behaviour and the sub-rows. */
  return (
    <SidebarProvider>
    <SidebarSectionsProvider>
    <div className="flex min-h-screen bg-app-gradient">
      <div className="hidden w-[280px] shrink-0 md:block">
        <Sidebar />
      </div>
      <div className="min-w-0 flex-1 p-4 sm:p-8">
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

      <SectionsDemo />
      </div>
    </div>
    </SidebarSectionsProvider>
    </SidebarProvider>
  );
}

/** Publishes sections so the rail shows its sub-rows, as a real page does. */
function SectionsDemo() {
  const [tab, setTab] = useState('codes');
  useRegisterSidebarSections(
    '/admin/promo-codes',
    [
      { id: 'codes', label: 'Codes' },
      { id: 'referral-links', label: 'Referral Links' },
      { id: 'claims', label: 'Claims' },
      { id: 'leaderboard', label: 'Leaderboard' },
      { id: 'settings', label: 'Settings' },
    ],
    tab,
    setTab,
  );
  return (
    <section aria-label="Sidebar sections" className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Sidebar sections</h2>
      <div className="rounded-4xl bg-card p-6 shadow-sm ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">
          Promo Codes&rsquo; sections are published to the rail. Current section:{' '}
          <span className="font-medium text-foreground">{tab}</span> — press a row under Promo Codes to change it.
        </p>
      </div>
    </section>
  );
}

/**
 * The filter surface as the list pages draw it: a search field with the toggle
 * INSIDE it, and an overview row whose other face is the panel. Pressing the
 * toggle turns the card over — stat cards on the front, filters on the back —
 * which is the whole point of this preview existing, since every real page is
 * behind a sign-in and cannot be looked at without one.
 */
function FilterDemo() {
  const [status, setStatus] = useState('All');
  const [payment, setPayment] = useState('All');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const active = (status !== 'All' ? 1 : 0) + (payment !== 'All' ? 1 : 0);

  return (
    <div className="space-y-4">
      <FilterSearch
        value={search}
        onChange={setSearch}
        placeholder="Search by name, slug, or email…"
        open={open}
        onOpenChange={setOpen}
        activeCount={active}
      />

      <OverviewFlip
        flipped={open}
        onFlipBack={() => setOpen(false)}
        front={
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard title="Active Rentals" value={312} subtitle="Right now" icon={ClipboardList} />
            <MetricCard title="Due Back Today" value={28} subtitle="Across all tenants" icon={Car} accent="warning" />
            <MetricCard title="Overdue" value={4} subtitle="Needs chasing" icon={HeartPulse} accent="success" />
          </div>
        }
        back={
          <FilterShell
            activeCount={active}
            onClear={() => {
              setStatus('All');
              setPayment('All');
            }}
            onClose={() => setOpen(false)}
          >
            <FilterSection
              icon={<ClipboardList className="size-3 text-primary" />}
              tint="bg-primary/10"
              title="Status"
            >
              <div className="flex flex-wrap gap-1.5">
                {['All', 'Active', 'Upcoming', 'Pending', 'Completed'].map((s) => (
                  <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
                    {s}
                  </FilterChip>
                ))}
              </div>
            </FilterSection>
            <FilterSection
              icon={<Car className="size-3 text-success" />}
              tint="bg-success/10"
              title="Payment"
            >
              <div className="flex flex-wrap gap-1.5">
                {['All', 'Regular', 'Pay-as-you-go'].map((s) => (
                  <FilterChip key={s} active={payment === s} onClick={() => setPayment(s)}>
                    {s}
                  </FilterChip>
                ))}
              </div>
            </FilterSection>
          </FilterShell>
        }
      />
    </div>
  );
}
