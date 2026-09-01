'use client';

/**
 * /portal/bookings/history — the rentals that are over.
 *
 * ── WHY THIS IS NOT A REDIRECT ──────────────────────────────────────────────
 * v1's file at this path is fifteen lines that `router.replace('/portal/bookings')`
 * on mount, left behind when the two lists were merged into one tabbed page. It
 * is a bookmark-preserving stub, not a feature — and reproducing it here would
 * mean shipping a route whose only behaviour is a client-side flash and a second
 * navigation.
 *
 * So the route keeps its promise instead: it is the Past tab, addressable. That
 * costs nothing — `useCustomerRentals('past')` is the same single fetch the
 * bookings page already makes, served from the same React Query cache under the
 * same key, so arriving here from /portal/bookings renders instantly with no
 * second round-trip. Anyone landing on an old v1 bookmark gets what the URL says
 * it is, and the link back to the full list is the first thing on the page.
 *
 * `past` is completed AND cancelled, matching the bookings page's own Past tab.
 * Splitting them would leave a customer looking for a booking they cancelled
 * with nowhere to find it.
 */

import Link from 'next/link';
import { ArrowLeft, CalendarDays } from 'lucide-react';

import { BookingCard } from '@/components/portal/booking-card';
import {
  BookingListSkeleton,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
} from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import { useCustomerRentals } from '@/hooks/use-customer-rentals';

export default function PortalBookingHistoryPage() {
  const { rentals, summary, isLoading, isError, error, refetch } =
    useCustomerRentals('past');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          asChild
          variant="brand-ghost"
          size="sm"
          className="h-11 self-start pl-2.5"
        >
          <Link href="/portal/bookings">
            <ArrowLeft className="size-4" aria-hidden />
            All bookings
          </Link>
        </Button>

        <PageHeader
          title="Booking history"
          description={
            isLoading
              ? 'Your finished and cancelled rentals.'
              : summary.past + summary.cancelled === 0
                ? 'Your finished and cancelled rentals will be kept here.'
                : `${summary.past} completed and ${summary.cancelled} cancelled, newest first.`
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
        <BookingListSkeleton rows={3} />
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
        <div className="flex flex-col gap-3">
          {rentals.map((rental) => (
            <BookingCard key={rental.id} rental={rental} />
          ))}
        </div>
      )}
    </div>
  );
}
