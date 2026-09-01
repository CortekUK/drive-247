'use client';

/**
 * Every rental the customer has, newest first.
 *
 * The three tabs filter IN MEMORY over one fetch (see `useCustomerRentals`), so
 * switching is instant and the counts on the tabs always match the rows under
 * them. A segmented control rather than the Radix Tabs primitive: there is one
 * list and three predicates, not three panels, and modelling it as tabpanels
 * would mean three copies of the same subtree in the accessibility tree.
 */

import { useState } from 'react';
import { CalendarDays, CarFront } from 'lucide-react';

import { BookingCard } from '@/components/portal/booking-card';
import {
  BookingListSkeleton,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
} from '@/components/portal/primitives';
import { useCustomerRentals, type RentalFilter } from '@/hooks/use-customer-rentals';
import { cn } from '@/lib/utils';

const FILTERS: ReadonlyArray<{ value: RentalFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'current', label: 'Current' },
  { value: 'past', label: 'Past' },
];

const EMPTY_COPY: Record<RentalFilter, { title: string; description: string }> = {
  all: {
    title: 'No bookings yet',
    description:
      'When you book a car it will appear here, with your dates, pickup location and price.',
  },
  current: {
    title: 'Nothing on right now',
    description:
      'You have no rentals in progress or coming up. Past bookings are under the Past tab.',
  },
  past: {
    title: 'No past bookings',
    description:
      'Once a rental finishes it moves here, so you can look up dates and prices later.',
  },
};

export default function PortalBookingsPage() {
  const [filter, setFilter] = useState<RentalFilter>('all');
  const { rentals, summary, isLoading, isError, error, refetch } =
    useCustomerRentals(filter);

  // Counts come from the full set, not the filtered view, so a tab always
  // states how many rows it holds before you press it.
  const counts: Record<RentalFilter, number> = {
    all: summary.total,
    current: summary.onRent + summary.upcoming,
    past: summary.past + summary.cancelled,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Bookings"
        description="Every rental you have made with us, newest first."
      />

      <div
        role="group"
        aria-label="Filter bookings"
        className="flex w-full gap-1 overflow-x-auto rounded-full border border-brand-border-soft bg-brand-card p-1"
      >
        {FILTERS.map((option) => {
          const active = option.value === filter;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(option.value)}
              className={cn(
                'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25',
                active
                  ? 'bg-brand-forest font-medium text-white'
                  : 'text-brand-text-soft hover:bg-brand-stone hover:text-brand-text',
              )}
            >
              {option.label}
              {!isLoading ? (
                <span
                  className={cn(
                    'tabular-nums',
                    active ? 'text-white/70' : 'text-brand-text-subtle',
                  )}
                >
                  {counts[option.value]}
                </span>
              ) : null}
            </button>
          );
        })}
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
        <BookingListSkeleton rows={3} />
      ) : rentals.length === 0 ? (
        <Panel>
          <EmptyState
            icon={filter === 'past' ? CalendarDays : CarFront}
            title={EMPTY_COPY[filter].title}
            description={EMPTY_COPY[filter].description}
            action={
              filter === 'past'
                ? undefined
                : { href: '/booking', label: 'Browse the fleet' }
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {rentals.map((rental) => (
            <BookingCard key={rental.id} rental={rental} />
          ))}
        </div>
      )}
    </div>
  );
}
