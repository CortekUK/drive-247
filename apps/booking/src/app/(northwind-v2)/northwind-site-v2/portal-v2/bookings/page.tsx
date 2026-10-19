'use client';

/**
 * Every rental the customer has, newest first — laid out like the operator
 * portal v2 rentals list: page header, filter bar, then one list table with a
 * tinted header row and text-only status (see `bookings/bookings-table.tsx`).
 *
 * The three filters work IN MEMORY over one fetch (see `useCustomerRentals`), so
 * switching is instant and the counts on the filter always match the rows under
 * it.
 */

import { useState } from 'react';
import { CalendarDays, CarFront } from 'lucide-react-nw';

import { BookingsTable, BookingsTableSkeleton } from '@nw/portal-v2/bookings/bookings-table';
import { FilterTabs } from '@nw/portal-v2/bookings/filter-tabs';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { useCustomerRentals, type RentalFilter } from '@nw/hooks/use-customer-rentals';

const FILTERS: ReadonlyArray<{ value: RentalFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'current', label: 'Current' },
  { value: 'past', label: 'Past' },
];

const EMPTY_COPY: Record<RentalFilter, { title: string; description: string }> = {
  all: {
    title: 'No bookings yet',
    description: 'When you book a car it will appear here, with your dates, pickup location and price.',
  },
  current: {
    title: 'Nothing on right now',
    description: 'You have no rentals in progress or coming up. Past bookings are under Past.',
  },
  past: {
    title: 'No past bookings',
    description: 'Once a rental finishes it moves here, so you can look up dates and prices later.',
  },
};

export default function PortalBookingsPage() {
  const [filter, setFilter] = useState<RentalFilter>('all');
  const { rentals, summary, isLoading, isError, error, refetch } = useCustomerRentals(filter);

  // Counts come from the full set, not the filtered view, so a filter always
  // states how many rows it holds before you press it.
  const counts: Record<RentalFilter, number> = {
    all: summary.total,
    current: summary.onRent + summary.upcoming,
    past: summary.past + summary.cancelled,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bookings"
        description="Every rental you have made with us, newest first. Open one to see its dates, pickup and price."
      />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs
            label="Filter bookings"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            counts={isLoading ? undefined : counts}
          />
          {!isLoading && !isError && rentals.length > 0 ? (
            <p className="hidden px-1 text-[13px] text-pv-muted-fg sm:block">
              {rentals.length} {rentals.length === 1 ? 'booking' : 'bookings'}
            </p>
          ) : null}
        </div>

        {isError ? (
          <LoadError
            title="We could not load your bookings"
            error={error}
            onRetry={() => {
              void refetch();
            }}
          />
        ) : isLoading ? (
          <BookingsTableSkeleton rows={4} />
        ) : rentals.length === 0 ? (
          <Panel>
            <EmptyState
              icon={filter === 'past' ? CalendarDays : CarFront}
              title={EMPTY_COPY[filter].title}
              description={EMPTY_COPY[filter].description}
              action={filter === 'past' ? undefined : { href: '/booking', label: 'Browse the fleet' }}
            />
          </Panel>
        ) : (
          <BookingsTable rentals={rentals} />
        )}
      </section>
    </div>
  );
}
