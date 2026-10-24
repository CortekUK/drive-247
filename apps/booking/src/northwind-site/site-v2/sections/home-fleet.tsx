'use client';

/**
 * Northwind booking site v2 — "Ready to drive", the home page's cars.
 *
 * One row of the operator's real cars to swipe through, on every screen size,
 * led by a card that answers the first money question before it is asked:
 * prices are per day, and "Add dates" takes you up to the hero's calendar
 * (`OPEN_TRIP_DATES_EVENT`) to see the total. Each car card carries the
 * things that decide a rental — the photo, the name, the price a day, what
 * kind of car it is, fuel and mileage — and one way in (the whole card).
 *
 * Only what the fleet really records is shown: `vehicles` has no seats,
 * luggage or gearbox columns, so the card does not claim any.
 *
 * Moving through it: swipe or scroll (it snaps a card at a time), or the
 * arrow buttons, which step one card and go quiet at either end. On a phone,
 * where there are no arrows, the row drifts slowly right to left by itself,
 * like a marquee, looping without a jump (`useMarquee`). It waits while the
 * row is off screen or the tab is hidden, stops the moment someone touches it
 * and drifts on `RESUME_MS` after they let go; with reduced motion it never
 * moves on its own. Hover follows V2_PLAN §12 — 200ms,
 * transform and opacity only, the card itself never moves: the border warms,
 * the photo zooms in a touch and "Choose this car" fills with the accent.
 *
 * Data: the server's fleet seed (`loadFleetSeed`, cheapest first) is the first
 * paint, then the live `useVehicles()` query takes over once it lands — the
 * same seed-until-live rule as the fleet page (`use-fleet-browser.ts`).
 */

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Fuel, Gauge } from 'lucide-react-nw';

import { VehiclesEmptyArt } from '@portal-v2-shared/empty-states/empty-scenes';
import {
  mileageForPeriod,
  rateForPeriod,
  toFleetVehicle,
  vehicleHref,
  type FleetSeed,
  type FleetVehicle,
} from '@nw/components/fleet/fleet-vehicle';
import { formatMileage, formatMoney } from '@nw/components/fleet/format';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useTenant } from '@nw/contexts/TenantContext';
import { useVehicles } from '@nw/hooks/use-vehicles';
import { cn } from '@nw/lib/utils';
import { OPEN_TRIP_DATES_EVENT } from '@nw/site-v2/home';
import { CarFloor, IllustratedCar, PerDayArt } from '@nw/site-v2/illustrations/home-scenes';
import { CARD, SITE_WIDE } from '@nw/site-v2/kit';

/** How many cars the home row carries before "See all". */
const ROW_LIMIT = 12;
const NO_VEHICLES: FleetVehicle[] = [];

/** Every slide in the row: a little narrower than a phone, 320px once there is room. */
const SLIDE = 'w-[84%] shrink-0 snap-start sm:w-[300px] lg:w-[320px]';

const ROUND_BUTTON =
  'grid size-11 place-items-center rounded-full border border-pv-border bg-pv-card text-pv-fg transition-colors duration-200 ' +
  'hover:border-pv-tint hover:bg-pv-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 ' +
  'disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The phone row's drift: px a second, and how long it waits after a swipe. */
const DRIFT_PX_PER_S = 28;
const RESUME_MS = 3000;
/** Phones only: from `sm` the arrows are there to move it. */
const PHONE = '(max-width: 639px)';

/** Whether this screen gets the drifting row: a phone, without reduced motion. Never true on the server. */
function useMarqueeMode() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setOn(phone.matches && !still.matches);
    update();
    phone.addEventListener('change', update);
    still.addEventListener('change', update);
    return () => {
      phone.removeEventListener('change', update);
      still.removeEventListener('change', update);
    };
  }, []);
  return on;
}

/**
 * The marquee: the row drifts right to left at `DRIFT_PX_PER_S`, for as long
 * as it is on screen and the tab is visible. The cards are rendered twice
 * (`loopFrom` is the first copy's index), so when the drift has gone one full
 * set along it steps back by exactly that much and the loop never shows a
 * jump. Snapping is off while it drifts; a touch, a wheel or keyboard focus
 * hands the row to the person, and it drifts on again `RESUME_MS` after they
 * let go, from wherever they left it.
 */
function useMarquee(row: React.RefObject<HTMLUListElement | null>, on: boolean, loopFrom: number) {
  useEffect(() => {
    const el = row.current;
    if (!el || !on) return;

    const items = el.children;
    const span = () => {
      const first = items[0] as HTMLElement | undefined;
      const copy = items[loopFrom] as HTMLElement | undefined;
      return first && copy ? copy.offsetLeft - first.offsetLeft : 0;
    };

    el.style.scrollSnapType = 'none';
    let inView = false;
    let heldUntil = 0;
    let position = el.scrollLeft;
    let last = 0;
    let frame = 0;

    const observer = new IntersectionObserver(([entry]) => (inView = !!entry?.isIntersecting), { threshold: 0.2 });
    observer.observe(el);

    const hold = () => (heldUntil = performance.now() + RESUME_MS);
    const events = ['pointerdown', 'touchstart', 'touchmove', 'wheel', 'focusin'] as const;
    for (const name of events) el.addEventListener(name, hold, { passive: true });

    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 100) : 0;
      last = now;
      if (now < heldUntil) {
        position = el.scrollLeft; // pick up from where they left it
      } else if (inView && !document.hidden) {
        const loop = span();
        position += (DRIFT_PX_PER_S * dt) / 1000;
        if (loop > 0 && position >= loop) position -= loop;
        el.scrollLeft = position;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const name of events) el.removeEventListener(name, hold);
      el.style.scrollSnapType = '';
    };
  }, [row, on, loopFrom]);
}

export function HomeFleet({ seed }: { seed: FleetSeed | null }) {
  const { tenant } = useTenant();
  const { vehicles, isLoading, isError } = useVehicles();

  const live = useMemo(() => vehicles.map(toFleetVehicle), [vehicles]);
  const fleet = live.length > 0 ? live : (seed?.vehicles ?? NO_VEHICLES);
  const currencyCode = tenant?.currency_code ?? seed?.currencyCode ?? null;
  const distanceUnit = tenant?.distance_unit ?? seed?.distanceUnit ?? null;
  const shown = fleet.slice(0, ROW_LIMIT);

  const loading = fleet.length === 0 && isLoading;
  const empty = fleet.length === 0 && !isLoading;

  const row = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  // Where the row is: which ends it touches.
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = row.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, shown.length, loading]);

  /** One card's step: a slide's width plus the gap. */
  const step = (direction: 1 | -1) => {
    const el = row.current;
    const slide = el?.querySelector('li');
    if (!el || !slide) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: direction * (slide.getBoundingClientRect().width + gap), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const marquee = useMarqueeMode() && !loading && shown.length > 1;
  // The first copy starts after the per-day card and the cars.
  useMarquee(row, marquee, shown.length + 1);

  const fleetLink = fleet.length > 1 ? `See all ${fleet.length}` : 'See all';

  return (
    <section id="cars" aria-labelledby="home-cars-title" className={cn(SITE_WIDE, 'pt-16 md:pt-24')}>
      <div data-reveal className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h2
            id="home-cars-title"
            className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.045em] text-pv-fg sm:text-[42px] lg:text-[48px]"
          >
            Ready to drive
          </h2>
          <p className="mt-2 text-[15px] text-pv-muted-fg md:text-[16px]">Swipe through our cars. Tap one to book it.</p>
        </div>

        {fleet.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/fleet"
              className="mr-1 inline-flex min-h-11 items-center gap-1.5 rounded-md text-[14px] font-semibold text-pv-fg hover:text-pv-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
            >
              {fleetLink}
              <ArrowRight aria-hidden className="size-3.5 sm:hidden" strokeWidth={2.25} />
            </Link>
            <button type="button" onClick={() => step(-1)} disabled={edges.start} aria-label="Previous cars" className={cn(ROUND_BUTTON, 'max-sm:hidden')}>
              <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
            </button>
            <button type="button" onClick={() => step(1)} disabled={edges.end} aria-label="Next cars" className={cn(ROUND_BUTTON, 'max-sm:hidden')}>
              <ChevronRight aria-hidden className="size-5" strokeWidth={2} />
            </button>
          </div>
        ) : null}
      </div>

      {empty ? (
        <div className={cn(CARD, 'mx-auto mt-8 flex max-w-xl flex-col items-center px-6 pb-10 pt-6 text-center')}>
          <VehiclesEmptyArt className="max-w-[340px]" />
          <p className="mt-2 text-[17px] font-semibold text-pv-fg">
            {isError ? "We couldn't load our cars" : 'Our cars are on their way'}
          </p>
          <p className="mt-1 max-w-sm text-[14px] text-pv-muted-fg">
            {isError ? 'Refresh the page to try again.' : 'Check back soon, or get in touch and we will help you find one.'}
          </p>
        </div>
      ) : (
        <>
          <ul
            ref={row}
            onScroll={measure}
            aria-label="Our cars"
            data-reveal-group
            className="-mx-5 mt-7 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:px-0 sm:gap-5 [&::-webkit-scrollbar]:hidden"
          >
            <PerDayCard />
            {loading
              ? Array.from({ length: 4 }, (_, index) => (
                  <li key={index} aria-hidden className={cn(CARD, SLIDE, 'overflow-hidden')}>
                    <Skeleton className="aspect-[4/3] w-full rounded-none bg-pv-tint" />
                    <div className="p-5">
                      <Skeleton className="h-4 w-2/3 bg-pv-tint" />
                      <Skeleton className="mt-2 h-3 w-1/2 bg-pv-tint" />
                      <Skeleton className="mt-6 h-11 w-full rounded-full bg-pv-tint" />
                    </div>
                  </li>
                ))
              : shown.map((vehicle) => (
                  <CarCard key={vehicle.id} vehicle={vehicle} currencyCode={currencyCode} distanceUnit={distanceUnit} />
                ))}
            {/* The marquee's second set, so the loop is seamless: out of the
                accessibility tree and the tab order, since it repeats the first. */}
            {marquee ? (
              <>
                <PerDayCard copy />
                {shown.map((vehicle) => (
                  <CarCard key={`copy-${vehicle.id}`} copy vehicle={vehicle} currencyCode={currencyCode} distanceUnit={distanceUnit} />
                ))}
              </>
            ) : null}
          </ul>

        </>
      )}
    </section>
  );
}

/**
 * The row's first card: the one thing to know about the prices, with a
 * picture, and the way to see a real total — up to the hero's calendar.
 */
/** A marquee copy: hidden from assistive tech, and nothing in it can be focused or clicked into by keyboard. */
const copyProps = (copy: boolean) =>
  copy ? ({ 'aria-hidden': true, inert: true } as unknown as React.HTMLAttributes<HTMLLIElement>) : {};

function PerDayCard({ copy = false }: { copy?: boolean }) {
  const addDates = () => {
    const target = document.getElementById('trip-dates');
    const smooth = !prefersReducedMotion();
    target?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    // Open once the page has come to rest, so the calendar opens where it is.
    window.setTimeout(() => window.dispatchEvent(new Event(OPEN_TRIP_DATES_EVENT)), smooth ? 450 : 0);
  };

  return (
    <li {...copyProps(copy)} className={cn(SLIDE, 'flex flex-col rounded-2xl bg-pv-tint p-4 sm:p-5')}>
      <div className="rounded-xl bg-pv-card px-4 py-3">
        <PerDayArt className="max-w-[230px]" />
      </div>
      <p className="mt-5 text-[20px] font-bold tracking-[-0.02em] text-pv-fg">Prices are per day</p>
      <p className="mt-2 text-[14px] leading-relaxed text-pv-muted-fg">
        Add your dates in the search above and we&apos;ll show you the total for your trip.
      </p>
      <button
        type="button"
        onClick={addDates}
        className="group/add mt-auto inline-flex min-h-11 items-center gap-1.5 self-start pt-3 text-[14px] font-semibold text-pv-fg hover:text-pv-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
      >
        Add dates
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform duration-200 ease-out group-hover/add:translate-x-0.5 motion-reduce:transition-none"
          strokeWidth={2.25}
        />
      </button>
    </li>
  );
}

/**
 * One car. The whole card is the link (the name carries a stretched overlay,
 * so the link's accessible name is the car's name); "Choose this car" is the
 * visible cue for that same link, not a second one.
 */
function CarCard({
  vehicle,
  currencyCode,
  distanceUnit,
  copy = false,
}: {
  copy?: boolean;
  vehicle: FleetVehicle;
  currencyCode: string | null;
  distanceUnit: string | null;
}) {
  const artId = `nwcar${useId().replace(/:/g, '')}`;
  // The headline price is a day's; a car let only by the week or month shows that instead.
  const period = (['day', 'week', 'month'] as const).find((p) => {
    const r = rateForPeriod(vehicle, p);
    return r.offered && r.amount != null;
  });
  const rate = period ? rateForPeriod(vehicle, period) : null;
  const mileage = mileageForPeriod(vehicle, period ?? 'day');
  const meta = [vehicle.categoryLabel, vehicle.year, vehicle.colour].filter((part) => part != null && part !== '').join(' · ');

  return (
    <li
      {...copyProps(copy)}
      className={cn(
        CARD,
        SLIDE,
        'group relative flex flex-col overflow-hidden',
        'transition-colors duration-200 ease-out hover:border-pv-primary/40 focus-within:border-pv-primary/40 motion-reduce:transition-none',
      )}
    >
      {/*
        The picture. A photo fills its frame and zooms in a touch on hover; a car
        with no photo yet is drawn instead, standing on the hero's floor with a
        glow that comes up on hover — so every card still shows a car.
      */}
      <div className="relative aspect-[4/3] overflow-hidden bg-pv-tint/60">
        {vehicle.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vehicle.photoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.05] motion-reduce:transition-none"
          />
        ) : (
          <>
            <CarFloor className="absolute inset-x-0 bottom-0 h-[50%] w-full text-[#d6d4e6] dark:text-[#3f3f46]" />
            <span
              aria-hidden
              className="absolute inset-x-[14%] bottom-[12%] h-[18%] rounded-[50%] bg-pv-primary/25 opacity-0 blur-xl transition-opacity duration-200 ease-out group-hover:opacity-100 motion-reduce:transition-none"
            />
            <div className="absolute inset-0 flex items-end justify-center pb-[13%] transition-transform duration-200 ease-out group-hover:-translate-x-1.5 group-hover:scale-[1.04] motion-reduce:transition-none">
              <IllustratedCar id={artId} className="w-[80%]" />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[18px] font-bold tracking-[-0.02em] text-pv-fg">
              <Link
                href={vehicleHref(vehicle)}
                className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-pv-primary/40"
              >
                {vehicle.name}
              </Link>
            </h3>
            {meta !== '' ? <p className="mt-1 truncate text-[13px] text-pv-muted-fg">{meta}</p> : null}
          </div>
          {rate && period ? (
            <p className="shrink-0 text-right leading-none">
              <span className="block text-[22px] font-extrabold tabular-nums tracking-[-0.02em] text-pv-fg">
                {formatMoney(rate.amount, currencyCode)}
              </span>
              <span className="mt-1 block text-[12.5px] text-pv-muted-fg">a {period}</span>
            </p>
          ) : (
            <p className="shrink-0 text-right text-[12.5px] text-pv-muted-fg">Ask for a price</p>
          )}
        </div>

        <ul className="mb-5 mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-pv-fg">
          {vehicle.fuelType ? (
            <li className="inline-flex items-center gap-1.5">
              <Fuel aria-hidden className="size-4 text-pv-muted-fg" strokeWidth={1.75} />
              {vehicle.fuelType}
            </li>
          ) : null}
          <li className="inline-flex items-center gap-1.5">
            <Gauge aria-hidden className="size-4 text-pv-muted-fg" strokeWidth={1.75} />
            {mileage == null ? 'Unlimited miles' : `${formatMileage(mileage, distanceUnit)} a ${period ?? 'day'} included`}
          </li>
        </ul>

        <span
          aria-hidden
          className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-full border border-pv-border text-[14px] font-semibold text-pv-fg transition-colors duration-200 group-hover:border-pv-primary group-hover:bg-pv-primary group-hover:text-pv-primary-fg motion-reduce:transition-none"
        >
          Choose this car
          <ArrowRight
            className="size-4 -translate-x-1 opacity-0 transition-[transform,opacity] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
            strokeWidth={2.25}
          />
        </span>
      </div>
    </li>
  );
}
