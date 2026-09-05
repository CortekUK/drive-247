'use client';

import { AlertTriangle, CarFront, SearchX, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { VehicleCard } from '@/components/cards/vehicle-card';
import { useTenant } from '@/contexts/TenantContext';
import { useVehicles } from '@/hooks/use-vehicles';
import {
  EMPTY_TRIP_INTENT,
  readTripIntentFromLocation,
  stripTripIntent,
  type TripIntent,
} from '@/lib/booking/trip-intent';
import { canSearchByRegistration } from '@/lib/domain';

import { ActiveFilterChips } from './active-filter-chips';
import { FleetFilterPanel } from './fleet-filter-panel';
import { FleetGridSkeleton, FleetRowSkeleton } from './fleet-skeletons';
import { FleetToolbar } from './fleet-toolbar';
import { TripIntentBanner } from './trip-intent-banner';
import { VehicleListRow } from './vehicle-list-row';
import { formatMoney, formatResultCount } from './format';
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  activeFilters,
  buildFleetFacets,
  countActiveFilters,
  filterVehicles,
  sortVehicles,
  type ActiveFilter,
  type FleetFilters,
  type FleetSort,
} from './fleet-filters';
import { toFleetVehicle, type FleetSeed, type FleetVehicle, type RatePeriod } from './fleet-vehicle';
import { useFleetView } from './use-fleet-view';

interface FleetBrowserProps {
  /**
   * Server-rendered first paint (see `fleet-seed.ts`). Used as the render
   * source until the client query lands, which is also why the server's HTML
   * and the browser's first pass are identical: both render this same prop.
   */
  seed?: FleetSeed | null;
}

const NO_VEHICLES: FleetVehicle[] = [];

export function FleetBrowser({ seed = null }: FleetBrowserProps) {
  const { tenant } = useTenant();
  const { vehicles, isLoading, isError, error, refetch } = useVehicles();

  const [filters, setFilters] = useState<FleetFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<FleetSort>(DEFAULT_SORT);
  const [period, setPeriod] = useState<RatePeriod>('day');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Desktop-only. Seeded to `true` on both the server and the first client
  // render so folding the rail can never become a hydration mismatch.
  const [railOpen, setRailOpen] = useState(true);
  const { view, setView } = useFleetView();

  /* ── the home page's addresses ──────────────────────────────────────────
   * `?pickup=` / `?dropoff=`, put there by the hero form and forwarded here by
   * /booking's redirect. Read AFTER mount, from `window.location`, for two
   * reasons: `useSearchParams()` would force a `<Suspense>` boundary around a
   * page whose whole point is a server-rendered first paint, and seeding the
   * state to `EMPTY_TRIP_INTENT` keeps the server HTML and the hydration pass
   * byte-identical. The only cost is that the very first painted frame carries
   * bare `/booking/<id>` hrefs; the intent is on them by the time anything can
   * be clicked.
   *
   * The intent is context, NOT a filter — see `TripIntentBanner` for why the
   * grid below is deliberately untouched by it.
   */
  const [tripIntent, setTripIntent] = useState<TripIntent>(EMPTY_TRIP_INTENT);

  useEffect(() => {
    setTripIntent(readTripIntentFromLocation());
  }, []);

  const clearTripIntent = useCallback(() => {
    setTripIntent(EMPTY_TRIP_INTENT);
    if (typeof window === 'undefined') return;
    // The params have to leave the address bar too: they are what a refresh,
    // a back-navigation or a shared link would replay. `replaceState` rather
    // than a router push so dismissing a banner does not add a history entry
    // the back button then has to walk through.
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, '', `${pathname}${stripTripIntent(search)}${hash}`);
  }, []);

  const live = useMemo(() => vehicles.map(toFleetVehicle), [vehicles]);

  // The seed is the render source only until the live query answers, and the
  // two are never merged: two lists disagreeing about which cars exist is a
  // worse failure than a beat of stale data.
  //
  // The switch is "live has rows", not "live has settled", on purpose. The hook
  // reports `data ?? []`, so a settled-but-empty result is indistinguishable
  // from one that has not started — and `enabled: !!tenant` means there IS a
  // render where the tenant has just resolved and the vehicle query has not yet
  // moved off idle. Keying on settlement would flash "No vehicles listed yet"
  // through that frame. The cost is the opposite, far rarer case: a fleet that
  // empties between the server render and hydration keeps showing the seed
  // until the next navigation.
  const source = live.length > 0 ? live : (seed?.vehicles ?? NO_VEHICLES);

  // `tenant` is null on the first client render (its query is still in flight),
  // so the seed's copy of these two is what keeps hydration byte-identical.
  const currencyCode = tenant?.currency_code ?? seed?.currencyCode ?? null;
  const distanceUnit = tenant?.distance_unit ?? seed?.distanceUnit ?? null;

  const facets = useMemo(() => buildFleetFacets(source, filters), [source, filters]);

  const results = useMemo(
    () => sortVehicles(filterVehicles(source, filters), sort),
    [source, filters, sort],
  );

  const chips = useMemo(
    () =>
      activeFilters(filters, facets.priceBounds, {
        category: (value) =>
          facets.categories.find((facet) => facet.value === value)?.label ?? value,
        price: (min, max) =>
          `${formatMoney(min, currencyCode)} – ${formatMoney(max, currencyCode)} / day`,
      }),
    [filters, facets, currencyCode],
  );

  const activeFilterCount = countActiveFilters(filters, facets.priceBounds);

  const clearAll = () => setFilters(EMPTY_FILTERS);
  const removeChip = (chip: ActiveFilter) => setFilters((current) => chip.remove(current));

  // Plates are searchable only where they are visible: a hidden field that is
  // still searchable is not hidden, since one matching result confirms a plate.
  const searchPlaceholder = canSearchByRegistration(tenant)
    ? 'Search brand, model, colour or reg…'
    : 'Search brand, model, or colour…';

  const showSkeleton = isLoading && source.length === 0;
  const showError = isError && source.length === 0;
  const fleetIsEmpty = !isLoading && !isError && source.length === 0;

  const panelProps = {
    facets,
    filters,
    onChange: setFilters,
    onClear: clearAll,
    activeCount: activeFilterCount,
    currencyCode,
  };

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-8 xl:gap-10">
      {/*
        The rail is a share of the row, not 264 fixed pixels, and it folds away
        entirely. `items-start` is deliberately absent: the aside has to stretch
        to the row's height or the `sticky` card inside it has no travel and
        never actually sticks.
      */}
      {railOpen ? (
        <aside className="hidden shrink-0 lg:block lg:w-[clamp(15rem,21vw,17.5rem)]">
          {/*
            Capped, not free-standing. A fleet with several long facet lists
            makes this panel nearly as tall as the results column, and a sticky
            box with 29px of travel is a sticky box that does not stick — it
            scrolls away with everything else. Bounding it to the viewport gives
            the filters their own scroll and keeps them in reach the whole way
            down the grid.
          */}
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain rounded-[18px] border border-brand-border-soft bg-white p-5">
            <FleetFilterPanel {...panelProps} onCollapse={() => setRailOpen(false)} />
          </div>
        </aside>
      ) : (
        <div className="hidden shrink-0 lg:block">
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="sticky top-24 inline-flex h-11 items-center gap-2 rounded-full border border-brand-border bg-brand-card px-4 text-sm font-medium text-brand-text transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25"
          >
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-forest px-1.5 text-xs font-semibold text-white tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/*
        A bottom sheet rather than a side drawer: on a phone the filter list is
        long and the "Show N" confirm has to stay pinned within thumb reach,
        which a full-height side panel cannot do without its own scroll trap.
      */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[88dvh] flex-col gap-0 rounded-t-[18px] border-brand-border-soft bg-brand-card p-0"
        >
          <SheetHeader className="shrink-0 border-b border-brand-border-soft px-5 py-4">
            <SheetTitle className="text-base text-brand-text">Filter the fleet</SheetTitle>
            <SheetDescription className="sr-only">
              Narrow the vehicle list by category, price, fuel, mileage or make.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <FleetFilterPanel {...panelProps} />
          </div>

          <div className="shrink-0 border-t border-brand-border-soft px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
            <Button
              variant="brand"
              size="lg"
              className="h-12 w-full"
              onClick={() => setFiltersOpen(false)}
            >
              Show {formatResultCount(results.length, source.length)}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1 space-y-5">
        <TripIntentBanner intent={tripIntent} onClear={clearTripIntent} />

        <FleetToolbar
          search={filters.search}
          onSearchChange={(value) => setFilters((current) => ({ ...current, search: value }))}
          searchPlaceholder={searchPlaceholder}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
          period={period}
          onPeriodChange={setPeriod}
          resultLabel={formatResultCount(results.length, source.length)}
          activeFilterCount={activeFilterCount}
          onOpenFilters={() => setFiltersOpen(true)}
        />

        <ActiveFilterChips chips={chips} onRemove={removeChip} onClear={clearAll} />

        {showSkeleton ? (
          view === 'list' ? (
            <div role="status" aria-label="Loading vehicles" className="flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, index) => (
                <FleetRowSkeleton key={index} />
              ))}
            </div>
          ) : (
            <FleetGridSkeleton />
          )
        ) : showError ? (
          <StatePanel
            icon={<AlertTriangle aria-hidden className="size-6 text-danger" />}
            title="We could not load the fleet"
            body={
              error?.message ??
              'Something went wrong reaching our vehicle list. Please try again.'
            }
            action={
              <Button variant="brand" onClick={() => void refetch()}>
                Try again
              </Button>
            }
          />
        ) : fleetIsEmpty ? (
          <StatePanel
            icon={<CarFront aria-hidden className="size-6 text-brand-text-subtle" />}
            title="No vehicles listed yet"
            body="This fleet has no cars published at the moment. New vehicles appear here as soon as they go on the road."
            action={
              <Button asChild variant="brand-outline">
                <Link href="/contact">Talk to us</Link>
              </Button>
            }
          />
        ) : results.length === 0 ? (
          <StatePanel
            icon={<SearchX aria-hidden className="size-6 text-brand-text-subtle" />}
            title="No vehicles match those filters"
            body={`All ${source.length} of our vehicles are still available — the current combination just rules them all out.`}
            action={
              <Button variant="brand" onClick={clearAll}>
                Clear all filters
              </Button>
            }
          />
        ) : view === 'list' ? (
          <div className="flex flex-col gap-3">
            {results.map((vehicle) => (
              <VehicleListRow
                key={vehicle.id}
                vehicle={vehicle}
                currencyCode={currencyCode}
                distanceUnit={distanceUnit}
                period={period}
                tripIntent={tripIntent}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                currencyCode={currencyCode}
                distanceUnit={distanceUnit}
                period={period}
                tripIntent={tripIntent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatePanel({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[18px] border border-dashed border-brand-border bg-white px-6 py-14 text-center">
      {icon}
      <h3 className="text-base font-semibold text-brand-text">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-brand-text-soft">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
