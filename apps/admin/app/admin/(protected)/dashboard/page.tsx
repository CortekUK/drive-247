'use client';

/*
 * Super Admin dashboard — rebuilt in the Northwind operator home's language
 * (Oct 7 2026). The previous page (live/test toggle, seven metric cards) is in
 * git history before 5735bf3c.
 *
 *   greeting
 *   revenue running total ........................ MRR card (320px)
 *   Needs you  ·  New companies  ·  Latest activity
 *   the platform in four figures
 *
 * Live companies only: test tenants and the Northwind canary are left out of
 * every figure (lib/dashboard/use-admin-dashboard.ts).
 */

import { useAuthStore } from '@/store/authStore';
import { DASH_PALETTE, Eyebrow } from '@/components/admin/dashboard/kit';
import { RevenueCard } from '@/components/admin/dashboard/revenue-card';
import {
  ActivityCard,
  NeedsYouCard,
  NewCompaniesCard,
  PlatformFigures,
  SubscriptionsCard,
} from '@/components/admin/dashboard/cards';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const first = user?.name?.trim().split(/\s+/)[0];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="pv mx-auto flex max-w-[1240px] flex-col gap-8 pb-8 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      <style>{DASH_PALETTE}</style>

      <header>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-[var(--pv-ink)]">
          {greeting()}
          {first ? `, ${first}` : ''}
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--pv-ink-3)]">{today}</p>
      </header>

      <section aria-label="Revenue" className="flex flex-col items-stretch gap-5 lg:flex-row">
        <RevenueCard className="flex-1" />
        <SubscriptionsCard className="shrink-0 lg:w-[320px]" />
      </section>

      <section aria-label="Operations" className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
        <NeedsYouCard />
        <NewCompaniesCard />
        <ActivityCard />
      </section>

      <section aria-label="The platform" className="space-y-3">
        <Eyebrow>The platform</Eyebrow>
        <PlatformFigures />
      </section>
    </div>
  );
}
