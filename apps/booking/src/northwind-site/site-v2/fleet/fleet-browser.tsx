'use client';

import { AlertTriangle, CarFront, ChevronDown, SearchX, SlidersHorizontal } from 'lucide-react-nw';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@nw/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@nw/components/ui/dialog';
import type { FleetSeed } from '@nw/components/fleet/fleet-vehicle';
import { PvDialogContent } from '@nw/portal-v2/dialog';
import { CARD, EmptyState } from '@nw/site-v2/kit';
import { VehicleCard } from '@nw/site-v2/sections/vehicle-card';
import { cn } from '@nw/lib/utils';

import { ActiveFilterChips } from './active-filter-chips';
import { FleetFilterPanel } from './fleet-filter-panel';
import { FleetGridSkeleton, FleetListSkeleton } from './fleet-skeletons';
import { FleetToolbar } from './fleet-toolbar';
import { TripIntentBanner } from './trip-intent-banner';
import { useFleetBrowser } from './use-fleet-browser';

const PAGE_SIZE = 12;
import { VehicleListRow } from './vehicle-list-row';

interface FleetBrowserProps {
  /**
   * Server-rendered first paint (see `fleet-seed.ts`), the render source until
   * the client query lands — so server HTML and hydration match.
   */
  seed?: FleetSeed | null;
}

/**
 * v2 of `components/fleet/fleet-browser.tsx`: the operator portal v2 list
 * page shape — a calm bordered filter rail on the left (full height, foldable), a
 * toolbar, then cards or divided rows. On phones the rail becomes a v2 DIALOG
 * with the "Show N" confirm pinned at its foot. All state is `useFleetBrowser`.
 */
export function FleetBrowser({ seed = null }: FleetBrowserProps) {
  const fleet = useFleetBrowser(seed);

  // A page of cars at a time, so a big fleet does not turn the page into an
  // endless scroll before the footer. 12 fills three or four columns evenly.
  // A new search, filter or sort starts again from the first page.
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [fleet.filters, fleet.sort]);
  const shown = fleet.results.slice(0, limit);
  const remaining = fleet.results.length - shown.length;
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Desktop-only; seeded open on server and client so folding is never a hydration mismatch.
  const [railOpen, setRailOpen] = useState(true);

  const panelProps = {
    facets: fleet.facets,
    filters: fleet.filters,
    onChange: fleet.setFilters,
    onClear: fleet.clearAll,
    activeCount: fleet.activeFilterCount,
    currencyCode: fleet.currencyCode,
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-6">
      {railOpen ? (
        // The rail is as tall as its filters and scrolls with the page — no
        // second scrollbar inside it.
        <aside className="hidden shrink-0 lg:block lg:w-[260px]">
          <div className={cn(CARD, 'p-4')}>
            <FleetFilterPanel {...panelProps} onCollapse={() => setRailOpen(false)} />
          </div>
        </aside>
      ) : (
        <div className="hidden shrink-0 lg:block">
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="sticky top-24 inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-pv-border bg-pv-card px-4 text-sm font-medium text-pv-fg transition-colors duration-200 ease-out hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
          >
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters
            {fleet.activeFilterCount > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-pv-primary px-1.5 text-xs font-semibold tabular-nums text-pv-primary-fg">
                {fleet.activeFilterCount}
              </span>
            )}
          </button>
        </div>
      )}

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <PvDialogContent variant="site" className="max-h-[calc(100dvh-2rem)] gap-0 p-0 sm:max-w-md sm:p-0">
          <DialogHeader className="shrink-0 gap-1 px-6 pb-3 pr-14 pt-6 text-left">
            <DialogTitle className="text-[17px] font-semibold tracking-tight text-pv-fg">Filter the fleet</DialogTitle>
            <DialogDescription className="text-[13px] text-pv-muted-fg">
              Narrow the list by category, price, fuel, mileage or make.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-pv-border px-6 py-4">
            <FleetFilterPanel {...panelProps} hideHeading />
          </div>

          <div className="flex shrink-0 gap-2 border-t border-pv-border px-6 py-4">
            {fleet.activeFilterCount > 0 ? (
              <Button variant="brand-outline" className="h-11 px-5" onClick={fleet.clearAll}>
                Clear all
              </Button>
            ) : null}
            <Button variant="brand" className="h-11 flex-1" onClick={() => setFiltersOpen(false)}>
              Show {fleet.resultLabel}
            </Button>
          </div>
        </PvDialogContent>
      </Dialog>

      <div className="min-w-0 flex-1 space-y-4">
        <TripIntentBanner intent={fleet.tripIntent} onClear={fleet.clearTripIntent} />

        <FleetToolbar
          search={fleet.filters.search}
          onSearchChange={fleet.setSearch}
          searchPlaceholder={fleet.searchPlaceholder}
          sort={fleet.sort}
          onSortChange={fleet.setSort}
          view={fleet.view}
          onViewChange={fleet.setView}
          period={fleet.period}
          onPeriodChange={fleet.setPeriod}
          resultLabel={fleet.resultLabel}
          activeFilterCount={fleet.activeFilterCount}
          onOpenFilters={() => setFiltersOpen(true)}
        />

        <ActiveFilterChips chips={fleet.chips} onRemove={fleet.removeChip} onClear={fleet.clearAll} />

        {fleet.showSkeleton ? (
          fleet.view === 'list' ? <FleetListSkeleton /> : <FleetGridSkeleton />
        ) : fleet.showError ? (
          <EmptyState
            icon={<AlertTriangle aria-hidden strokeWidth={1.75} className="size-5 text-pv-danger" />}
            title="We could not load the fleet"
            description={fleet.error?.message ?? 'Something went wrong reaching our vehicle list. Please try again.'}
            action={
              <Button variant="brand" className="mt-1 h-10" onClick={() => void fleet.refetch()}>
                Try again
              </Button>
            }
          />
        ) : fleet.fleetIsEmpty ? (
          <EmptyState
            icon={<CarFront aria-hidden strokeWidth={1.75} className="size-5" />}
            title="No vehicles listed yet"
            description="We have no cars published at the moment. New vehicles appear here as soon as they go on the road."
            action={
              <Button asChild variant="brand-outline" className="mt-1 h-10">
                <Link href="/contact">Talk to us</Link>
              </Button>
            }
          />
        ) : fleet.results.length === 0 ? (
          <EmptyState
            className="pv2-enter"
            icon={<SearchX aria-hidden strokeWidth={1.75} className="size-5" />}
            title="No vehicles match those filters"
            description={`All ${fleet.source.length} of our vehicles are still available. The current combination just rules them all out.`}
            action={
              <Button variant="brand" className="mt-1 h-10" onClick={fleet.clearAll}>
                Clear all filters
              </Button>
            }
          />
        ) : fleet.view === 'list' ? (
          <div className={cn(CARD, 'divide-y divide-pv-border overflow-hidden')}>
            {shown.map((vehicle) => (
              <VehicleListRow
                key={vehicle.id}
                vehicle={vehicle}
                currencyCode={fleet.currencyCode}
                distanceUnit={fleet.distanceUnit}
                period={fleet.period}
                tripIntent={fleet.tripIntent}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 min-[1680px]:grid-cols-4 lg:gap-5">
            {shown.map((vehicle) => (
              <VehicleCard
                compact
                key={vehicle.id}
                vehicle={vehicle}
                currencyCode={fleet.currencyCode}
                distanceUnit={fleet.distanceUnit}
                period={fleet.period}
                tripIntent={fleet.tripIntent}
              />
            ))}
          </div>
        )}

        {!fleet.showSkeleton && !fleet.showError && remaining > 0 ? (
          <div className="flex flex-col items-center gap-3 pt-6">
            <p className="text-[14px] text-pv-muted-fg" aria-live="polite">
              Showing <span className="font-semibold text-pv-fg">{shown.length}</span> of{' '}
              <span className="font-semibold text-pv-fg">{fleet.results.length}</span> cars
            </p>
            <div aria-hidden className="h-1 w-48 overflow-hidden rounded-full bg-pv-tint">
              <div
                className="h-full rounded-full bg-pv-primary"
                style={{ width: `${(shown.length / fleet.results.length) * 100}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
              className="mt-1 inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-pv-border bg-pv-card px-6 text-[15px] font-semibold text-pv-fg transition-colors duration-200 ease-out hover:border-pv-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
            >
              Show {Math.min(PAGE_SIZE, remaining)} more {Math.min(PAGE_SIZE, remaining) === 1 ? 'car' : 'cars'}
              <ChevronDown aria-hidden className="size-4" strokeWidth={2.25} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
