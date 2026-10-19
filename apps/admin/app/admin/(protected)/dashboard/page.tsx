'use client';

/*
 * Super Admin dashboard — rebuilt in the Northwind operator home's language
 * (Oct 7 2026). The previous page (live/test toggle, seven metric cards) is in
 * git history before 5735bf3c.
 *
 * Emptied to the greeting on Oct 19 2026 (Ghulam), ready for what comes next.
 * The revenue card, MRR card, Needs you / New companies / Latest activity and
 * the platform figures still live in components/admin/dashboard/ if wanted back.
 */

import { useAuthStore } from '@/store/authStore';
import { DASH_PALETTE } from '@/components/admin/dashboard/kit';

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
    </div>
  );
}
