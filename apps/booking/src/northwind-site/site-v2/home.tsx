'use client';

/**
 * Northwind booking site v2 — the home hero, in ONE screen.
 *
 * On the navbar's own surface, so the bar and the hero are one piece. Left:
 * the promise, with "ready" underlined, one line on what happens, and two
 * ways in (open the calendar, see the cars). Right: the operator's own cars in
 * a collage with what booking gets you floating over them (`HeroCollage`).
 * Under both, full width, the ONE search bar: where, where back, when, until
 * when, go.
 *
 * On a desktop it fits one screen: the collage is capped by the screen's
 * height. On a phone the bar packs the places and the dates side by side.
 *
 * The words are the design's own (`COPY`), written for this hero; the
 * operator's `home_hero` CMS text is not read here.
 *
 * The search is the trip intent the fleet already reads: the addresses go
 * through `sanitizeTripAddress` into `withTripIntent('/booking', …)`. Nothing
 * is required — an empty search is "show me the cars", and an empty drop-off
 * means "same as pick-up", which is what its placeholder says. The two dates
 * come from one shadcn range calendar and ride along as `pickup_date` /
 * `return_date` (YYYY-MM-DD); the booking flow does not read them yet.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react-nw';
import type { DateRange, DayButton } from 'react-day-picker-nw';

import { Calendar } from '@nw/components/ui/calendar';
import { Popover, PopoverAnchor, PopoverContent } from '@nw/components/ui/popover';
import { sanitizeTripAddress, TRIP_INTENT_MAX_LENGTH, withTripIntent } from '@nw/lib/booking/trip-intent';
import { cn } from '@nw/lib/utils';
import { SITE_EDGE } from '@nw/site-v2/kit';
import { HeroCollage, type HeroCar } from '@nw/site-v2/sections/hero-collage';

/**
 * Fired on `window` by anything below the hero that offers "Add dates" (the
 * cars section's per-day card): the hero scrolls into view and opens its
 * calendar at the pick-up day.
 */
export const OPEN_TRIP_DATES_EVENT = 'nw:open-trip-dates';

/** The query keys the dates travel under. */
const PICKUP_DATE_PARAM = 'pickup_date';
const RETURN_DATE_PARAM = 'return_date';

/**
 * The hero's words. Plain and short, in the operator's voice to their
 * customer: the promise, then exactly what happens — no slogans, nothing a
 * first-time renter has to decode.
 */
const COPY = {
  headline: 'Your car is ready when you are.',
  subheading: "Pick a car, choose your dates and pay online. We'll have it clean and waiting for you.",
  button: 'Find a car',
  pickup: 'Pick-up location',
  dropoff: 'Drop-off location',
  address: 'Enter an address',
  sameAsPickup: 'Same as pick-up',
} as const;

/** A Date as YYYY-MM-DD in local time — never `toISOString()`, which shifts the day. */
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** "Fri, 24 Oct" — short enough for a cell, with the weekday people plan by. */
const shortDay = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Two months side by side once there is room; one on a phone. */
const WIDE = '(min-width: 768px)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);

export function SiteV2Hero({ cars = [], currencyCode = null }: { cars?: HeroCar[]; currencyCode?: string | null }) {
  const openDates = () => window.dispatchEvent(new Event(OPEN_TRIP_DATES_EVENT));
  return (
    // The same surface as the navbar, edge to edge, so the bar and the hero read
    // as one; it fades into the page's wash at the foot.
    <div className="bg-[linear-gradient(to_bottom,var(--nw-hero-bg)_82%,transparent)]">
      <section
        className={cn(
          SITE_EDGE,
          'relative flex w-full flex-col justify-center pb-4 pt-6 sm:pt-8',
          // One screen tall (under the 60/68px header), the parts centred in it.
          'lg:min-h-[calc(100svh-68px)]',
        )}
      >
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          {/* Centred while it stacks over the picture; left-aligned beside it from lg. */}
          <div className="max-w-[680px] max-lg:mx-auto max-lg:text-center">
            <h1 className="nw-rise text-[40px] font-extrabold max-lg:[text-wrap:balance] leading-[1.02] tracking-[-0.05em] text-pv-fg sm:text-[56px] lg:text-[64px] xl:text-[76px]">
              Your car is{' '}
              <span className="relative isolate inline-block text-pv-primary">
                ready
                {/* One confident marker stroke under the promise, in a light tint of
                    the brand colour and BEHIND the word, so the "y" runs over it
                    rather than tangling with it. The box keeps the viewBox's 10:1
                    shape, so the stroke keeps an even weight at every size. It
                    draws itself left to right once the headline has risen in
                    (`nw-draw`, styles/site.css); with reduced motion it is simply there. */}
                <svg
                  aria-hidden
                  viewBox="0 0 200 20"
                  preserveAspectRatio="none"
                  className="nw-live absolute -bottom-[0.14em] -left-[0.04em] -z-10 h-[0.31em] w-[calc(100%+0.08em)] text-pv-primary/30 dark:text-pv-primary/50"
                  fill="none"
                >
                  <path
                    className="nw-draw"
                    pathLength={1}
                    style={{ '--d': '0.3s', animationDuration: '0.45s' } as React.CSSProperties}
                    d="M5 14 C55 7 125 5 195 9"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                </svg>
              </span>{' '}
              when you are.
            </h1>
            <p style={{ '--d': '90ms' } as React.CSSProperties} className="nw-rise mt-5 max-w-[30rem] text-[16px] max-lg:mx-auto max-lg:[text-wrap:balance] leading-relaxed text-pv-muted-fg md:text-[18px]">{COPY.subheading}</p>
            <div style={{ '--d': '180ms' } as React.CSSProperties} className="nw-rise mt-7 flex flex-wrap gap-3 max-lg:justify-center max-sm:hidden">
              <button
                type="button"
                onClick={openDates}
                className="inline-flex h-12 items-center rounded-full bg-pv-fg px-7 text-[15px] font-semibold text-pv-bg transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/25 motion-reduce:transition-none"
              >
                Choose your dates
              </button>
              <Link
                href="/fleet"
                className="inline-flex h-12 items-center rounded-full border border-pv-border bg-pv-card px-7 text-[15px] font-semibold text-pv-fg transition-colors duration-200 hover:border-pv-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
              >
                See all cars
              </Link>
            </div>
          </div>

          <HeroCollage
            cars={cars}
            currencyCode={currencyCode}
            className="nw-rise max-lg:max-w-[460px] lg:w-[min(100%,calc((100svh-68px-200px)*560/504))]"
          />
        </div>

        <div style={{ '--d': '260ms' } as React.CSSProperties} className="nw-rise relative z-10 mt-6 w-full lg:mt-8">
          <TripSearch />
        </div>
      </section>
    </div>
  );
}

/* ───────────────────────────────── search ──────────────────────────────── */

const CELL =
  'relative flex min-w-0 items-center gap-3 rounded-[18px] px-3 py-2.5 text-left sm:px-4 sm:py-3 transition-colors duration-200 ' +
  'hover:bg-pv-row-hover focus-within:bg-pv-tint/60 motion-reduce:transition-none lg:rounded-full lg:px-5';

/** The hairline between two cells: across when they stack, down when they sit side by side. */
const Divider = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('h-px shrink-0 bg-pv-border', className)} />
);

/**
 * One bar: where (two places), when (two dates), go. A full-width pill on a
 * desktop; below that the places sit over the dates, two by two, and the
 * button runs full width under them — short enough to keep the hero in one
 * screen on a phone.
 */
function TripSearch() {
  const router = useRouter();
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [dates, setDates] = useState<DateRange | undefined>();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = new URLSearchParams();
    if (dates?.from) query.set(PICKUP_DATE_PARAM, isoDay(dates.from));
    if (dates?.to) query.set(RETURN_DATE_PARAM, isoDay(dates.to));
    const search = query.toString();
    const base = search ? `/booking?${search}` : '/booking';
    router.push(withTripIntent(base, { pickup: sanitizeTripAddress(pickup), dropoff: sanitizeTripAddress(dropoff) }));
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col rounded-[26px] border border-pv-border bg-pv-card p-2 shadow-[0_24px_60px_-28px_hsl(var(--brand-h,248)_60%_40%/0.35)] lg:flex-row lg:items-stretch lg:rounded-full"
    >
      <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] lg:flex-[1.25]">
        <PlaceField id="pickup" label={COPY.pickup} placeholder={COPY.address} value={pickup} onChange={setPickup} />
        <Divider className="my-3 h-auto w-px" />
        <PlaceField id="dropoff" label={COPY.dropoff} placeholder={COPY.sameAsPickup} value={dropoff} onChange={setDropoff} />
      </div>
      <Divider className="mx-4 lg:mx-0 lg:my-3 lg:h-auto lg:w-px" />
      <TripDates value={dates} onChange={setDates} />
      <button
        type="submit"
        className="mt-2 inline-flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-full bg-pv-primary px-8 text-[15px] font-semibold text-pv-primary-fg transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/25 motion-reduce:transition-none lg:ml-2 lg:mt-0 lg:h-auto lg:min-h-[60px]"
      >
        {COPY.button}
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
      </button>
    </form>
  );
}

function PlaceField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={CELL}>
      <MapPin aria-hidden className="hidden size-5 shrink-0 text-pv-fg sm:block" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[12.5px] font-semibold text-pv-fg">
          {label}
        </label>
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={TRIP_INTENT_MAX_LENGTH}
          placeholder={placeholder}
          autoComplete="street-address"
          className="mt-0.5 h-6 w-full min-w-0 bg-transparent text-[15px] text-pv-fg outline-none placeholder:text-pv-muted-fg"
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────── the dates ────────────────────────────── */

type End = 'from' | 'to';

/**
 * The two date cells and ONE calendar (shadcn's, in range mode) under them —
 * the way people already book travel: tap the day you collect the car, then
 * the day you bring it back, and the calendar closes. Either cell opens it; the
 * line at its top says which day it is waiting for, so nobody has to guess.
 * Days before today cannot be picked.
 */
function TripDates({ value, onChange }: { value: DateRange | undefined; onChange: (value: DateRange | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState<End>('from');
  const wide = useWide();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openAt = (which: End) => {
    // Asking for a return day before a pick-up day starts at the pick-up day.
    setEnd(which === 'to' && !value?.from ? 'from' : which);
    setOpen(true);
  };

  // "Add dates" from further down the page.
  useEffect(() => {
    const open = () => {
      setEnd('from');
      setOpen(true);
    };
    window.addEventListener(OPEN_TRIP_DATES_EVENT, open);
    return () => window.removeEventListener(OPEN_TRIP_DATES_EVENT, open);
  }, []);

  const pick = (day: Date) => {
    if (end === 'from' || !value?.from || day < value.from) {
      // A new pick-up day keeps a return day that still comes after it.
      onChange({ from: day, to: value?.to && value.to >= day && end === 'from' ? value.to : undefined });
      setEnd('to');
      return;
    }
    onChange({ from: value.from, to: day });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div id="trip-dates" className="grid min-w-0 scroll-mt-40 grid-cols-[1fr_auto_1fr] lg:flex-1">
          <DateCell label="Pick-up date" date={value?.from} active={open && end === 'from'} onOpen={() => openAt('from')} />
          <Divider className="my-3 h-auto w-px" />
          <DateCell label="Return date" date={value?.to} active={open && end === 'to'} onOpen={() => openAt('to')} />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        sideOffset={12}
        collisionPadding={12}
        className="max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-pv-border bg-pv-card p-3 text-pv-fg shadow-lg"
      >
        <p className="px-2 pt-1 text-[14px] font-semibold text-pv-fg">
          {end === 'from' ? 'When do you want to pick up the car?' : 'And when will you bring it back?'}
        </p>
        <p className="px-2 text-[12.5px] text-pv-muted-fg">
          {value?.from && value.to
            ? `${shortDay(value.from)} to ${shortDay(value.to)}`
            : end === 'from'
              ? 'Tap the day you collect it.'
              : `Picking up ${value?.from ? shortDay(value.from) : ''}. Tap the return day.`}
        </p>
        <Calendar
          mode="range"
          selected={value}
          onDayClick={(day, modifiers) => {
            if (!modifiers.disabled) pick(day);
          }}
          defaultMonth={value?.from ?? today}
          numberOfMonths={wide ? 2 : 1}
          disabled={{ before: today }}
          className="mt-1 bg-transparent p-1 [--cell-size:--spacing(10)] md:[--cell-size:--spacing(9)]"
          classNames={{
            caption_label: 'text-sm font-semibold text-pv-fg',
            weekday: 'flex-1 select-none text-[0.75rem] font-medium text-pv-muted-fg',
            today: '',
            range_start: 'rounded-l-[10px] bg-pv-tint',
            range_middle: 'rounded-none bg-pv-tint',
            range_end: 'rounded-r-[10px] bg-pv-tint',
          }}
          components={{ DayButton: RangeDayButton }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DateCell({
  label,
  date,
  active,
  onOpen,
}: {
  label: string;
  date: Date | undefined;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={active}
      className={cn(
        CELL,
        'w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30',
        active && 'bg-pv-tint/60',
      )}
    >
      <CalendarDays aria-hidden className="hidden size-5 shrink-0 text-pv-fg sm:block" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-pv-fg">{label}</span>
        <span className={cn('mt-0.5 block h-6 truncate text-[15px] leading-6', date ? 'text-pv-fg' : 'text-pv-muted-fg')}>
          {date ? shortDay(date) : 'Add date'}
        </span>
      </span>
    </button>
  );
}

/**
 * A day in the calendar, on the v2 tokens: the pick-up and return days are
 * solid accent squares joined by a tinted band (the cell behind them), today is
 * in the accent, and past days are faded and struck through.
 */
function RangeDayButton({ className, day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  const edge = modifiers.range_start || modifiers.range_end;
  return (
    <button
      ref={ref}
      data-day={day.date.toLocaleDateString()}
      className={cn(
        'flex aspect-square w-full min-w-(--cell-size) items-center justify-center rounded-[10px] text-[13.5px] text-pv-fg',
        'transition-colors duration-200 hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none',
        modifiers.today && !edge && 'font-semibold text-pv-primary',
        modifiers.range_middle && 'rounded-none hover:bg-pv-primary/15',
        edge && 'bg-pv-primary font-semibold text-pv-primary-fg hover:bg-pv-primary',
        modifiers.outside && !edge && 'text-pv-muted-fg/60',
        modifiers.disabled && 'pointer-events-none text-pv-muted-fg line-through opacity-40',
        className,
      )}
      {...props}
    />
  );
}
