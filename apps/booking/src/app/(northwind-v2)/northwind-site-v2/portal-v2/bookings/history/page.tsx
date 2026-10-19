'use client';

/**
 * /portal-v2/bookings/history — the rentals that are over.
 *
 * ── WHY THIS IS NOT A REDIRECT ──────────────────────────────────────────────
 * v1's file at this path is a stub that `router.replace`s to the bookings list,
 * left behind when the two lists were merged. Reproducing it here would ship a
 * route whose only behaviour is a client-side flash and a second navigation.
 *
 * So the route keeps its promise instead: it is the Past filter, addressable.
 * `useCustomerRentals('past')` is the same single fetch the bookings page makes,
 * served from the same React Query cache under the same key, so arriving here
 * from the list renders instantly with no second round-trip.
 *
 * `past` is completed AND cancelled, matching the bookings page's own Past
 * filter. Splitting them would leave a customer looking for a booking they
 * cancelled with nowhere to find it.
 */

import Link from 'next/link';
import { ArrowLeft, CalendarDays } from 'lucide-react-nw';

import { BookingsTable, BookingsTableSkeleton } from '@nw/portal-v2/bookings/bookings-table';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { useCustomerRentals } from '@nw/hooks/use-customer-rentals';

export default function PortalBookingHistoryPage() {
  const { rentals, summary, isLoading, isError, error, refetch } = useCustomerRentals('past');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/portal/bookings"
          className="-ml-2 inline-flex h-9 w-fit items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-pv-muted-fg transition-colors duration-200 ease-in hover:bg-pv-hover hover:text-pv-fg hover:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All bookings
        </Link>

        <PageHeader
          title="Booking history"
          description={
            isLoading || summary.past + summary.cancelled === 0
              ? 'Your finished and cancelled rentals, kept here so you can look them up later.'
              : `${[
                  summary.past > 0 ? `${summary.past} completed` : null,
                  summary.cancelled > 0 ? `${summary.cancelled} cancelled` : null,
                ]
                  .filter(Boolean)
                  .join(' and ')}, newest first.`
          }
        />
      </div>

      {isError ? (
        <LoadError
          title="We could not load your booking history"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isLoading ? (
        <BookingsTableSkeleton rows={3} />
      ) : rentals.length === 0 ? (
        <Panel>
          <EmptyState
            icon={CalendarDays}
            title="No past bookings"
            description="Once a rental finishes it moves here, so you can look up the dates, the car and what you paid long after the keys are back."
            action={{ href: '/portal/bookings', label: 'See current bookings' }}
          />
        </Panel>
      ) : (
        <BookingsTable rentals={rentals} />
      )}
    </div>
  );
}
