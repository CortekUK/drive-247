'use client';

/**
 * Template 2 ("Glass") — Fleet and Pricing (/template-2/fleet), in the home
 * page's materials: the fixed photograph, centred headings, glass panes and
 * the wells inside them.
 *
 *   the prices  three tiles, by the day, the week and the month: the lowest
 *               price, what it comes to a day, and how much less a day than
 *               renting the same car daily. The tiles ARE the period switch —
 *               tap one and every price in the grid rolls to it
 *   the cars    a search, the kinds of car (with counts) and a sort, over a
 *               grid of the operator's cars; each card opens that car's
 *               booking, carrying the trip chosen on the home page
 *
 * All state is site-v2's `useFleetBrowser` (seed until live, facets, sort,
 * period, trip intent), so the two designs filter and sort identically; only
 * the markup is Template 2's. A period no car is offered for is left out.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, Fuel, Search, SearchX, X } from 'lucide-react-nw';

import { FLEET_SORTS, isFleetSort } from '@nw/components/fleet/fleet-filters';
import { formatMoney } from '@nw/components/fleet/format';
import {
  RATE_PERIOD_ADVERB,
  rateForPeriod,
  vehicleHref,
  type FleetSeed,
  type FleetVehicle,
  type RatePeriod,
} from '@nw/components/fleet/fleet-vehicle';
import { cn } from '@nw/lib/utils';
import { useFleetBrowser } from '@nw/site-v2/fleet/use-fleet-browser';
import { RollingPrice } from '@nw/template-2/fleet';
import { t2CarHref } from '@nw/template-2/links';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
/** A page of cars at a time; 12 fills two or three columns evenly. */
const PAGE_SIZE = 12;

const PERIOD: Record<RatePeriod, { title: string; unit: string; days: number }> = {
  day: { title: 'By the day', unit: 'a day', days: 1 },
  week: { title: 'By the week', unit: 'a week', days: 7 },
  month: { title: 'By the month', unit: 'a month', days: 30 },
};

export function Template2FleetPage({ seed }: { seed: FleetSeed | null }) {
  const fleet = useFleetBrowser(seed);
  const { period, setPeriod, currencyCode } = fleet;

  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [fleet.filters, fleet.sort]);
  const shown = fleet.results.slice(0, limit);
  const remaining = fleet.results.length - shown.length;

  // Each period's lowest price, what that is a day, and the best saving a day
  // over renting the same car daily: car by car, never cheapest against cheapest.
  const tiles = useMemo(
    () =>
      (['day', 'week', 'month'] as const)
        .map((key) => {
          const prices = fleet.source
            .map((car) => rateForPeriod(car, key))
            .filter((rate) => rate.offered && rate.amount != null && rate.amount > 0)
            .map((rate) => rate.amount as number);
          if (prices.length === 0) return null;
          const lowest = Math.min(...prices);
          const savings = fleet.source
            .map((car) => {
              const rate = rateForPeriod(car, key);
              return rate.offered && rate.amount && car.dailyRent ? 1 - rate.amount / (PERIOD[key].days * car.dailyRent) : 0;
            })
            .filter((saving) => saving > 0);
          return { key, lowest, perDay: lowest / PERIOD[key].days, best: savings.length > 0 ? Math.round(Math.max(...savings) * 100) : 0 };
        })
        .filter((tile): tile is NonNullable<typeof tile> => tile !== null),
    [fleet.source],
  );

  const categories = fleet.facets.categories;
  const chosenKinds = fleet.filters.categories;
  const setKind = (value: string | null) => fleet.setFilters((current) => ({ ...current, categories: value ? [value] : [] }));

  return (
    <>
      {/* The heading and the prices. */}
      <section aria-labelledby="g2-fleet-page-title" className="relative">
        <div className="mx-auto w-full max-w-[1320px] px-3 pb-3 pt-[84px] sm:px-5 sm:pt-[96px]">
          <div className="g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]">
            <header className="px-2 pb-6 pt-6 text-center sm:px-3 sm:pb-8 sm:pt-10">
              <h1
                id="g2-fleet-page-title"
                className="text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] sm:text-[56px] lg:text-[64px]"
              >
                Our cars and prices.
              </h1>
              <p className="mx-auto mt-3 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[18px]">
                Every car we rent, with its price. Choose one to pick your dates and see the total for your trip.
              </p>
            </header>

            {tiles.length > 0 ? (
              <div
                role="radiogroup"
                aria-label="Show prices"
                className={cn('g2-well g2-tray grid gap-1.5 rounded-[30px] p-1.5', tiles.length === 3 ? 'sm:grid-cols-3' : tiles.length === 2 && 'sm:grid-cols-2')}
              >
                {tiles.map(({ key, lowest, perDay, best }) => {
                  const on = period === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setPeriod(key)}
                      className={cn(
                        'group relative rounded-[24px] px-5 py-4 text-left transition-[background-color,box-shadow] duration-200 sm:px-6 sm:py-5',
                        on
                          ? 'bg-white shadow-[0_12px_28px_-16px_rgb(13_12_29/0.5),inset_0_1px_0_#fff,0_0_0_2px_color-mix(in_oklab,var(--g2-accent)_55%,transparent)]'
                          : 'hover:bg-white/55',
                        FOCUS,
                      )}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className={cn('text-[14px] font-semibold', on ? 'text-[var(--g2-accent-ink)]' : 'text-[var(--g2-ink-soft)]')}>{PERIOD[key].title}</span>
                        <span
                          aria-hidden
                          className={cn(
                            'grid size-5 place-items-center rounded-full transition-colors duration-200',
                            on ? 'bg-[var(--g2-accent)]' : 'bg-white/70 shadow-[inset_0_0_0_1.5px_rgb(13_12_29/0.15)]',
                          )}
                        >
                          {on ? <span className="size-2 rounded-full bg-white" /> : null}
                        </span>
                      </span>
                      <span className="mt-2 block text-[15px] text-[var(--g2-ink-soft)]">
                        from{' '}
                        <span className="text-[28px] font-semibold tracking-[-0.04em] text-[var(--g2-ink)] tabular-nums sm:text-[32px]">
                          {formatMoney(lowest, currencyCode)}
                        </span>{' '}
                        {PERIOD[key].unit}
                      </span>
                      <span className="mt-1 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--g2-ink-soft)]">
                        {key === 'day' ? (
                          'Any number of days'
                        ) : (
                          <>
                            <span>About {formatMoney(Math.round(perDay), currencyCode)} a day</span>
                            {best > 0 ? (
                              <span className="rounded-full bg-[color-mix(in_oklab,#16a34a_14%,#fff)] px-2 py-0.5 text-[12px] font-semibold text-[#15803d]">
                                Up to {best}% less a day
                              </span>
                            ) : null}
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* The cars. */}
      <section id="cars" aria-label="Our cars" className="relative scroll-mt-24">
        <div className="mx-auto w-full max-w-[1320px] px-3 pb-3 pt-3 sm:px-5">
          <div className="g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <label className="g2-well relative flex h-12 items-center rounded-full lg:w-[360px] lg:shrink-0">
                <span className="sr-only">Search cars</span>
                <Search aria-hidden className="pointer-events-none absolute left-4 size-4 text-[var(--g2-ink-soft)]" strokeWidth={2.25} />
                <input
                  type="search"
                  value={fleet.filters.search}
                  onChange={(event) => fleet.setSearch(event.target.value)}
                  placeholder={fleet.searchPlaceholder}
                  className="size-full rounded-full bg-transparent pl-11 pr-11 text-[16px] text-[var(--g2-ink)] outline-none placeholder:text-[var(--g2-ink-soft)]/80 sm:text-[15px] [&::-webkit-search-cancel-button]:hidden"
                />
                {fleet.filters.search !== '' ? (
                  <button
                    type="button"
                    onClick={() => fleet.setSearch('')}
                    aria-label="Clear search"
                    className={cn('absolute right-2 grid size-8 place-items-center rounded-full text-[var(--g2-ink-soft)] hover:bg-white/80', FOCUS)}
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </label>

              {categories.length > 1 ? (
                <div role="group" aria-label="Kind of car" className="g2-well g2-tray flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full p-1 [scrollbar-width:none] lg:max-w-fit lg:flex-1">
                  <KindPill on={chosenKinds.length === 0} onClick={() => setKind(null)} label="All" count={fleet.source.length} />
                  {categories.map((facet) => (
                    <KindPill
                      key={facet.value}
                      on={chosenKinds.length === 1 && chosenKinds[0] === facet.value}
                      onClick={() => setKind(facet.value)}
                      label={facet.label}
                      count={facet.count}
                    />
                  ))}
                </div>
              ) : (
                <span className="lg:flex-1" />
              )}


              <label className="g2-well relative flex h-12 shrink-0 items-center rounded-full lg:ml-auto">
                <span className="sr-only">Sort cars</span>
                <select
                  value={fleet.sort}
                  onChange={(event) => isFleetSort(event.target.value) && fleet.setSort(event.target.value)}
                  className="h-full appearance-none rounded-full bg-transparent pl-5 pr-11 text-[14.5px] font-medium text-[var(--g2-ink)] outline-none"
                >
                  {FLEET_SORTS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-4 size-4 text-[var(--g2-ink-soft)]" strokeWidth={2.25} />
              </label>
            </div>

            <p aria-live="polite" className="px-3 pb-3 pt-5 text-[14px] font-medium text-[var(--g2-ink-soft)]">
              {fleet.resultLabel}, priced {RATE_PERIOD_ADVERB[period]}
            </p>

            {fleet.showError ? (
              <Empty title="The cars could not be loaded." body="Check your connection and try again.">
                <button type="button" onClick={() => fleet.refetch()} className={cn('g2-cta inline-flex h-11 items-center rounded-full px-6 text-[14px] font-semibold', FOCUS)}>
                  Try again
                </button>
              </Empty>
            ) : fleet.fleetIsEmpty ? (
              <Empty title="No cars are listed yet." body="Check back soon, or get in touch and we will help you find one." />
            ) : fleet.results.length === 0 && !fleet.showSkeleton ? (
              <Empty title="No cars match." body="Try another search, or show every car again.">
                <button type="button" onClick={fleet.clearAll} className={cn('g2-cta inline-flex h-11 items-center rounded-full px-6 text-[14px] font-semibold', FOCUS)}>
                  Show every car
                </button>
              </Empty>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                {shown.map((car) => (
                  <li key={car.id}>
                    <CarCard car={car} period={period} currencyCode={currencyCode} href={t2CarHref(vehicleHref(car, fleet.tripIntent))} />
                  </li>
                ))}
              </ul>
            )}

            {remaining > 0 ? (
              <div className="flex justify-center pt-5">
                <button
                  type="button"
                  onClick={() => setLimit((value) => value + PAGE_SIZE)}
                  className={cn(
                    'inline-flex h-12 items-center rounded-full bg-white px-6 text-[15px] font-semibold text-[var(--g2-on-light)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.4),inset_0_1px_0_#fff]',
                    FOCUS,
                  )}
                >
                  Show {Math.min(remaining, PAGE_SIZE)} more
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

function KindPill({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-medium transition-[background-color,color,box-shadow] duration-200',
        on ? 'bg-white text-[var(--g2-ink)] shadow-[0_6px_14px_-10px_rgb(13_12_29/0.45),inset_0_1px_0_#fff]' : 'text-[var(--g2-ink-soft)] hover:bg-white/60 hover:text-[var(--g2-ink)]',
        FOCUS,
      )}
    >
      {label}
      <span className={cn('text-[12.5px] tabular-nums', on ? 'text-[var(--g2-accent-ink)]' : 'text-[var(--g2-ink-soft)]/70')}>{count}</span>
    </button>
  );
}

function CarCard({
  car,
  period,
  currencyCode,
  href,
}: {
  car: FleetVehicle;
  period: RatePeriod;
  currencyCode: string | null;
  href: string;
}) {
  const rate = rateForPeriod(car, period);
  const priced = rate.offered && rate.amount != null && rate.amount > 0;
  return (
    <Link
      href={href}
      className={cn(
        'g2-well g2-tray group flex h-full flex-col rounded-[28px] p-2 transition-[background-color,box-shadow] duration-200 hover:bg-white/80 hover:shadow-[0_18px_36px_-22px_rgb(13_12_29/0.55),inset_0_1px_0_#fff]',
        FOCUS,
      )}
    >
      <span className="block aspect-[16/10] overflow-hidden rounded-[22px] bg-white/60">
        {car.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={car.photoUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : null}
      </span>
      <span className="flex flex-1 flex-col px-3 pb-2 pt-4">
        <span className="block truncate text-[19px] font-semibold tracking-[-0.03em] text-[var(--g2-ink)]">{car.name}</span>
        <span className="mt-2 flex flex-wrap gap-1.5 text-[12.5px] font-medium text-[var(--g2-ink-soft)]">
          {[car.year, car.categoryLabel].some(Boolean) ? (
            <span className="rounded-full bg-white/70 px-2.5 py-1">{[car.year, car.categoryLabel].filter(Boolean).join(' ')}</span>
          ) : null}
          {car.fuelType ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1">
              <Fuel aria-hidden className="size-3 text-[var(--g2-accent-ink)]" strokeWidth={2} />
              {car.fuelType}
            </span>
          ) : null}
        </span>
        <span className="mt-auto flex items-end justify-between gap-3 pt-5">
          {priced ? (
            <span className="text-[14px] text-[var(--g2-ink-soft)]">
              <span className="text-[26px] font-semibold leading-none tracking-[-0.04em] text-[var(--g2-ink)] tabular-nums">
                <RollingPrice text={formatMoney(rate.amount, currencyCode)} />
              </span>{' '}
              {PERIOD[period].unit}
            </span>
          ) : (
            <span className="pb-1 text-[14px] font-medium text-[var(--g2-ink-soft)]">Not offered {RATE_PERIOD_ADVERB[period]}</span>
          )}
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-[var(--g2-accent-ink)] shadow-[inset_0_1px_0_#fff,0_4px_12px_-8px_rgb(13_12_29/0.4)] transition-colors duration-200 group-hover:bg-[var(--g2-accent)] group-hover:text-white"
          >
            <ArrowUpRight className="size-4" strokeWidth={2.25} />
          </span>
        </span>
      </span>
    </Link>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="g2-well g2-tray flex flex-col items-center rounded-[28px] px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-white/80 text-[var(--g2-accent-ink)]">
        <SearchX aria-hidden className="size-5" strokeWidth={2} />
      </span>
      <p className="mt-4 text-[18px] font-semibold tracking-[-0.02em] text-[var(--g2-ink)]">{title}</p>
      <p className="mt-1.5 max-w-[26rem] text-[14.5px] text-[var(--g2-ink-soft)]">{body}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
