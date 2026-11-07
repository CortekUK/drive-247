'use client';

/**
 * Template 2 ("Glass") — the home page's cars: a car picker on one sheet of
 * glass, under the hero.
 *
 *   the stage   one car, big: its own photo in a window, its name, what kind
 *               of car it is, fuel and mileage, and all three of its rates
 *               side by side — a day, a week, a month — so the price of a
 *               longer trip is right there, not hidden behind a switch.
 *               Choosing another car rolls each rate to the new one
 *               (`RollingPrice`) and the photo slides in. The arrows on the
 *               photo (or ← / →, or a swipe) step to the previous or next
 *               car in the list, looping, and keep its row in view
 *   the list    every car on a glass list, grouped by kind on a wide screen:
 *               a thumbnail, the name, the price a day. The chosen row is lit
 *
 * On a phone the list becomes a strip of cars to swipe, over the stage.
 *
 * The rates are the rows' own (`rateForPeriod`), never one multiplied into
 * another; a length the operator does not offer says so. Only what the fleet
 * records is shown: no seats, luggage or gearbox.
 *
 * Data: the server's fleet seed is the first paint, then the live
 * `useVehicles()` query takes over, as on the fleet page. With no cars the
 * section is not drawn.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Fuel, Gauge } from 'lucide-react-nw';

import {
  mileageForPeriod,
  RATE_PERIOD_ADVERB,
  rateForPeriod,
  toFleetVehicle,
  vehicleHref,
  type FleetSeed,
  type FleetVehicle,
  type RatePeriod,
} from '@nw/components/fleet/fleet-vehicle';
import { formatMileage, formatMoney } from '@nw/components/fleet/format';
import { useTenant } from '@nw/contexts/TenantContext';
import { useVehicles } from '@nw/hooks/use-vehicles';
import { cn } from '@nw/lib/utils';
import { t2CarHref, t2Href } from '@nw/template-2/links';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

const PERIODS: { value: RatePeriod; label: string }[] = [
  { value: 'day', label: 'A day' },
  { value: 'week', label: 'A week' },
  { value: 'month', label: 'A month' },
];

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const NO_VEHICLES: FleetVehicle[] = [];
const OTHER = 'Other cars';
/** How far a finger must travel sideways to count as a swipe. */
const SWIPE_PX = 48;

type Direction = 'next' | 'prev';

export function Template2Fleet({ seed }: { seed: FleetSeed | null }) {
  const { tenant } = useTenant();
  const { vehicles } = useVehicles();
  const live = useMemo(() => vehicles.map(toFleetVehicle), [vehicles]);
  const fleet = live.length > 0 ? live : (seed?.vehicles ?? NO_VEHICLES);
  const currencyCode = tenant?.currency_code ?? seed?.currencyCode ?? null;
  const distanceUnit = tenant?.distance_unit ?? seed?.distanceUnit ?? null;

  // The kinds, biggest group first; uncategorised cars last.
  const groups = useMemo(() => {
    const byKind = new Map<string, FleetVehicle[]>();
    for (const car of fleet) {
      const kind = car.categoryLabel ?? OTHER;
      byKind.set(kind, [...(byKind.get(kind) ?? []), car]);
    }
    return [...byKind].sort(([a, x], [b, y]) => (a === OTHER ? 1 : b === OTHER ? -1 : y.length - x.length));
  }, [fleet]);
  const ordered = useMemo(() => groups.flatMap(([, cars]) => cars), [groups]);

  const [chosenId, setChosenId] = useState<string | null>(null);
  /** How the car last changed: by an arrow (the list follows it) or a tap on its row. */
  const [move, setMove] = useState<{ direction: Direction | null; follow: boolean }>({ direction: null, follow: false });
  const at = Math.max(0, ordered.findIndex((other) => other.id === chosenId));

  const step = useCallback(
    (direction: Direction) => {
      if (ordered.length < 2) return;
      setMove({ direction, follow: true });
      setChosenId(ordered[(at + (direction === 'next' ? 1 : -1) + ordered.length) % ordered.length].id);
    },
    [ordered, at],
  );
  const choose = useCallback(
    (id: string) => {
      const to = ordered.findIndex((other) => other.id === id);
      if (to === at) return;
      setMove({ direction: to > at ? 'next' : 'prev', follow: false });
      setChosenId(id);
    },
    [ordered, at],
  );

  if (ordered.length === 0) return null;
  const car = ordered[at];

  // On a desktop the section is one screen: it starts under the floating nav
  // and the photo takes whatever height is left, so the nav, the heading, the
  // stage and the list are all in view at once.
  return (
    <section aria-labelledby="g2-fleet-title" className="relative lg:flex lg:h-svh lg:min-h-[680px] lg:flex-col">
      <div className="mx-auto w-full max-w-[1320px] px-3 pb-10 pt-4 sm:px-5 sm:pb-16 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:pb-5 lg:pt-[92px]">
        <div className="g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:rounded-[40px] lg:p-5">
          <header className="flex flex-col items-center gap-1 px-2 pb-5 pt-4 text-center sm:px-3 sm:pt-5 lg:pb-4 lg:pt-2">
            <div>
              <h2 id="g2-fleet-title" className="text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--g2-ink)] sm:text-[40px] lg:text-[36px]">
                Choose your car.
              </h2>
              <p className="mx-auto mt-2.5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[17px] lg:mt-1.5 lg:text-[16px]">
                Every car in the fleet, with its price by the day, the week and the month.
              </p>
            </div>
            <Link
              href={t2Href('/fleet')}
              className={cn('inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-1 text-[15px] font-semibold text-[var(--g2-accent-ink)] hover:underline lg:h-9', FOCUS)}
            >
              Compare all {fleet.length} cars
              <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
            </Link>
          </header>

          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)] lg:gap-4">
            <Stage
              car={car}
              position={at + 1}
              total={ordered.length}
              direction={move.direction}
              onStep={step}
              currencyCode={currencyCode}
              distanceUnit={distanceUnit}
            />
            <CarList groups={groups} chosen={car} follow={move.follow} onChoose={choose} currencyCode={currencyCode} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────── stage ─────────────────────────────── */

function Stage({
  car,
  position,
  total,
  direction,
  onStep,
  currencyCode,
  distanceUnit,
}: {
  car: FleetVehicle;
  position: number;
  total: number;
  direction: Direction | null;
  onStep: (direction: Direction) => void;
  currencyCode: string | null;
  distanceUnit: string | null;
}) {
  const daily = car.mileageIsUnlimited ? null : mileageForPeriod(car, 'day');
  const many = total > 1;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  return (
    <article
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label="The chosen car"
      className="g2-well g2-tray flex min-w-0 flex-col rounded-[30px] p-2 lg:min-h-0"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onStep('next');
        else if (event.key === 'ArrowLeft') onStep('prev');
      }}
    >
      {/* The operator's photo, in a window, with the arrows on its glass. */}
      <div
        className="relative aspect-[16/10] touch-pan-y overflow-hidden rounded-[24px] bg-[color-mix(in_oklab,var(--g2-accent)_12%,#d5dbe5)] sm:aspect-[16/9] lg:aspect-auto lg:min-h-[220px] lg:flex-1"
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse') swipe.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) onStep(dx < 0 ? 'next' : 'prev');
        }}
      >
        {car.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={car.id}
            src={car.photoUrl}
            alt=""
            decoding="async"
            draggable={false}
            data-dir={direction ?? undefined}
            className={cn('absolute inset-0 size-full select-none object-cover', direction ? 'g2-swap' : null)}
          />
        ) : null}

        {many ? (
          <>
            {/* .g2-glass-thin is position: relative, so the placing is on a wrapper. */}
            <span className="absolute bottom-3 left-3 z-10 sm:bottom-4 sm:left-4">
              <span className="g2-glass-thin block rounded-full px-3 py-1.5 text-[12.5px] font-semibold tabular-nums text-[var(--g2-ink)]">
                {position} of {total}
              </span>
            </span>
            <div className="pointer-events-none absolute inset-x-3 top-1/2 z-10 flex -translate-y-1/2 justify-between sm:inset-x-4">
              <StepButton side="prev" onClick={() => onStep('prev')} />
              <StepButton side="next" onClick={() => onStep('next')} />
            </div>
          </>
        ) : null}
      </div>

      <div key={car.id} className="g2-swap-fade flex flex-col gap-5 px-4 pb-5 pt-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:gap-4 lg:pb-4 lg:pt-4">
        <div className="min-w-0">
          <h3 aria-live="polite" className="truncate text-[26px] font-semibold leading-tight tracking-[-0.035em] text-[var(--g2-ink)] sm:text-[34px] lg:text-[30px]">
            {car.name}
          </h3>
          <ul className="mt-3 flex flex-wrap gap-1.5 text-[13px] font-medium text-[var(--g2-ink-soft)]">
            {[car.year, car.categoryLabel].some(Boolean) ? (
              <li className="rounded-full bg-white/70 px-3 py-1.5">{[car.year, car.categoryLabel].filter(Boolean).join(' ')}</li>
            ) : null}
            {car.fuelType ? (
              <li className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5">
                <Fuel aria-hidden className="size-3.5 text-[var(--g2-accent-ink)]" strokeWidth={2} />
                {car.fuelType}
              </li>
            ) : null}
            <li className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5">
              <Gauge aria-hidden className="size-3.5 text-[var(--g2-accent-ink)]" strokeWidth={2} />
              {daily == null ? 'Unlimited mileage' : `${formatMileage(daily, distanceUnit)} a day included`}
            </li>
          </ul>
        </div>

        <Link
          href={t2CarHref(vehicleHref(car))}
          className={cn('g2-cta inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-7 text-[15px] font-semibold', FOCUS)}
        >
          Book this car
          <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
        </Link>
      </div>

      {/* All three rates, on one strip, divided. */}
      <dl className="grid grid-cols-3 rounded-[24px] bg-white/60 shadow-[inset_0_1px_0_#fff]">
        {PERIODS.map(({ value, label }, index) => {
          const rate = rateForPeriod(car, value);
          const priced = rate.offered && rate.amount != null && rate.amount > 0;
          return (
            <div
              key={value}
              className={cn(
                'min-w-0 px-4 py-4 sm:px-6 sm:py-5 lg:py-3.5',
                index > 0 && 'relative before:absolute before:inset-y-5 before:left-0 before:w-px before:bg-[var(--g2-ink)]/10',
              )}
            >
              <dt className="text-[12.5px] font-medium text-[var(--g2-ink-soft)] sm:text-[13px]">{label}</dt>
              <dd className="mt-2">
                {priced ? (
                  <span className="text-[22px] font-semibold leading-none tracking-[-0.035em] text-[var(--g2-ink)] tabular-nums sm:text-[32px] lg:text-[28px]">
                    <RollingPrice text={formatMoney(rate.amount, currencyCode)} />
                  </span>
                ) : (
                  <span className="text-[13px] font-medium leading-tight text-[var(--g2-ink-soft)]">Not offered {RATE_PERIOD_ADVERB[value]}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}

function StepButton({ side, onClick }: { side: Direction; onClick: () => void }) {
  const Icon = side === 'next' ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'next' ? 'Show the next car in the list' : 'Show the previous car in the list'}
      className={cn(
        'g2-glass-thin pointer-events-auto grid size-11 place-items-center rounded-full text-[var(--g2-ink)] transition-transform duration-200 hover:scale-105 active:scale-95 sm:size-12',
        FOCUS,
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={2.25} />
    </button>
  );
}

/* ─────────────────────────────────── list ──────────────────────────────── */

function CarList({
  groups,
  chosen,
  follow,
  onChoose,
  currencyCode,
}: {
  groups: ReadonlyArray<[string, FleetVehicle[]]>;
  chosen: FleetVehicle;
  /** The car changed by an arrow: bring its row into view. */
  follow: boolean;
  onChoose: (id: string) => void;
  currencyCode: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());

  // Centre the chosen row in the list (down on a wide screen, across on a
  // phone), scrolling the list only, never the page.
  useEffect(() => {
    const list = scroller.current;
    const row = rows.current.get(chosen.id);
    if (!follow || !list || !row) return;
    const box = list.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    const smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    list.scrollBy({
      top: at.top - box.top - (box.height - at.height) / 2,
      left: at.left - box.left - (box.width - at.width) / 2,
      behavior: smooth,
    });
  }, [chosen.id, follow]);

  return (
    <div className="g2-well g2-tray relative min-w-0 rounded-[30px] p-2 max-lg:order-first lg:overflow-hidden">
      {/* A strip to swipe on a phone; a list grouped by kind on a wide screen,
          as tall as the stage and scrolling inside it. */}
      <div
        ref={scroller}
        role="group"
        aria-label="Cars"
        className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto [scrollbar-width:none] lg:absolute lg:inset-2 lg:block lg:snap-none lg:overflow-y-auto lg:overflow-x-hidden"
      >
        {groups.map(([kind, cars], index) => (
          <div key={kind} className={cn('contents lg:flex lg:flex-col lg:gap-1', index > 0 && 'lg:mt-3')}>
            {groups.length > 1 ? (
              <p className="hidden px-4 pb-1 pt-3 text-[13px] font-semibold text-[var(--g2-ink-soft)] lg:block">
                {kind} <span className="font-medium text-[var(--g2-ink)]/35">{cars.length}</span>
              </p>
            ) : null}
            {cars.map((car) => (
              <CarRow
                key={car.id}
                rowRef={(node) => {
                  if (node) rows.current.set(car.id, node);
                  else rows.current.delete(car.id);
                }}
                car={car}
                chosen={car.id === chosen.id}
                onChoose={() => onChoose(car.id)}
                currencyCode={currencyCode}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CarRow({
  rowRef,
  car,
  chosen,
  onChoose,
  currencyCode,
}: {
  rowRef: React.Ref<HTMLButtonElement>;
  car: FleetVehicle;
  chosen: boolean;
  onChoose: () => void;
  currencyCode: string | null;
}) {
  const daily = rateForPeriod(car, 'day');
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={cn(
        'flex w-[min(272px,calc(100vw-88px))] shrink-0 snap-start items-center gap-3.5 rounded-[22px] py-2 pl-2 pr-4 text-left transition-[background-color,box-shadow] duration-200 lg:w-full',
        chosen ? 'bg-white shadow-[0_10px_24px_-14px_rgb(13_12_29/0.5),inset_0_1px_0_#fff]' : 'hover:bg-white/55',
        FOCUS,
      )}
    >
      <span className="relative h-[52px] w-[68px] shrink-0 overflow-hidden rounded-[15px] bg-[color-mix(in_oklab,var(--g2-accent)_12%,#d5dbe5)] lg:w-[78px]">
        {car.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={car.photoUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : null}
        {chosen ? (
          <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklab,var(--g2-accent)_55%,transparent)] text-white">
            <Check aria-hidden className="size-5" strokeWidth={2.5} />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-5 tracking-[-0.015em] text-[var(--g2-ink)]">{car.name}</span>
        <span className="mt-0.5 block truncate text-[12.5px] leading-4 text-[var(--g2-ink-soft)]">{[car.year, car.fuelType].filter(Boolean).join(' ')}</span>
      </span>
      <span className="shrink-0 text-right">
        {daily.offered && daily.amount ? (
          <>
            <span className="block text-[15px] font-semibold leading-5 tabular-nums text-[var(--g2-ink)]">{formatMoney(daily.amount, currencyCode)}</span>
            <span className="mt-0.5 block text-[11.5px] leading-4 text-[var(--g2-ink-soft)]">a day</span>
          </>
        ) : (
          <span className="block text-[12px] text-[var(--g2-ink-soft)]">Weekly or monthly</span>
        )}
      </span>
    </button>
  );
}

/**
 * A price whose digits roll to the new value, like a departures board, when
 * another car is chosen. Each digit is a column of 0–9 slid into view;
 * columns are matched from the right, so units stay units. The text is whole
 * for a screen reader.
 */
export function RollingPrice({ text }: { text: string }) {
  const chars = [...text];
  return (
    <span className="g2-roll" aria-label={text}>
      {chars.map((char, at) => {
        const key = chars.length - at;
        if (!/\d/.test(char)) {
          return (
            <span key={`s${key}`} aria-hidden>
              {char}
            </span>
          );
        }
        return (
          <span key={`d${key}`} aria-hidden className="g2-roll-digit">
            <span style={{ transform: `translateY(${-Number(char)}em)` }}>
              {DIGITS.map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
