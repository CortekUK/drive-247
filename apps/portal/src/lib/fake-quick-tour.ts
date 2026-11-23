'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/contexts/TenantContext';

/**
 * `/fake-quick-tour` — a link that replays the quick tour as a brand-new
 * company would meet it, so we can iterate on it. NORTHWIND ONLY.
 *
 * What it changes, and nothing else:
 *   - the quick tour starts again from its first step on every visit;
 *   - every dialog the dashboard layout can open stays shut while that run is
 *     on screen (forced feedback, announcements, welcome pack, first-run
 *     questions, NPS, webinar invite, billing nudges). The paywall itself is
 *     left alone.
 *
 * The run is remembered in THIS TAB only (sessionStorage), because the tour
 * walks across real pages and the quiet has to follow it there. It ends when
 * the tour ends (finished, skipped or paused), so the portal goes back to
 * normal afterwards. Nothing is written to the database.
 *
 * The run also carries a PROFILE: the new company northwind is pretending to
 * be. By default it has no Stripe and has not booked the call with Bryan;
 * `?stripe=connected` and `?call=booked|none` on the link try the other
 * versions. The profile outlives the tour, for the rest of this tab, so the
 * dashboard card shows the same company once the tour closes. Closing the tab
 * clears it.
 */

export const FAKE_QUICK_TOUR_ROUTE = '/fake-quick-tour';
export const FAKE_QUICK_TOUR_TENANT = 'northwind';

const KEY = 'd247.fakeQuickTour';
const PROFILE_KEY = 'd247.fakeQuickTour.profile';
const EVENT = 'd247:fake-quick-tour';

/** The pretend new company. */
export interface FakeQuickTourProfile {
  stripe: 'missing' | 'connected';
  call: 'offer' | 'booked' | 'none';
}

/** Read `?stripe=` and `?call=` off the fake link; anything else is the default. */
export function profileFromSearch(search: string): FakeQuickTourProfile {
  const q = new URLSearchParams(search);
  const call = q.get('call');
  return {
    stripe: q.get('stripe') === 'connected' ? 'connected' : 'missing',
    call: call === 'booked' || call === 'none' ? call : 'offer',
  };
}

function readProfile(): FakeQuickTourProfile | null {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FakeQuickTourProfile>;
    return {
      stripe: p.stripe === 'connected' ? 'connected' : 'missing',
      call: p.call === 'booked' || p.call === 'none' ? p.call : 'offer',
    };
  } catch {
    return null;
  }
}

function read(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function write(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the run simply is not remembered across pages */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function startFakeQuickTour(profile: FakeQuickTourProfile = { stripe: 'missing', call: 'offer' }): void {
  try {
    window.sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage blocked: the dashboard card shows northwind's real state */
  }
  write(true);
}

export function endFakeQuickTour(): void {
  if (typeof window === 'undefined' || !read()) return;
  write(false);
}

export function isFakeQuickTourOn(): boolean {
  return typeof window !== 'undefined' && read();
}

/**
 * Should the dashboard keep every dialog shut right now? True on the fake
 * route itself from the very first render (before the run is even stored),
 * and on any page while a fake run is live. Never true outside northwind.
 */
export function useFakeQuickTourQuiet(): boolean {
  const pathname = usePathname();
  const { tenant } = useTenant();
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(read());
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  if (tenant?.slug !== FAKE_QUICK_TOUR_TENANT) return false;
  return on || pathname === FAKE_QUICK_TOUR_ROUTE;
}

/**
 * The pretend company, while one is set in this tab. Never set outside
 * northwind: the hook checks the slug, as the quiet hook does.
 */
export function useFakeQuickTourProfile(): FakeQuickTourProfile | null {
  const { tenant } = useTenant();
  const [profile, setProfile] = useState<FakeQuickTourProfile | null>(null);

  useEffect(() => {
    setProfile(readProfile());
    const sync = () => setProfile(readProfile());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  if (tenant?.slug !== FAKE_QUICK_TOUR_TENANT) return null;
  return profile;
}
