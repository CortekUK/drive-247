'use client';

import { LayoutGrid, Rows3, Search, SlidersHorizontal, X } from 'lucide-react-nw';
import type { ReactNode } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nw/components/ui/select';
import { FLEET_SORTS, isFleetSort, type FleetSort } from '@nw/components/fleet/fleet-filters';
import { RATE_PERIODS, RATE_PERIOD_TAB_LABEL, type RatePeriod } from '@nw/components/fleet/fleet-vehicle';
import type { FleetView } from '@nw/components/fleet/use-fleet-view';
import { cn } from '@nw/lib/utils';

interface FleetToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Placeholder changes when the tenant lets customers search plates. */
  searchPlaceholder: string;
  sort: FleetSort;
  onSortChange: (value: FleetSort) => void;
  view: FleetView;
  onViewChange: (value: FleetView) => void;
  period: RatePeriod;
  onPeriodChange: (value: RatePeriod) => void;
  resultLabel: string;
  activeFilterCount: number;
  onOpenFilters: () => void;
}

/**
 * The operator portal v2 list toolbar: a search pill, a sort select, a
 * segmented grid/list switch, then the result count and the rate-period tabs.
 *
 * Controls are 44px on phones and 40px from `sm`. The search is `text-base`
 * under `sm` because iOS Safari zooms the page into any focused field under
 * 16px and never zooms back out (see the v1 toolbar).
 */
const PILL =
  'h-11 rounded-full border border-pv-border bg-pv-card text-base text-pv-fg outline-none sm:h-10 sm:text-sm ' +
  'transition-colors duration-200 ease-out hover:border-pv-fg/20 focus-visible:border-pv-primary focus-visible:ring-3 focus-visible:ring-pv-primary/15 motion-reduce:transition-none';

export function FleetToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  sort,
  onSortChange,
  view,
  onViewChange,
  period,
  onPeriodChange,
  resultLabel,
  activeFilterCount,
  onOpenFilters,
}: FleetToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative min-w-0 md:flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-pv-muted-fg"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search the fleet"
            className={cn(
              PILL,
              'w-full pl-10 pr-11 placeholder:text-pv-muted-fg/80 [&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {search !== '' && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-pv-muted-fg transition-colors duration-200 ease-out after:absolute after:-inset-1.5 after:content-[''] hover:bg-pv-muted hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none sm:after:hidden"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 md:shrink-0">
          <button
            type="button"
            onClick={onOpenFilters}
            className={cn(PILL, 'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 px-3 text-sm font-medium sm:gap-2 sm:px-4 lg:hidden')}
          >
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-pv-primary px-1.5 text-xs font-semibold tabular-nums text-pv-primary-fg">
                {activeFilterCount}
              </span>
            )}
          </button>

          <Select
            value={sort}
            onValueChange={(value) => {
              if (isFleetSort(value)) onSortChange(value);
            }}
          >
            <SelectTrigger
              aria-label="Sort vehicles"
              className={cn(
                PILL,
                'min-w-0 flex-1 cursor-pointer gap-1 px-3 text-sm shadow-none sm:px-4 data-[size=default]:h-11 sm:data-[size=default]:h-10 md:w-[188px] md:flex-none',
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-pv-border bg-pv-card p-0 text-pv-fg shadow-lg">
              {FLEET_SORTS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="cursor-pointer rounded-lg py-2 text-[13px] focus:bg-pv-hover focus:text-pv-fg"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Segmented label="Layout">
            <SegmentButton active={view === 'grid'} label="Grid view" onClick={() => onViewChange('grid')} square>
              <LayoutGrid className="size-4" />
            </SegmentButton>
            <SegmentButton active={view === 'list'} label="List view" onClick={() => onViewChange('list')} square>
              <Rows3 className="size-4" />
            </SegmentButton>
          </Segmented>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="px-1 text-[13px] text-pv-muted-fg">
          Showing <span className="font-semibold text-pv-fg">{resultLabel}</span>
        </p>

        <Segmented label="Rate period" className="w-full sm:w-fit">
          {RATE_PERIODS.map((value) => (
            <SegmentButton
              key={value}
              active={value === period}
              label={RATE_PERIOD_TAB_LABEL[value]}
              onClick={() => onPeriodChange(value)}
            >
              {RATE_PERIOD_TAB_LABEL[value]}
            </SegmentButton>
          ))}
        </Segmented>
      </div>
    </div>
  );
}

/** The portal v2 filter-tab track: a muted pill with the active segment raised to white. */
function Segmented({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex h-11 shrink-0 items-center gap-1 rounded-full bg-pv-muted p-1 sm:h-10', className)}
    >
      {children}
    </div>
  );
}

function SegmentButton({
  active,
  label,
  onClick,
  square = false,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  square?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={square ? label : undefined}
      title={square ? label : undefined}
      className={cn(
        'inline-flex h-full cursor-pointer items-center justify-center rounded-full text-[13px] font-medium',
        'transition-colors duration-200 ease-in hover:ease-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50',
        square ? 'aspect-square' : 'flex-1 px-4 sm:flex-none',
        active ? 'bg-pv-card text-pv-fg' : 'text-pv-fg/60 hover:text-pv-fg',
      )}
    >
      {children}
    </button>
  );
}
