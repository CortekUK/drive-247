'use client';

/**
 * The customer's Rentals calendar: the operator Rentals tab's calendar view,
 * the shared TimelineBoard itself (shared/portal-v2/timeline), fed with this
 * customer's own rentals. It is what `ConnectedTimeline` is on the operator
 * side, the adapter between the data and the board, minus what a customer
 * cannot do (block dates, edit prices, switch to other customers' records).
 *
 * The same board, so the same controls: previous / Today / next, the Week,
 * 2 weeks and Month windows, a date range picker, search and a status filter.
 * Each rental is a line from its pickup to its return on its own row, past,
 * current and upcoming alike; today is marked; a line opens a card with the
 * rental's details and "Open rental", which goes to /portal/rentals/[id].
 *
 * The rentals are the ones the page already loaded (`useCustomerRentals`), so
 * there is no second query, and statuses are the operator's words for the same
 * rentals (`customerRentalStatus`), as in the table.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useTenant } from '@nw/contexts/TenantContext';
import type { CustomerRental } from '@nw/hooks/use-customer-rentals';
import { EMPTY_TIMELINE, shiftDay, tenantToday, type TimelineData } from '@portal-v2-shared/timeline/model';
import { TimelineBoard, type TimelineRange } from '@portal-v2-shared/timeline/timeline-board';

import { customerRentalStatus } from './rentals-table';

/** The customer's rentals as the board's records. Exported for its tests. */
export function rentalsTimelineData(rentals: readonly CustomerRental[], customerName: string): TimelineData {
  return {
    ...EMPTY_TIMELINE,
    bookings: rentals.map((rental) => ({
      id: rental.id,
      rentalId: rental.id,
      number: rental.reference,
      start: rental.startDate,
      end: rental.endDate,
      pickupTime: rental.pickupTime,
      returnTime: rental.returnTime,
      status: customerRentalStatus(rental),
      customer: { id: '', name: customerName },
      vehicle: {
        id: rental.vehicle?.id ?? '',
        // Null when the tenant hides plates: the board then names the car alone.
        reg: rental.vehicle?.registration ?? '',
        make: rental.vehicle?.make ?? '',
        model: rental.vehicle?.model ?? '',
        photoUrl: rental.vehicle?.imageUrl ?? null,
        daily: null,
        weekly: null,
        monthly: null,
      },
    })),
  };
}

export function CustomerRentalsCalendar({
  rentals,
  customerName,
  loading,
  error,
  onRetry,
  onExit,
}: {
  rentals: readonly CustomerRental[];
  customerName: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Back to the list (the operator board's "List view"). */
  onExit: () => void;
}) {
  const router = useRouter();
  const { tenant } = useTenant();
  const today = tenantToday(tenant?.timezone);
  // The operator calendar's opening window: two weeks, starting two days back.
  const [range, setRange] = useState<TimelineRange>(() => ({ start: shiftDay(today, -2), days: 14, period: 'fortnight' }));
  const data = useMemo(() => rentalsTimelineData(rentals, customerName), [rentals, customerName]);

  return (
    <TimelineBoard
      data={data}
      range={range}
      onRange={setRange}
      today={today}
      currency={tenant?.currency_code || 'USD'}
      timezone={tenant?.timezone}
      perspective="rental"
      fixedPerspective
      itemLabel="rental"
      heading="Rental calendar"
      loading={loading}
      error={error}
      onRetry={onRetry}
      onOpenRental={(id) => router.push(`/portal/rentals/${id}`)}
      // No "List view" here: the page header's button toggles back (owner, Oct 22 2026).
    />
  );
}
