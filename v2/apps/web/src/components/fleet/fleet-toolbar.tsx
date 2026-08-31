'use client';

import { LayoutGrid, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { FLEET_SORTS, isFleetSort, type FleetSort } from './fleet-filters';
import { RATE_PERIODS, RATE_PERIOD_TAB_LABEL, type RatePeriod } from './fleet-vehicle';
import type { FleetView } from './use-fleet-view';

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
 * Shared control chrome.
 *
 * `h-12` below `sm` and `h-10` above is the touch-target floor, not a style
 * preference — every control here is a primary affordance on a phone, and the
 * segmented toggles beside them only clear 44px once their own buttons do.
 *
 * `text-base sm:text-sm` matters more than it looks: iOS Safari zooms the whole
 * page in when a focused field's font-size is under 16px, and the page never
 * zooms back out. A 14px search box was therefore a horizontal-scroll bug on
 * every iPhone, not just a small font.
 */
const CONTROL =
  'h-12 rounded-full border-brand-border bg-brand-card text-base text-brand-text sm:h-10 sm:text-sm ' +
  'focus-visible:border-brand-forest focus-visible:ring-[3px] focus-visible:ring-brand-forest/25';

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
    <div className="space-y-3 sm:space-y-4">
      {/*
        Below `md` the search owns its own full-width row and the controls sit
        under it. Cramming all four onto one line at 360px is what forced the
        page to scroll sideways.
      */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative min-w-0 md:flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-brand-text-subtle"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search the fleet"
            className={cn(
              CONTROL,
              'w-full pl-10 pr-12 placeholder:text-brand-placeholder sm:pr-10',
              // The native clear affordance would sit under our own X button.
              '[&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {search !== '' && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              // `after:-inset-1.5` grows the hit box past the visible circle so
              // the target clears 44px on touch without a chunky-looking button.
              className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-brand-text-subtle transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-brand-stone hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30 sm:size-7 sm:after:hidden"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/*
          Order flips with width. Under `sm` the sort takes a line of its own
          (`w-full` forces the wrap) with Filters and the layout toggle above
          it; from `sm` the three sit inline in reading order.
        */}
        <div className="flex flex-wrap items-center gap-2 md:shrink-0">
          <button
            type="button"
            onClick={onOpenFilters}
            className="order-1 inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-brand-border bg-brand-card px-4 text-sm font-medium text-brand-text transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 sm:h-10 sm:flex-none lg:hidden"
          >
            <SlidersHorizontal className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-forest px-1.5 text-xs font-semibold text-white tabular-nums">
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
                CONTROL,
                'order-3 w-full min-w-0 px-4 data-[size=default]:h-12',
                'sm:order-2 sm:w-auto sm:min-w-[168px] sm:data-[size=default]:h-10',
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-brand-border-soft bg-brand-card text-brand-text">
              {FLEET_SORTS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="focus:bg-brand-stone focus:text-brand-text"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div
            role="group"
            aria-label="Layout"
            className="order-2 flex shrink-0 items-center gap-1 rounded-full border border-brand-border bg-brand-card p-0.5 sm:order-3 sm:p-1"
          >
            <ViewButton
              active={view === 'grid'}
              label="Grid view"
              onClick={() => onViewChange('grid')}
            >
              <LayoutGrid className="size-4" />
            </ViewButton>
            <ViewButton
              active={view === 'list'}
              label="List view"
              onClick={() => onViewChange('list')}
            >
              <Rows3 className="size-4" />
            </ViewButton>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p aria-live="polite" className="text-sm text-brand-text-soft">
          Showing <span className="font-semibold text-brand-text">{resultLabel}</span>
        </p>

        <div
          role="group"
          aria-label="Rate period"
          className="flex w-full items-center gap-1 rounded-full border border-brand-border-soft bg-brand-card p-0.5 sm:w-auto sm:p-1"
        >
          {RATE_PERIODS.map((value) => {
            const active = value === period;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onPeriodChange(value)}
                className={cn(
                  'inline-flex h-11 flex-1 items-center justify-center rounded-full px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30 sm:h-8 sm:flex-none',
                  active
                    ? 'bg-brand-text text-white'
                    : 'text-brand-text-subtle hover:text-brand-text',
                )}
              >
                {RATE_PERIOD_TAB_LABEL[value]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30 sm:size-8',
        active
          ? 'bg-brand-text text-white'
          : 'text-brand-text-subtle hover:bg-brand-stone hover:text-brand-text',
      )}
    >
      {children}
    </button>
  );
}
