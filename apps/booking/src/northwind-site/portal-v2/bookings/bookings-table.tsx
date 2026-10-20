'use client';

/**
 * The customer's bookings as a list table — the operator portal v2 rentals
 * list (components/rentals-v2/rentals-list-v2.tsx), customer-scaled: one card,
 * a tinted header row of small uppercase labels, then one row per booking with
 * the status as coloured TEXT, never a pill. Rows are taller than the
 * operator's (py-4 rather than py-3) and carry a photo, because a customer
 * finds their booking by the car, not by the reference.
 *
 * Shared by Home (recent bookings), Bookings and Booking history, so the three
 * can never format a date or colour a status differently.
 *
 * The WHOLE row is the link. On a phone the header row is dropped and each row
 * folds into photo · name and dates · total and status.
 *
 * The card, headings, row rhythm, two-tone vehicle name and status palette are
 * the operator Fleet table's (shared/portal-v2/list-styles.ts): a borderless
 * white card with a large radius and soft shadow, a plain heading row of small
 * uppercase grey labels, hairlines between rows, bold make with a lighter
 * model, and coloured status text.
 */

import Link from 'next/link';
import { CarFront, ChevronRight } from 'lucide-react-nw';

import { Skeleton } from '@nw/components/ui/skeleton';
import { PaymentStatusChip, RentalStatusChip } from '@nw/portal-v2/status-chip';
import { bookingCompletionState, type CustomerRental } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import { V2_LIST_CARD, V2_LIST_CLASSES } from '@portal-v2-shared/list-styles';

import { formatBookingDates, formatNights } from './format';

/* ──────────────────────────────── layout ───────────────────────────────── */

const COLUMNS =
  'md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.7fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_16px] md:items-center md:gap-4';

/** Status columns: the shared chips in their text-only form, at row size. */
const STATUS_TEXT = 'text-[14px] font-medium';

const HEAD = cn(V2_LIST_CLASSES.head, 'h-auto');

function HeaderRow() {
  return (
    <div
      aria-hidden
      className={cn('hidden h-10 border-b border-pv-border px-5', COLUMNS)}
    >
      <span className={HEAD}>Vehicle</span>
      <span className={HEAD}>Dates</span>
      <span className={HEAD}>Status</span>
      <span className={HEAD}>Payment</span>
      <span className={cn(HEAD, 'text-right')}>Total</span>
      <span />
    </div>
  );
}

/** A small photo of the car, or a car glyph on the tint when there is none. */
function Thumb({ url }: { url: string | null }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-pv-tint">
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <CarFront aria-hidden strokeWidth={1.75} className="size-5 text-pv-primary" />
      )}
    </span>
  );
}

/**
 * "Toyota Corolla" as the operator Fleet table draws it: the make in the row's
 * weight, the model lighter beside it. A car with only one of the two, or
 * neither (a plate-hiding tenant's bare plate), falls back to its display name.
 */
function VehicleName({ vehicle }: { vehicle: CustomerRental['vehicle'] }) {
  if (vehicle?.make && vehicle.model) {
    return (
      <>
        {vehicle.make} <span className="font-normal text-pv-muted-fg">{vehicle.model}</span>
      </>
    );
  }
  return <>{vehicle?.displayName ?? 'Vehicle'}</>;
}

/* ───────────────────────────────── rows ────────────────────────────────── */

function BookingRow({ rental }: { rental: CustomerRental }) {
  const { formatCurrency } = useTenantBranding();

  const dates = formatBookingDates(rental.startDate, rental.endDate);
  const nights = formatNights(rental.nights);
  // A paid booking still waiting on the customer's licence and selfie is the
  // one row on this list that needs a reply, so it carries the operator list's
  // flag treatment: a 2px rail and a faint wash, plus a line saying why.
  const needsDocuments = bookingCompletionState(rental) === 'awaiting_documents';

  return (
    <li>
      <Link
        href={`/portal/bookings/${rental.id}`}
        className={cn(
          'group flex items-center gap-3.5 px-4 py-3 sm:px-5',
          'transition-colors duration-200 ease-in hover:bg-pv-row-hover hover:ease-out motion-reduce:transition-none',
          'focus-visible:bg-pv-row-hover focus-visible:outline-none',
          COLUMNS,
          needsDocuments && 'border-l-2 border-l-pv-warning bg-pv-warning-light/40 pl-[14px] sm:pl-[18px]',
        )}
      >
        {/* Vehicle */}
        <span className="flex min-w-0 flex-1 items-center gap-3.5">
          <Thumb url={rental.vehicle?.imageUrl ?? null} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-pv-fg">
              <VehicleName vehicle={rental.vehicle} />
            </span>
            <span className="block truncate text-[12px] text-pv-muted-fg">
              {rental.reference}
            </span>
            {/* Phone only: the dates column is hidden, so they ride here. */}
            <span className="block truncate text-[12px] text-pv-muted-fg md:hidden">{dates}</span>
            {needsDocuments ? (
              <span className="mt-0.5 block truncate text-[12px] font-medium text-pv-warning">
                Upload your documents — the link is in your email
              </span>
            ) : null}
          </span>
        </span>

        {/* Dates */}
        <span className="hidden min-w-0 md:block">
          <span className="block truncate text-[14px] font-medium text-pv-fg">{dates}</span>
          {nights ? <span className="block text-[12px] text-pv-muted-fg">{nights}</span> : null}
        </span>

        {/* Status */}
        <span className="hidden min-w-0 truncate md:block">
          <RentalStatusChip plain lifecycle={rental.lifecycle} className={STATUS_TEXT} />
        </span>

        {/* Payment */}
        <span className="hidden min-w-0 truncate md:block">
          <PaymentStatusChip plain state={rental.paymentState} className={STATUS_TEXT} />
        </span>

        {/* Total — and on a phone, the status under it */}
        <span className="shrink-0 text-right">
          <span className="block text-[14px] font-semibold tabular-nums text-pv-fg">
            {formatCurrency(rental.total)}
          </span>
          <span className="block md:hidden">
            <RentalStatusChip plain lifecycle={rental.lifecycle} className="text-[12px] font-medium" />
          </span>
        </span>

        <ChevronRight
          aria-hidden
          className="hidden size-4 text-pv-muted-fg/50 transition-colors duration-200 ease-in group-hover:text-pv-fg group-hover:ease-out motion-reduce:transition-none md:block"
        />
      </Link>
    </li>
  );
}

/* ──────────────────────────────── table ────────────────────────────────── */

export function BookingsTable({ rentals, className }: { rentals: CustomerRental[]; className?: string }) {
  return (
    <section className={cn(V2_LIST_CARD, className)}>
      <HeaderRow />
      <ul className="divide-y divide-pv-border">
        {rentals.map((rental) => (
          <BookingRow key={rental.id} rental={rental} />
        ))}
      </ul>
    </section>
  );
}

/** Placeholder rows in the same frame, so the page does not jump on load. */
export function BookingsTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden>
      <section className={V2_LIST_CARD}>
        <HeaderRow />
        <ul className="divide-y divide-pv-border">
          {Array.from({ length: rows }, (_, index) => (
            <li key={index} className={cn('flex items-center gap-3.5 px-4 py-3 sm:px-5', COLUMNS)}>
              <span className="flex min-w-0 flex-1 items-center gap-3.5">
                <Skeleton className="size-10 shrink-0 rounded-xl bg-pv-tint" />
                <span className="flex flex-col gap-2">
                  <Skeleton className="h-3.5 w-32 bg-pv-tint" />
                  <Skeleton className="h-3 w-20 bg-pv-tint" />
                </span>
              </span>
              <Skeleton className="hidden h-3.5 w-36 bg-pv-tint md:block" />
              <Skeleton className="hidden h-3.5 w-20 bg-pv-tint md:block" />
              <Skeleton className="hidden h-3.5 w-16 bg-pv-tint md:block" />
              <Skeleton className="ml-auto h-3.5 w-16 bg-pv-tint" />
              <span className="hidden md:block" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
