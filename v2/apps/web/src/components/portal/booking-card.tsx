'use client';

/**
 * One rental, as a row in the bookings list and on the overview.
 *
 * The WHOLE card is the link, not a "View" button in the corner: on a phone the
 * card is the tap target and a 44px button inside a 96px row is a smaller,
 * harder target than the row itself. The chevron is decoration.
 */

import Link from 'next/link';
import { ChevronRight, MapPin } from 'lucide-react';

import { VehiclePhoto } from '@/components/fleet/vehicle-photo';
import { formatDateRange, relativeDayLabel } from '@/components/portal/format';
import {
  PaymentStatusChip,
  RentalStatusChip,
} from '@/components/portal/status-chip';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import type { CustomerRental } from '@/hooks/use-customer-rentals';
import { cn } from '@/lib/utils';

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
      href={`/portal/bookings/${rental.id}`}
      className={cn(
        'group flex gap-3.5 rounded-[14px] border bg-brand-card p-3.5 transition-all sm:gap-4',
        'hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25',
        featured ? 'border-brand-border' : 'border-brand-border-soft',
        className,
      )}
    >
      <VehiclePhoto
        url={rental.vehicle?.imageUrl ?? null}
        alt=""
        className="aspect-auto size-20 shrink-0 sm:size-24"
        zoomOnGroupHover
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-brand-text sm:text-base">
              {name}
            </p>
            <p className="mt-0.5 truncate text-xs text-brand-text-subtle">
              {rental.reference}
            </p>
          </div>
          <ChevronRight
            aria-hidden
            strokeWidth={1.75}
            className="mt-0.5 size-4 shrink-0 text-brand-text-subtle transition-transform group-hover:translate-x-0.5"
          />
        </div>

        <p className="truncate text-sm text-brand-text-soft">
          {dates}
          {rental.nights !== null ? (
            <span className="text-brand-text-subtle">
              {' · '}
              {rental.nights} day{rental.nights === 1 ? '' : 's'}
            </span>
          ) : null}
        </p>

        {pickup ? (
          <p className="flex items-start gap-1.5 text-xs text-brand-text-subtle">
            <MapPin aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-1">{pickup}</span>
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <RentalStatusChip lifecycle={rental.lifecycle} />
          <PaymentStatusChip state={rental.paymentState} />
          {countdownLabel ? (
            <span className="text-xs text-brand-text-subtle">{countdownLabel}</span>
          ) : null}
          <span className="ml-auto shrink-0 text-sm font-medium tabular-nums text-brand-text">
            {formatCurrency(rental.total)}
          </span>
        </div>
      </div>
    </Link>
  );
}
