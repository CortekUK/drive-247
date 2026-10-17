'use client';

/**
 * One rental, as a row in the bookings list (customer portal v2 — forked from
 * components/portal/booking-card.tsx).
 *
 * The WHOLE card is the link, not a "View" button in the corner: on a phone the
 * card is the tap target and a 44px button inside a 96px row is a smaller,
 * harder target than the row itself. The chevron is decoration.
 */

import Link from 'next/link';
import { ChevronRight, MapPin } from 'lucide-react-nw';

import { VehiclePhoto } from '@nw/components/fleet/vehicle-photo';
import { formatDateRange, relativeDayLabel } from '@nw/components/portal/format';
import {
  PaymentStatusChip,
  RentalStatusChip,
} from '@nw/portal-v2/status-chip';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import type { CustomerRental } from '@nw/hooks/use-customer-rentals';
import { cn } from '@nw/lib/utils';

export function BookingCard({
  rental,
  className,
  /** Emphasised treatment for the one booking the overview leads with. */
  featured = false,
}: {
  rental: CustomerRental;
  className?: string;
  featured?: boolean;
}) {
  const { formatCurrency } = useTenantBranding();

  const name = rental.vehicle?.displayName ?? 'Vehicle';
  const dates = formatDateRange(rental.startDate, rental.endDate);

  // Only for bookings that have not happened yet — "3 days ago" next to a
  // completed rental is noise, and next to a cancelled one it is cruel.
  const countdown =
    rental.lifecycle === 'upcoming' || rental.lifecycle === 'pending'
      ? relativeDayLabel(rental.startDate)
      : rental.lifecycle === 'on_rent'
        ? relativeDayLabel(rental.endDate)
        : null;

  const countdownLabel =
    countdown === null
      ? null
      : rental.lifecycle === 'on_rent'
        ? `Due back ${countdown}`
        : `Starts ${countdown}`;

  const pickup = rental.deliveryAddress ?? rental.pickupLocation;

  return (
    <Link
      href={`/portal-v2/bookings/${rental.id}`}
      className={cn(
        'group flex gap-3.5 rounded-2xl border bg-pv-card p-3.5 transition-colors sm:gap-4',
        'hover:border-pv-primary/30 hover:bg-pv-row',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30',
        featured ? 'border-pv-primary/25' : 'border-pv-border',
        className,
      )}
    >
      <VehiclePhoto
        url={rental.vehicle?.imageUrl ?? null}
        alt=""
        className="aspect-auto size-20 shrink-0 rounded-xl sm:size-24"
        zoomOnGroupHover
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-pv-fg sm:text-[15px]">
              {name}
            </p>
            <p className="mt-0.5 truncate text-xs text-pv-muted-fg">
              {rental.reference}
            </p>
          </div>
          <ChevronRight
            aria-hidden
            strokeWidth={1.75}
            className="mt-0.5 size-4 shrink-0 text-pv-muted-fg transition-transform group-hover:translate-x-0.5"
          />
        </div>

        <p className="truncate text-sm text-pv-muted-fg">
          {dates}
          {rental.nights !== null ? (
            <span className="text-pv-muted-fg">
              {' · '}
              {rental.nights} day{rental.nights === 1 ? '' : 's'}
            </span>
          ) : null}
        </p>

        {pickup ? (
          <p className="flex items-start gap-1.5 text-xs text-pv-muted-fg">
            <MapPin aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-1">{pickup}</span>
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <RentalStatusChip lifecycle={rental.lifecycle} />
          <PaymentStatusChip state={rental.paymentState} />
          {countdownLabel ? (
            <span className="text-xs text-pv-muted-fg">{countdownLabel}</span>
          ) : null}
          <span className="ml-auto shrink-0 text-[14px] font-semibold tabular-nums text-pv-fg">
            {formatCurrency(rental.total)}
          </span>
        </div>
      </div>
    </Link>
  );
}
