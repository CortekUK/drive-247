'use client';

/**
 * The Bookings hero row: the operator Vehicles tab's "Cars on rent" graph and
 * featured card (apps/portal/src/components/vehicles-v2/vehicles-overview.tsx),
 * for a customer: "Active bookings" against all of their bookings, and a
 * Payments card beside it. Both components are the operator's own, from
 * shared/portal-v2, so the line weights, the near-invisible baseline, the
 * dotted comparison, the rounded tooltip, the "Last 30 days" picker and the
 * flat-line empty state are the same ones.
 *
 * EVERY NUMBER IS THE PAGE'S OWN. The series is counted from the rentals
 * `useCustomerRentals` already loaded (no second query), so today's point is
 * always the "Current" filter's count beside it.
 *
 * WHAT "ACTIVE" MEANS on a day:
 *   - TODAY: every booking on rent, coming up or awaiting confirmation (the
 *     Current filter), read from each booking's lifecycle.
 *   - An EARLIER DAY: every booking that had been made by then (`created_at`,
 *     or its start date if earlier or unknown) and had not yet ended (its
 *     return date; an open-ended one has not). A finished booking therefore
 *     counts on the days it was live and no longer.
 *   - Cancelled bookings never count: when a booking was cancelled is not
 *     recorded, so counting it until some day would be invented.
 *   - Weeks and months (Last 3 / 12 months) are the daily average, as on the
 *     operator graph, with one decimal.
 *
 * "Of N bookings" after the headline is every booking, cancelled ones included,
 * the same N as the All filter.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { format, startOfDay } from 'date-fns';

import { HERO_CHART_HEIGHT, HeroChart, HeroRow, type HeroMetric } from '@portal-v2-shared/hero-chart';
import { FEATURED_ACTION_CLASS, FeaturedCardFace, FeaturedCardShell } from '@portal-v2-shared/featured-card';
import type { CustomerRental } from '@nw/hooks/use-customer-rentals';
import { parseDateOnly } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';

const dayKey = (day: Date) => format(day, 'yyyy-MM-dd');

const isCurrent = (rental: CustomerRental) =>
  rental.lifecycle === 'on_rent' || rental.lifecycle === 'upcoming' || rental.lifecycle === 'pending';

/** The day a booking starts to count: the day it was made, or its start if that is earlier. */
function firstDay(rental: CustomerRental): string {
  const made = rental.createdAt ? dayKey(new Date(rental.createdAt)) : null;
  return made && made < rental.startDate ? made : rental.startDate;
}

/** "Active bookings" as a function of the day. See WHAT "ACTIVE" MEANS above. */
export function activeBookingsCounter(rentals: readonly CustomerRental[], today: Date): (day: Date) => number {
  const todayKey = dayKey(today);
  const todayCount = rentals.filter(isCurrent).length;
  const spans = rentals
    .filter((rental) => rental.lifecycle !== 'cancelled')
    .map((rental) => [firstDay(rental), rental.endDate ?? '9999-12-31'] as const);
  return (day: Date) => {
    const key = dayKey(day);
    if (key > todayKey) return 0;
    if (key === todayKey) return todayCount;
    let count = 0;
    for (const [from, to] of spans) if (from <= key && key <= to) count++;
    return count;
  };
}

/** Whole days print whole; a week's or month's average prints one decimal, never "0.0". */
export function formatBookings(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  if (value > 0 && value < 0.05) return `< ${(0.1).toLocaleString()}`;
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function BookingsOverview({
  rentals,
  paymentsDue,
  isLoading,
}: {
  /** Every booking, not the filtered view: the graph does not move with the filter. */
  rentals: readonly CustomerRental[];
  /** Bookings still owing (`summary.awaitingPayment`), for the Payments card. */
  paymentsDue: number;
  isLoading: boolean;
}) {
  // "Today" is the day the rentals were read: their lifecycles were bucketed
  // against it, so the graph's today and the Current count agree.
  const today = useMemo(() => startOfDay(new Date()), [rentals]); // eslint-disable-line react-hooks/exhaustive-deps

  const metrics = useMemo<HeroMetric[]>(() => {
    const total = rentals.length;
    const firstDays = rentals.map(firstDay).sort();
    return [
      {
        key: 'active-bookings',
        label: 'Active bookings',
        kind: 'stock',
        description:
          'Bookings on rent, coming up or awaiting confirmation. An earlier day counts every booking made by then that had not yet ended; cancelled bookings are left out.',
        format: formatBookings,
        suffix: `of ${total.toLocaleString()} ${total === 1 ? 'booking' : 'bookings'}`,
        valueOn: activeBookingsCounter(rentals, today),
        historyStart: firstDays.length > 0 ? parseDateOnly(firstDays[0]) : undefined,
      },
    ];
  }, [rentals, today]);

  return (
    <HeroRow
      chart={isLoading ? <ChartLoading /> : <HeroChart metrics={metrics} today={today} />}
      card={<PaymentsCard due={isLoading ? null : paymentsDue} />}
    />
  );
}

/**
 * The narrow card beside the graph, as the operator's featured card draws its
 * Availability card: a title, one grey line, and the purple "Open →".
 */
function PaymentsCard({ due }: { due: number | null }) {
  const subtitle =
    due === null ? 'Your receipts and anything owing' : due === 0 ? 'Nothing due right now' : `${due} ${due === 1 ? 'payment' : 'payments'} due`;
  return (
    <FeaturedCardShell className="lg:min-h-0" aria-label="Payments">
      <Link href="/portal/payments" className={cn(FEATURED_ACTION_CLASS, 'pb-4')}>
        <FeaturedCardFace title="Payments" subtitle={subtitle} />
      </Link>
    </FeaturedCardShell>
  );
}

/**
 * The graph's frame while the bookings load: the same label row and chart
 * height, blank where the numbers go, so nothing jumps when it lands. No
 * digits: a zero here would read as "no bookings".
 */
function ChartLoading() {
  return (
    <section className="flex flex-col gap-3" aria-label="Active bookings" aria-busy>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-v2-fg">Active bookings today</span>
          <span className="text-sm font-medium text-v2-muted-fg">Last 30 days</span>
        </div>
        <div className="flex min-h-[30px] items-center" aria-hidden>
          <span className="inline-block h-[30px] w-28 animate-pulse rounded-md bg-v2-muted" />
        </div>
      </div>
      <div className={cn(HERO_CHART_HEIGHT, 'w-full animate-pulse rounded-xl bg-v2-muted/60')} aria-hidden />
      <p className="sr-only">Loading your bookings.</p>
    </section>
  );
}
