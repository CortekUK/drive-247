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
import { StatusChip } from '@/components/portal/status-chip';
import {
  bookingCompletionState,
  useCustomerRentals,
  type CustomerRental,
  type RentalFilter,
} from '@/hooks/use-customer-rentals';
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
          {rentals.map((rental) =>
            bookingCompletionState(rental) === 'awaiting_documents' ? (
              <DocumentsNeededRow key={rental.id} rental={rental} />
            ) : (
              <BookingCard key={rental.id} rental={rental} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────── the one row that needs a reply ─────────────────── */

/**
 * A paid booking that is waiting on the customer's documents.
 *
 * This is the most urgent state a customer can be in on this page — the money
 * has left their account and nothing further happens until they upload — so it
 * is lifted ABOVE the card rather than added as one more chip in the card's
 * chip row, where it would sit third behind "Awaiting confirmation" and "Paid"
 * and read as just another label. The banded frame is doing the ranking; the
 * card underneath is untouched and still the whole tap target.
 *
 * No upload control here on purpose. The upload surface is the tokenised public
 * route, and this page has no token — it is reached from a session, not from
 * the emailed link. Inventing a button that cannot mint one would dead-end the
 * customer, so the honest move is to point at the email that carries the link.
 */
function DocumentsNeededRow({ rental }: { rental: CustomerRental }) {
  return (
    <div className="flex flex-col gap-2 rounded-[16px] border border-warning-med bg-brand-card p-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 pt-1">
        <StatusChip tone="warning">Action needed — upload documents</StatusChip>
        <span className="text-xs leading-relaxed text-brand-text-soft">
          We emailed you a secure link to upload your driving licence and a photo
          of yourself.
        </span>
      </div>
      {/*
        `border-transparent` rather than a new card variant: the frame above is
        already drawing the border, and tailwind-merge lets this override the
        card's own border colour without touching `BookingCard`.
      */}
      <BookingCard rental={rental} className="border-transparent" />
    </div>
  );
}
