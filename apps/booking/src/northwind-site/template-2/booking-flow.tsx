'use client';

/**
 * Template 2 ("Glass") — the booking flow on its own page (/template-2/booking).
 *
 * The trip is one object you edit, not a row of panels:
 *
 *   the itinerary   one wide glass bar: Pickup on the left, Return on the
 *                   right, each its day set large with its time, and the
 *                   length of the trip on the line between them, with the
 *                   quick lengths under it. Tap an end to set its time. It is
 *                   the trip's summary too, so there is no summary card
 *   1  dates        two months side by side (one on a phone): tap the pickup
 *                   then the return, or drag across the trip
 *      time         the chosen end's hours in one row, then its quarter hour
 *   2  car          the bar stays on top, compact (tap an end to go back and
 *                   change it); the cars free for those dates, priced
 *   3  checkout     the car's own Template 2 page, dates carried over
 *
 *   the dock        frosted, pinned to the bottom at every width: the trip
 *                   or the car's total (tap for the full summary), and the
 *                   way on
 *
 * The rules are site-v2's, not copied: `useBookingFlow` holds the state, the
 * legal days and hours, the cars and the navigation; the car list and the
 * full summary are site-v2's components re-tokened by `.g2-skin`.
 */

import { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Globe, Loader2, Lock } from 'lucide-react-nw';

import { formatClockLabel, localDateToIso, zonedWallClockToInstant } from '@nw/components/booking/time-utils';
import { Dialog, DialogDescription, DialogTitle } from '@nw/components/ui/dialog';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import { PvDialogContent } from '@nw/portal-v2/dialog';
import { CarStep } from '@nw/site-v2/book/car-step';
import { dateOf, prettyDate, type TripEnd } from '@nw/site-v2/book/trip-calendar';
import { StartOver, TripOverview } from '@nw/site-v2/book/trip-overview';
import { useBookingFlow, type BookingFlow, type FlowStep } from '@nw/site-v2/book/use-booking-flow';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
const WELL = 'g2-well g2-tray rounded-[28px]';
const CHIP_ON = 'bg-white text-[var(--g2-accent-ink)] shadow-[0_6px_16px_-10px_var(--g2-accent),inset_0_0_0_1.5px_color-mix(in_oklab,var(--g2-accent)_45%,white)]';

const STEPS: { key: FlowStep | 'checkout'; label: string }[] = [
  { key: 'trip', label: 'Dates' },
  { key: 'car', label: 'Car' },
  { key: 'checkout', label: 'Checkout' },
];

export function Template2BookingFlow() {
  const flow = useBookingFlow();
  const primary = usePrimaryAction(flow);
  // Which time is being set; picking the days hands over to the right one.
  const [active, setActive] = useState<TripEnd>('pickup');

  const loading = flow.pending === 'checkout' || !flow.restored || (flow.pending && flow.pending !== flow.step);
  const onTrip = flow.step === 'trip';

  return (
    <Frame>
      <Header flow={flow} />
      {loading ? (
        <StepSkeleton step={flow.pending === 'car' ? 'car' : 'trip'} />
      ) : (
        <div key={flow.step} className="g2-msg-in mt-5 space-y-3 sm:mt-6">
          <Itinerary
            flow={flow}
            active={onTrip ? active : null}
            onEnd={(end) => {
              setActive(end);
              if (!onTrip) flow.goTo('trip');
            }}
            onLength={() => setActive('return')}
          />
          {onTrip ? (
            <>
              <GlassCalendar
                flow={flow}
                onPicked={setActive}
                notice={flow.tripValid && !flow.carsLoading && !flow.carsError && flow.cars.length === 0 ? 'Every car is booked on those days. Try moving them.' : null}
              />
              <TimeRow flow={flow} active={active} />
            </>
          ) : (
            <div className="g2-skin">
              <CarStep flow={flow} />
            </div>
          )}
        </div>
      )}
      <Dock flow={flow} primary={primary} />
    </Frame>
  );
}

/** The page's pane of glass. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-3">
      <section aria-label="Book a car" className="mx-auto w-full max-w-[1320px] px-3 pt-[84px] sm:px-5 sm:pt-[96px]">
        <div className="g2-glass rounded-[32px] px-3 pb-3 pt-5 sm:rounded-[44px] sm:px-5 sm:pb-5 sm:pt-7 lg:rounded-[40px]">{children}</div>
      </section>
    </div>
  );
}

/** The whole page while its route loads. */
export function Template2BookingFlowSkeleton() {
  return (
    <Frame>
      <div className="flex items-end justify-between gap-4 px-2">
        <div className="h-10 w-[260px] max-w-full animate-pulse rounded-xl bg-white/50 motion-reduce:animate-none" />
        <div className="hidden h-8 w-[300px] animate-pulse rounded-full bg-white/50 motion-reduce:animate-none sm:block" />
      </div>
      <StepSkeleton step="trip" />
    </Frame>
  );
}

function StepSkeleton({ step }: { step: FlowStep }) {
  const bar = 'animate-pulse bg-white/50 motion-reduce:animate-none';
  return (
    <div aria-busy aria-label="Loading" className="mt-5 space-y-3 sm:mt-6">
      <div className={cn('h-[148px] rounded-[30px]', bar)} />
      {step === 'trip' ? (
        <div className={cn('h-[400px] rounded-[28px]', bar)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((n) => (
            <div key={n} className={cn('h-[300px] rounded-[28px]', bar)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── the title, and how far along ──────────────────────────────────────── */

function Header({ flow }: { flow: BookingFlow }) {
  const index = flow.step === 'trip' ? 0 : 1;
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 px-2 sm:px-3">
      <h1 className="text-[32px] font-semibold leading-none tracking-[-0.045em] text-[var(--g2-ink)] sm:text-[44px]">
        {flow.step === 'trip' ? 'Plan your trip' : 'Choose your car'}
      </h1>
      <div className="flex w-full items-center gap-3 sm:w-auto">
        <nav aria-label="Booking steps" className="min-w-0 flex-1 sm:w-[320px] sm:flex-none">
          <ol className="grid grid-cols-3 gap-1.5">
            {STEPS.map((step, i) => {
              const current = i === index;
              const reached = i <= index;
              // Back to the dates any time; on to the car once the trip is valid.
              const reachable = !current && (step.key === 'trip' || (step.key === 'car' && flow.tripValid));
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    disabled={!reachable}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => step.key !== 'checkout' && flow.goTo(step.key)}
                    className={cn('group w-full rounded-md pb-1 text-left disabled:cursor-default', FOCUS)}
                  >
                    <span className={cn('block h-1.5 rounded-full transition-colors duration-300', reached ? 'bg-[var(--g2-accent)]' : 'bg-white/70')} />
                    <span
                      className={cn(
                        'mt-2 block text-[13px] font-semibold',
                        current ? 'text-[var(--g2-ink)]' : reachable ? 'text-[var(--g2-ink-soft)] group-hover:text-[var(--g2-ink)]' : 'text-[var(--g2-ink-soft)]/70',
                      )}
                    >
                      {step.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <span className="g2-skin shrink-0">
          <StartOver onConfirm={flow.startOver} disabled={!flow.tripTouched && !flow.chosen} />
        </span>
      </div>
    </header>
  );
}

/* ── the itinerary ─────────────────────────────────────────────────────── */

const LENGTHS = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
];

/**
 * Pickup, the trip's length, Return. On the dates step an end is raised while
 * its time is being set; on the car step both are plain, and tapping one goes
 * back to change it.
 */
function Itinerary({
  flow,
  active,
  onEnd,
  onLength,
}: {
  flow: BookingFlow;
  active: TripEnd | null;
  onEnd: (end: TripEnd) => void;
  onLength: () => void;
}) {
  const editing = active !== null;
  const minDays = Math.max(1, Math.ceil(flow.rules.minRentalHours / 24));
  const lengths = LENGTHS.filter((l) => l.days >= minDays && l.days <= flow.rules.maxRentalDays);
  const days = flow.days;

  return (
    <div className={cn('g2-well g2-tray grid grid-cols-2 gap-1 rounded-[30px] p-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] sm:gap-0')}>
      <End end="pickup" label="Pickup" date={flow.trip.pickupDate} time={flow.trip.pickupTime} on={active === 'pickup'} editing={editing} onClick={() => onEnd('pickup')} />

      {/* The trip's length on the line between the two ends. */}
      <div className="col-span-2 row-start-2 flex flex-col items-center justify-center px-2 pb-2 pt-3 sm:col-span-1 sm:row-start-1 sm:col-start-2 sm:py-4">
        <div className="flex w-full items-center justify-center gap-3">
          <span aria-hidden className="h-px flex-1 border-t-2 border-dashed border-[color-mix(in_oklab,var(--g2-accent)_35%,white)] max-sm:hidden" />
          <p className="shrink-0 text-[15px] font-semibold text-[var(--g2-ink)] sm:text-[17px]">
            {days} {days === 1 ? 'day' : 'days'}
          </p>
          <span aria-hidden className="h-px flex-1 border-t-2 border-dashed border-[color-mix(in_oklab,var(--g2-accent)_35%,white)] max-sm:hidden" />
        </div>
        {editing && lengths.length > 0 ? (
          <div role="group" aria-label="Trip length" className="mt-3 flex flex-wrap justify-center gap-0.5 rounded-[20px] bg-white/45 p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.75)]">
            {lengths.map((l) => {
              const on = flow.days === l.days;
              return (
                <button
                  key={l.days}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    flow.setLength(l.days);
                    onLength();
                  }}
                  className={cn(
                    'h-8 rounded-full px-3 text-[13px] font-semibold transition-colors duration-200',
                    on ? CHIP_ON : 'text-[var(--g2-ink)] hover:bg-white/80',
                    FOCUS,
                  )}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <End end="return" label="Return" date={flow.trip.dropoffDate} time={flow.trip.dropoffTime} on={active === 'return'} editing={editing} onClick={() => onEnd('return')} align="end" />
    </div>
  );
}

function End({
  label,
  date,
  time,
  on,
  editing,
  onClick,
  align = 'start',
}: {
  end: TripEnd;
  label: string;
  date: string;
  time: string;
  on: boolean;
  editing: boolean;
  onClick: () => void;
  align?: 'start' | 'end';
}) {
  return (
    <button
      type="button"
      aria-pressed={editing ? on : undefined}
      aria-label={editing ? `${label}: ${prettyDate(date)}, ${time ? formatClockLabel(time) : 'no time'}. Set the ${label.toLowerCase()} time` : `Change ${label.toLowerCase()}: ${prettyDate(date)}`}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col rounded-[24px] px-3.5 py-4 min-[380px]:px-4 transition-[background-color,box-shadow] duration-200 sm:px-6 sm:py-5',
        align === 'end' ? 'items-end text-right' : 'items-start text-left',
        // The end not being set still reads as a box of its own, only lighter.
        on ? 'bg-white shadow-[0_14px_30px_-18px_rgb(13_12_29/0.55),inset_0_1px_0_#fff]' : 'bg-white/45 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.75)] hover:bg-white/65',
        FOCUS,
      )}
    >
      <span className={cn('text-[13px] font-semibold', on ? 'text-[var(--g2-accent-ink)]' : 'text-[var(--g2-ink-soft)]')}>{label}</span>
      <span className="mt-1 whitespace-nowrap text-[21px] font-semibold leading-[1.05] tracking-[-0.045em] text-[var(--g2-ink)] min-[380px]:text-[24px] min-[420px]:text-[28px] sm:text-[34px] lg:text-[40px]">
        {prettyDate(date)}
      </span>
      <span className={cn('mt-1.5 text-[15px] font-semibold tabular-nums sm:text-[17px]', on ? 'text-[var(--g2-accent-ink)]' : 'text-[var(--g2-ink-soft)]')}>
        {time ? formatClockLabel(time) : 'Choose a time'}
      </span>
    </button>
  );
}

/* ── the time for the chosen end ───────────────────────────────────────── */

function TimeRow({ flow, active }: { flow: BookingFlow; active: TripEnd }) {
  const pickup = active === 'pickup';
  const date = pickup ? flow.trip.pickupDate : flow.trip.dropoffDate;
  return (
    <div className={cn(WELL, 'px-3 py-5 sm:px-5 sm:py-6')}>
      <div className="mb-4 flex flex-col items-center gap-1 text-center">
        <h2 className="text-[19px] font-semibold tracking-[-0.025em] text-[var(--g2-ink)] sm:text-[21px]">
          {pickup ? 'Pickup' : 'Return'} time on {prettyDate(date)}
        </h2>
        <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--g2-ink-soft)]">
          <Globe aria-hidden className="size-3.5 shrink-0 text-[var(--g2-accent-ink)]" />
          <span>
            {flow.operatorZone.city} time{flow.operatorZone.name ? ` (${flow.operatorZone.name})` : ''}
          </span>
        </p>
      </div>
      {pickup ? (
        <HourPicker
          key={`pickup-${flow.trip.pickupDate}`}
          label="Pickup"
          date={flow.trip.pickupDate}
          value={flow.trip.pickupTime}
          slots={flow.rules.timeSlots}
          isOpen={(slot) => flow.isPickupSlotOpen(flow.trip.pickupDate, slot)}
          onChange={(pickupTime) => flow.updateTrip({ pickupTime })}
          flow={flow}
        />
      ) : (
        <HourPicker
          key={`return-${flow.trip.dropoffDate}`}
          label="Return"
          date={flow.trip.dropoffDate}
          value={flow.trip.dropoffTime}
          slots={flow.rules.timeSlots}
          isOpen={RETURN_ALWAYS_OPEN}
          onChange={(dropoffTime) => flow.updateTrip({ dropoffTime })}
          flow={flow}
        />
      )}
    </div>
  );
}

/** The return is always at least a day after a legal pickup, so every slot is open. */
const RETURN_ALWAYS_OPEN = () => true;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * One end's time: the hours the operator works, as chips (an hour with no
 * open quarter is faded and can't be picked), then the quarter hour. Every
 * pick is kept at once; there is no "set".
 */
function HourPicker({
  label,
  date,
  value,
  slots,
  isOpen,
  onChange,
  flow,
}: {
  label: string;
  date: string;
  value: string;
  slots: readonly string[];
  isOpen: (slot: string) => boolean;
  onChange: (slot: string) => void;
  flow: BookingFlow;
}) {
  const hours = useMemo(() => [...new Set(slots.map((slot) => Number(slot.slice(0, 2))))].sort((a, b) => a - b), [slots]);
  const hour = value ? Number(value.slice(0, 2)) : null;
  const minute = value ? Number(value.slice(3, 5)) : 0;
  const openIn = (h: number) => slots.filter((slot) => Number(slot.slice(0, 2)) === h && isOpen(slot));

  const pickHour = (h: number) => {
    const open = openIn(h);
    if (open.length === 0) return;
    // Keep the quarter already chosen when that hour has it.
    const same = open.find((slot) => Number(slot.slice(3, 5)) === minute);
    onChange(same ?? open[0]);
  };

  const viewerTime = useMemo(() => {
    if (!flow.viewerDiffers || !value) return null;
    const instant = zonedWallClockToInstant(date, value, flow.rules.operatorTimezone);
    if (!instant) return null;
    try {
      return instant.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: flow.viewerZone });
    } catch {
      return null;
    }
  }, [flow.viewerDiffers, value, date, flow.rules.operatorTimezone, flow.viewerZone]);

  if (hours.length === 0) return <p className="text-center text-[14px] text-[var(--g2-ink-soft)]">No times are open on this day.</p>;
  const quarters = hour === null ? [] : slots.filter((slot) => Number(slot.slice(0, 2)) === hour);

  return (
    <div role="tabpanel" aria-label={`${label} time`}>
      <div
        role="radiogroup"
        aria-label={`${label} hour`}
        className="mx-auto flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-[24px] bg-white/35 p-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.7)]"
      >
        {hours.map((h) => {
          const open = openIn(h).length > 0;
          const on = h === hour;
          return (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!open}
              onClick={() => pickHour(h)}
              className={cn(
                'h-11 w-[68px] rounded-[18px] text-[14px] font-semibold tabular-nums transition-[background-color,color,box-shadow] duration-200 disabled:cursor-not-allowed disabled:opacity-35 sm:w-[78px] sm:text-[15px]',
                on ? 'g2-cta' : 'text-[var(--g2-ink)] enabled:hover:bg-white/80',
                FOCUS,
              )}
            >
              {formatClockLabel(`${pad(h)}:00`).replace(':00', '')}
            </button>
          );
        })}
      </div>

      {quarters.length > 1 ? (
        <>
          <div role="radiogroup" aria-label={`${label} minutes`} className="mx-auto mt-2.5 grid w-full max-w-[340px] grid-cols-4 gap-1 rounded-[20px] bg-white/35 p-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.7)]">
            {quarters.map((slot) => {
              const on = slot === value;
              return (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!isOpen(slot)}
                  onClick={() => onChange(slot)}
                  className={cn(
                    'h-10 rounded-[15px] text-[14px] font-semibold tabular-nums transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-35',
                    on ? 'bg-white text-[var(--g2-accent-ink)] shadow-[0_4px_12px_-8px_var(--g2-accent)]' : 'text-[var(--g2-ink)] enabled:hover:bg-white/60',
                    FOCUS,
                  )}
                >
                  :{slot.slice(3, 5)}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {viewerTime ? <p className="mt-3.5 text-center text-[12.5px] text-[var(--g2-ink-soft)]">{viewerTime} where you are</p> : null}
    </div>
  );
}

/* ── the calendar ──────────────────────────────────────────────────────── */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A month as whole weeks, Monday first, with the neighbouring months' days filled in. */
function monthWeeks(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const last = new Date(year, month + 1, 0);
  const weeks: string[][] = [];
  for (let d = new Date(start); d <= last || weeks.length === 0; ) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(localDateToIso(d));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

type Drag = { anchor: string; current: string; moved: boolean };

/**
 * Drag from the pickup day to the return day, or tap one then the other —
 * site-v2's interaction (`site-v2/book/trip-calendar.tsx`), in glass: the
 * trip is one continuous accent band, its two ends solid discs.
 */
function GlassCalendar({ flow, onPicked, notice }: { flow: BookingFlow; onPicked: (end: TripEnd) => void; notice: string | null }) {
  const pickup = dateOf(flow.trip.pickupDate);
  const [view, setView] = useState({ year: pickup.getFullYear(), month: pickup.getMonth() });
  const [drag, setDrag] = useState<Drag | null>(null);
  /** A pickup tapped on its own, waiting for its return. */
  const [pending, setPending] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const today = new Date();
  const canGoBack = view.year > today.getFullYear() || (view.year === today.getFullYear() && view.month > today.getMonth());
  const shift = (n: number) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + n, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const isBlocked = (iso: string) => flow.isPickupDateDisabled(dateOf(iso));

  const [from, to] = useMemo(() => {
    if (drag) return drag.anchor <= drag.current ? [drag.anchor, drag.current] : [drag.current, drag.anchor];
    if (pending) return [pending, hover && hover > pending ? hover : pending];
    return [flow.trip.pickupDate, flow.trip.dropoffDate];
  }, [drag, pending, hover, flow.trip.pickupDate, flow.trip.dropoffDate]);

  const cellAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-iso]');
    const iso = el?.dataset.iso ?? null;
    return iso && !isBlocked(iso) ? iso : null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const iso = cellAt(event.clientX, event.clientY);
    if (!iso) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ anchor: iso, current: iso, moved: false });
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const iso = cellAt(event.clientX, event.clientY);
    if (drag) {
      if (iso && iso !== drag.current) setDrag({ ...drag, current: iso, moved: drag.moved || iso !== drag.anchor });
    } else if (event.pointerType === 'mouse') {
      setHover(iso);
    }
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.moved) {
      flow.setTripRange(drag.anchor, drag.current);
      setPending(null);
      onPicked('pickup');
    } else if (pending && drag.anchor > pending) {
      flow.setTripRange(pending, drag.anchor);
      setPending(null);
      onPicked('return');
    } else {
      flow.startTripOn(drag.anchor);
      setPending(drag.anchor);
      onPicked('pickup');
    }
    setDrag(null);
  };
  /** Keyboard: Enter on a day does what a tap does. */
  const onKeyDay = (iso: string) => {
    if (isBlocked(iso)) return;
    if (pending && iso > pending) {
      flow.setTripRange(pending, iso);
      setPending(null);
      onPicked('return');
    } else {
      flow.startTripOn(iso);
      setPending(iso);
      onPicked('pickup');
    }
  };

  const todayIso = localDateToIso(today);
  const onToday = view.year === today.getFullYear() && view.month === today.getMonth();
  const hint = drag?.moved ? 'Let go on your return day' : pending ? 'Now tap your return day' : (notice ?? 'Tap your pickup day, or drag across your trip');
  const next = new Date(view.year, view.month + 1, 1);
  // Two months side by side from a laptop up, one on anything narrower.
  const months = [
    { year: view.year, month: view.month, wide: false },
    { year: next.getFullYear(), month: next.getMonth(), wide: true },
  ];

  return (
    <div className={cn(WELL, 'p-2 min-[380px]:p-3 sm:p-5')}>
      <div
        className="relative touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => setHover(null)}
      >
        {/* Month to month: over the calendar, at its top corners. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-between">
          <button type="button" aria-label="Previous month" disabled={!canGoBack} onClick={() => shift(-1)} onPointerDown={(e) => e.stopPropagation()} className={cn('pointer-events-auto grid size-10 place-items-center rounded-full bg-white/70 text-[var(--g2-ink)] hover:bg-white disabled:opacity-0', FOCUS)}>
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <span className="flex gap-1.5">
            <button
              type="button"
              disabled={onToday}
              onClick={() => setView({ year: today.getFullYear(), month: today.getMonth() })}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn('pointer-events-auto h-10 rounded-full bg-white/70 px-3.5 text-[13px] font-semibold text-[var(--g2-ink)] hover:bg-white disabled:hidden max-sm:hidden', FOCUS)}
            >
              Today
            </button>
            <button type="button" aria-label="Next month" onClick={() => shift(1)} onPointerDown={(e) => e.stopPropagation()} className={cn('pointer-events-auto grid size-10 place-items-center rounded-full bg-white/70 text-[var(--g2-ink)] hover:bg-white', FOCUS)}>
              <ChevronRight aria-hidden className="size-4" />
            </button>
          </span>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {months.map(({ year, month, wide }) => (
            <div key={`${year}-${month}`} className={cn(wide && 'max-lg:hidden')}>
              <p aria-live={wide ? undefined : 'polite'} className="flex h-10 items-center justify-center gap-2">
                <span className="text-[19px] font-semibold tracking-[-0.03em] text-[var(--g2-ink)] sm:text-[21px]">{MONTHS[month]}</span>
                <span className="text-[15px] font-medium text-[var(--g2-ink-soft)]">{year}</span>
              </p>
              <div className="mt-2 grid grid-cols-7 pb-1">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="py-1.5 text-center text-[12px] font-semibold text-[var(--g2-ink-soft)]">
                    {w}
                  </span>
                ))}
              </div>
              <div className="space-y-1">
                {monthWeeks(year, month).map((week) => (
                  <div key={week[0]} className="grid grid-cols-7">
                    {week.map((iso, c) => {
                      const d = dateOf(iso);
                      // Only the month's own days: with two months showing, a day appears once.
                      if (d.getMonth() !== month) return <span key={iso} aria-hidden />;
                      const blocked = isBlocked(iso);
                      const isFrom = iso === from;
                      const isTo = iso === to && from !== to;
                      const inTrip = iso >= from && iso <= to && from !== to;
                      const end = isFrom || isTo;
                      const firstOfMonth = d.getDate() === 1;
                      const lastOfMonth = d.getDate() === new Date(year, month + 1, 0).getDate();
                      return (
                        <div
                          key={iso}
                          data-iso={iso}
                          role="button"
                          tabIndex={blocked ? -1 : 0}
                          aria-label={`${prettyDate(iso)}${isFrom ? ', pickup' : isTo ? ', return' : ''}`}
                          aria-disabled={blocked || undefined}
                          aria-pressed={end || undefined}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onKeyDay(iso);
                            }
                          }}
                          className={cn(
                            'relative grid place-items-center py-0.5 outline-none',
                            // The band: continuous across the trip, rounded at its ends and at the week's and month's edges.
                            inTrip && 'bg-[color-mix(in_oklab,var(--g2-accent)_14%,rgb(255_255_255/0.5))]',
                            inTrip && (isFrom || c === 0 || firstOfMonth) && 'rounded-l-full',
                            inTrip && (isTo || c === 6 || lastOfMonth) && 'rounded-r-full',
                            blocked ? 'cursor-not-allowed' : 'cursor-pointer',
                            'focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-[var(--g2-accent)]/50',
                          )}
                        >
                          <span
                            className={cn(
                              'grid aspect-square w-full max-w-10 place-items-center rounded-full text-[14px] font-semibold tabular-nums transition-colors duration-150 sm:max-w-11 sm:text-[15px]',
                              end
                                ? 'g2-cta'
                                : blocked
                                  ? 'text-[var(--g2-ink-soft)]/35 line-through decoration-[1.5px]'
                                  : iso === todayIso
                                    ? 'bg-white text-[var(--g2-ink)] shadow-[inset_0_0_0_1.5px_rgb(13_12_29/0.18)]'
                                    : 'text-[var(--g2-ink)] hover:bg-white/70',
                            )}
                          >
                            {d.getDate()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p key={hint} className={cn('g2-msg-in mt-4 text-center text-[13.5px]', hint === notice ? 'font-semibold text-amber-700' : 'text-[var(--g2-ink-soft)]')}>
        {hint}
      </p>
    </div>
  );
}

/* ── the dock: the trip or the car's total, and the way on ─────────────── */

type PrimaryAction = { label: string; disabled: boolean; loading: boolean; onClick: () => void; icon: typeof ArrowRight };

function usePrimaryAction(flow: BookingFlow): PrimaryAction {
  const count = flow.cars.length;
  if (flow.step === 'trip') {
    return {
      label: !flow.tripValid ? 'Choose your dates' : flow.carsLoading ? 'Finding cars…' : count === 0 ? 'No cars free then' : `See ${count === 1 ? '1 car' : `${count} cars`}`,
      disabled: !flow.tripValid || flow.carsLoading || count === 0,
      loading: flow.carsLoading,
      onClick: () => flow.goTo('car'),
      icon: ArrowRight,
    };
  }
  return {
    label: flow.chosen ? 'Continue to checkout' : 'Choose a car',
    disabled: !flow.chosen,
    loading: false,
    onClick: flow.continueToCheckout,
    icon: Lock,
  };
}

function PrimaryButton({ primary, className }: { primary: PrimaryAction; className?: string }) {
  const Icon = primary.icon;
  return (
    <button
      type="button"
      disabled={primary.disabled}
      onClick={primary.onClick}
      className={cn(
        'g2-cta inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS,
        className,
      )}
    >
      {primary.loading ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
      {primary.label}
      {!primary.loading && !primary.disabled ? <Icon aria-hidden className="size-4" strokeWidth={2.25} /> : null}
    </button>
  );
}

/**
 * Frosted, pinned to the bottom of the pane at every width (sticky, so it
 * parks above the footer instead of covering it): what the trip comes to so
 * far — tap it for the full summary — and the way on.
 */
function Dock({ flow, primary }: { flow: BookingFlow; primary: PrimaryAction }) {
  const { formatCurrency } = useTenantBranding();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const total = flow.chosen?.quote.grandTotal ?? null;
  return (
    <>
      <div className="sticky bottom-3 z-20 mt-3">
        <div className="mx-auto flex max-w-[760px] items-center gap-2 rounded-full bg-white/80 p-1.5 pl-5 shadow-[0_14px_34px_-18px_rgb(13_12_29/0.55),inset_0_1px_0_#fff] backdrop-blur-xl">
          <button type="button" onClick={() => setSummaryOpen(true)} className={cn('min-w-0 flex-1 rounded-full py-1 text-left', FOCUS)}>
            <span className="block truncate text-[12.5px] text-[var(--g2-ink-soft)]">
              {total !== null ? `${flow.chosen?.fleet.name ?? 'Your car'}, ${flow.days} ${flow.days === 1 ? 'day' : 'days'}` : 'Nothing is charged yet'}
            </span>
            <span className="block truncate text-[15px] font-semibold text-[var(--g2-ink)] underline decoration-[rgb(13_12_29/0.2)] underline-offset-4">
              {total !== null ? formatCurrency(total) : 'Trip summary'}
            </span>
          </button>
          <PrimaryButton primary={primary} className="h-11 px-5 text-[14.5px] sm:h-12 sm:px-6 sm:text-[15px]" />
        </div>
      </div>
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        {/* No corner ×: it would sit on "Start over". Done, Escape or the scrim close it. */}
        <PvDialogContent variant="site" showCloseButton={false} className="max-h-[calc(100dvh-2rem)] gap-2 overflow-y-auto p-2 sm:max-w-md sm:p-2">
          <DialogTitle className="sr-only">Your trip</DialogTitle>
          <DialogDescription className="sr-only">The booking so far.</DialogDescription>
          <div className="g2-skin">
            <TripOverview flow={flow} onNavigate={() => setSummaryOpen(false)} />
          </div>
          <button
            type="button"
            onClick={() => setSummaryOpen(false)}
            className="h-12 w-full shrink-0 cursor-pointer rounded-full bg-pv-muted text-[15px] font-semibold text-pv-fg hover:bg-pv-tint"
          >
            Done
          </button>
        </PvDialogContent>
      </Dialog>
    </>
  );
}
