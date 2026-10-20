'use client';

/**
 * Every rental the customer has, newest first — laid out like the operator
 * portal v2 Fleet page: page header with its one labelled action at the top
 * right, the hero row (one graph and a featured card, see
 * `bookings/bookings-overview.tsx`), the filter, then one list table with a
 * tinted header row and text-only status (see `bookings/bookings-table.tsx`),
 * and a quiet line under it saying how much of the list is shown.
 *
 * The three filters work IN MEMORY over one fetch (see `useCustomerRentals`), so
 * switching is instant and the counts on the filter always match the rows under
 * it.
 */

import { useState } from 'react';
import { CalendarDays, CarFront, Plus } from 'lucide-react-nw';

import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2 } from '@portal-v2-shared/header';
import { V2_LIST_CLASSES } from '@portal-v2-shared/list-styles';
import { BookingsOverview } from '@nw/portal-v2/bookings/bookings-overview';
import { BookingsTable, BookingsTableSkeleton } from '@nw/portal-v2/bookings/bookings-table';
import { FilterTabs } from '@nw/portal-v2/bookings/filter-tabs';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { PRIMARY_CTA } from '@nw/portal-v2/shell';
import { QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import { useCustomerRentals, type RentalFilter } from '@nw/hooks/use-customer-rentals';
import { cn } from '@nw/lib/utils';

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

/** "All 6 bookings shown", "All 3 current bookings shown" — the operator list's footer line. */
function shownLine(filter: RentalFilter, count: number): string {
  const noun = count === 1 ? 'booking' : 'bookings';
  const kind = filter === 'all' ? '' : `${filter} `;
  return count === 1 ? `1 ${kind}${noun} shown` : `All ${count} ${kind}${noun} shown`;
}

export default function PortalBookingsPage() {
  const [filter, setFilter] = useState<RentalFilter>('all');
  const { rentals, summary, isLoading, isError, error, refetch } = useCustomerRentals(filter);
  // The graph reads every booking whatever the filter, from the same fetch.
  const { rentals: allRentals } = useCustomerRentals('all');

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
        actionClassName={HEADER_ACTIONS_V2}
        action={
          <QuickBookTrigger className={cn(PRIMARY_CTA, HEADER_PRIMARY_V2, 'w-full sm:w-auto')}>
            <Plus aria-hidden />
            Book a car
          </QuickBookTrigger>
        }
      />

      {isError ? null : (
        <BookingsOverview
          rentals={allRentals}
          paymentsDue={summary.awaitingPayment.length}
          isLoading={isLoading}
        />
      )}

      <section className="flex flex-col gap-3">
        <FilterTabs
          label="Filter bookings"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          counts={isLoading ? undefined : counts}
        />

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
          <>
            <BookingsTable rentals={rentals} />
            <p className={V2_LIST_CLASSES.footer}>{shownLine(filter, rentals.length)}</p>
          </>
        )}
      </section>
    </div>
  );
}
