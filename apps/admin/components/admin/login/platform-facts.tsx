'use client';

/**
 * The super-admin login hero: live facts about the whole platform, typed out
 * one at a time — the same typed headline as Northwind's portal login
 * (apps/portal/src/components/shared/layout/hero-typed-headline.tsx), with the
 * product pitch swapped for numbers that are true right now.
 *
 * The numbers come from `public.platform_login_facts()`, which is called with
 * the anon key (nobody is signed in yet) and so returns aggregates only — no
 * money, nothing about any one operator or renter, test tenants excluded. See
 * supabase/migrations/20261017120000_platform_login_facts.sql.
 *
 * A fact is only shown when its number is worth saying out loud; a fetch that
 * fails falls back to a few lines that need no numbers, so the hero is never
 * empty and never wrong.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface PlatformFacts {
  operators?: number;
  vehicles?: number;
  customers?: number;
  rentals?: number;
  rentals_30d?: number;
  last_booking_at?: string | null;
  avg_rental_days?: number | null;
  longest_rental_days?: number | null;
  rental_days_total?: number | null;
  top_make?: string | null;
  busiest_pickup_day?: string | null;
  agreements_signed?: number;
  time_zones?: number;
  best_month?: string | null;
  best_month_rentals?: number | null;
  turo_imports?: number;
  insured_at_checkout?: number;
}

interface Fact {
  before: string;
  key: string;
  after: string;
  sub: string;
}

const n = (value: number) => value.toLocaleString('en-US');

function timeAgo(iso: string): string | null {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'a minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return null; // Older than a week is not a fact worth leading with.
}

/** Every fact the numbers support, best first. */
function factsFrom(f: PlatformFacts): Fact[] {
  const out: Fact[] = [];

  if ((f.rentals ?? 0) >= 50) {
    out.push({
      before: '',
      key: n(f.rentals!),
      after: ' rentals booked on Drive247.',
      sub:
        (f.rentals_30d ?? 0) >= 10
          ? `Priced, insured, signed and paid on the platform — ${n(f.rentals_30d!)} of them in the last 30 days.`
          : 'Every one priced, insured, signed and paid on the platform.',
    });
  }

  if ((f.operators ?? 0) >= 5) {
    out.push({
      before: '',
      key: n(f.operators!),
      after: ' rental companies run on Drive247.',
      sub:
        (f.time_zones ?? 0) >= 3
          ? `Independent operators across ${n(f.time_zones!)} time zones, each with their own booking site and portal.`
          : 'Independent operators, each with their own booking site and portal.',
    });
  }

  if (f.last_booking_at) {
    const ago = timeAgo(f.last_booking_at);
    if (ago) {
      out.push({
        before: 'Last booking: ',
        key: ago,
        after: '.',
        sub: 'Somewhere on the platform a car was just rented — no phone call, no paperwork.',
      });
    }
  }

  if ((f.rental_days_total ?? 0) >= 365) {
    const years = Math.floor(f.rental_days_total! / 365);
    out.push({
      before: '',
      key: n(f.rental_days_total!),
      after: ' days on the road.',
      sub: `Every rental added end to end — more than ${n(years)} ${years === 1 ? 'year' : 'years'} of driving, booked through Drive247.`,
    });
  }

  if ((f.vehicles ?? 0) >= 20) {
    out.push({
      before: '',
      key: n(f.vehicles!),
      after: ' cars on the platform.',
      sub: 'Each one priced, scheduled and tracked on its operator’s fleet calendar.',
    });
  }

  if (f.busiest_pickup_day) {
    out.push({
      before: '',
      key: `${f.busiest_pickup_day}`,
      after: ' is pickup day.',
      sub: `More rentals start on a ${f.busiest_pickup_day} than on any other day of the week.`,
    });
  }

  if ((f.customers ?? 0) >= 50) {
    out.push({
      before: '',
      key: n(f.customers!),
      after: ' renters and counting.',
      sub: 'Verified, booked and looked after by the operators who run on Drive247.',
    });
  }

  if (f.best_month && (f.best_month_rentals ?? 0) >= 20) {
    out.push({
      before: 'Record month: ',
      key: f.best_month,
      after: '.',
      sub: `${n(f.best_month_rentals!)} rentals booked — the busiest month the platform has had.`,
    });
  }

  if (f.top_make) {
    out.push({
      before: '',
      key: f.top_make,
      after: ' leads the fleet.',
      sub: 'The most-rented make on Drive247, counted by bookings rather than by cars listed.',
    });
  }

  if (f.avg_rental_days && f.avg_rental_days > 0) {
    out.push({
      before: '',
      key: `${f.avg_rental_days} days`,
      after: ', on average.',
      sub:
        (f.longest_rental_days ?? 0) > 30
          ? `How long a typical rental runs. The longest so far: ${n(f.longest_rental_days!)} days.`
          : 'How long a typical rental runs on the platform.',
    });
  }

  if ((f.agreements_signed ?? 0) >= 25) {
    out.push({
      before: '',
      key: n(f.agreements_signed!),
      after: ' agreements e-signed.',
      sub: 'Sent through BoldSign, signed on a phone, and filed against the rental. No paper.',
    });
  }

  if ((f.turo_imports ?? 0) >= 10) {
    out.push({
      before: '',
      key: n(f.turo_imports!),
      after: ' Turo trips synced.',
      sub: 'Pulled in from Turo automatically, so an operator’s calendar never double-books a car.',
    });
  }

  if ((f.insured_at_checkout ?? 0) >= 10) {
    out.push({
      before: '',
      key: n(f.insured_at_checkout!),
      after: ' rentals insured at checkout.',
      sub: 'Bonzah cover added as the customer booked — quote, policy and payment in one flow.',
    });
  }

  return out;
}

/** Shown while the numbers load, and instead of them if they cannot. */
const FALLBACK: Fact[] = [
  {
    before: 'Every ',
    key: 'operator',
    after: ', one screen.',
    sub: 'Rental companies, their subscriptions and their health, in one place.',
  },
];

const headlineOf = (f: Fact) => f.before + f.key + f.after;

const TYPE_MS = 40;
const ERASE_MS = 18;
const HOLD_MS = 3800;

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduce(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return reduce;
}

export function PlatformFactsHeadline({ accentInk, compact = false }: { accentInk: string; compact?: boolean }) {
  const [facts, setFacts] = useState<Fact[]>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase as any).rpc('platform_login_facts');
        if (cancelled || error || !data) return;
        const live = factsFrom(data as PlatformFacts);
        if (live.length > 0) setFacts(live);
      } catch {
        /* The fallback line stays. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reduceMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [erasing, setErasing] = useState(false);

  // A new set of facts starts from its first line.
  useEffect(() => {
    setIndex(0);
    setCharCount(0);
    setErasing(false);
  }, [facts]);

  const fact = facts[index % facts.length];

  useEffect(() => {
    if (reduceMotion) return;
    const headline = headlineOf(fact);

    if (!erasing) {
      if (charCount < headline.length) {
        const t = setTimeout(() => setCharCount((c) => c + 1), TYPE_MS);
        return () => clearTimeout(t);
      }
      if (facts.length === 1) return; // Nothing to move on to.
      const t = setTimeout(() => setErasing(true), HOLD_MS);
      return () => clearTimeout(t);
    }

    if (charCount > 0) {
      const t = setTimeout(() => setCharCount((c) => c - 1), ERASE_MS);
      return () => clearTimeout(t);
    }

    setIndex((i) => (i + 1) % facts.length);
    setErasing(false);
  }, [charCount, erasing, fact, facts.length, reduceMotion]);

  const revealed = reduceMotion ? headlineOf(fact).length : charCount;
  const beforeShown = fact.before.slice(0, revealed);
  const keyShown = fact.key.slice(0, Math.max(0, revealed - fact.before.length));
  const afterShown = fact.after.slice(0, Math.max(0, revealed - fact.before.length - fact.key.length));
  // The sub-line is not typed — two things typing at once is noise. It fades in
  // once its headline is complete and out before the headline is erased.
  const subVisible = reduceMotion || (!erasing && revealed === headlineOf(fact).length);

  const headlineSize = compact ? 'text-[26px]' : 'text-5xl xl:text-6xl';
  const subSize = compact ? 'mt-2 text-sm' : 'mt-4 max-w-lg text-lg';

  return (
    <div className={`grid ${compact ? 'text-center' : 'max-w-xl'}`}>
      {/* Every fact rendered once, invisibly, in the same grid cell: the cell is
          as tall as the tallest one, so nothing below it ever moves. */}
      {facts.map((f, i) => (
        <div key={`measure-${i}`} aria-hidden="true" className="invisible col-start-1 row-start-1">
          <p className={`${headlineSize} font-extrabold leading-[1.1] tracking-tight`}>{headlineOf(f)}</p>
          <p className={`${subSize} leading-relaxed`}>{f.sub}</p>
        </div>
      ))}

      <div className="col-start-1 row-start-1">
        <p aria-hidden="true" className={`${headlineSize} font-extrabold leading-[1.1] tracking-tight text-slate-900`}>
          {beforeShown}
          <span style={{ color: accentInk }}>{keyShown}</span>
          {afterShown}
          {!reduceMotion && (
            // Takes no width, so it can never push the last word onto a new line.
            <span className="relative inline-block h-[0.8em] w-0 align-[-0.04em]">
              <span
                className="absolute left-1 top-0 h-full w-[3px] animate-pulse rounded-full"
                style={{ backgroundColor: accentInk }}
              />
            </span>
          )}
        </p>
        <p
          aria-hidden="true"
          className={`${subSize} leading-relaxed text-slate-600 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
            subVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {fact.sub}
        </p>
      </div>

      <ul className="sr-only">
        {facts.map((f, i) => (
          <li key={i}>
            {headlineOf(f)} {f.sub}
          </li>
        ))}
      </ul>
    </div>
  );
}
