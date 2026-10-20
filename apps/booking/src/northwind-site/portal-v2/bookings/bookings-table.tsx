'use client';

/**
 * The customer's bookings, on the operator's v2 list table: the same kit the
 * Northwind Customers and Vehicles lists are built from
 * (shared/portal-v2/list-table.tsx), not a look-alike. So the card, the sticky
 * heading row of small uppercase labels, the row height and cell padding, the
 * hairlines, the purple hover tint and the "All N shown" line are the
 * operator's own.
 *
 * Columns, one line each (no cell stacks two lines, as in every operator list):
 *   Reference (the row's identifier, weighted, like "NWC 153N") · Vehicle (bold
 *   make, lighter model) · Dates · Days · Status · Payment · Total (money, the
 *   one column that reads right).
 * Status and payment are coloured TEXT in the operator palette (list-styles.ts).
 *
 * The whole row opens the booking (/portal/bookings/[id], the read-only booking
 * page), as an operator row opens its record; the reference is a real button so
 * the booking is reachable by keyboard. No chevron: no operator table has one.
 *
 * Shared by Bookings, Booking history and Home's recent bookings.
 */

import { useRouter } from 'next/navigation';

import {
  ListBody,
  ListCell,
  ListHead,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES, type V2ListTone } from '@portal-v2-shared/list-styles';
import type { CustomerRental, RentalLifecycle, RentalPaymentState } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';

import { formatBookingDates, formatNights } from './format';

const LIFECYCLE: Record<RentalLifecycle, { label: string; tone: V2ListTone }> = {
  on_rent: { label: 'On rent', tone: 'success' },
  upcoming: { label: 'Upcoming', tone: 'brand' },
  // "Awaiting confirmation" rather than "Pending": pending is the operator's
  // word, and it reads to a customer as though they still have something to do.
  pending: { label: 'Awaiting confirmation', tone: 'warning' },
  completed: { label: 'Completed', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

const PAYMENT: Record<RentalPaymentState, { label: string; tone: V2ListTone } | null> = {
  paid: { label: 'Paid', tone: 'success' },
  unpaid: { label: 'Payment due', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'brand' },
  // The column was never written. Saying nothing beats guessing.
  unknown: null,
};

/** "Toyota Corolla" as the operator Fleet table draws it: the make in the row's weight, the model lighter. */
function VehicleName({ vehicle }: { vehicle: CustomerRental['vehicle'] }) {
  if (vehicle?.make && vehicle.model) {
    return (
      <>
        {vehicle.make} <span className="font-normal text-v2-muted-fg">{vehicle.model}</span>
      </>
    );
  }
  return <>{vehicle?.displayName ?? 'Vehicle'}</>;
}

export function BookingsTable({
  rentals,
  resetKey = '',
  fillViewport = false,
}: {
  rentals: CustomerRental[];
  /** Changes when a search or filter changes the set, so the list starts from its top again. */
  resetKey?: string;
  /** The Bookings page fills the window, as the operator lists do; a short list on Home does not. */
  fillViewport?: boolean;
}) {
  const router = useRouter();
  const { formatCurrency } = useTenantBranding();
  const rows = useProgressiveRows(rentals, resetKey);
  const open = (id: string) => router.push(`/portal/bookings/${id}`);

  return (
    <ListTable rows={rows} fillViewport={fillViewport}>
      <ListTableHeader>
        <ListHead className="w-[12%]">Reference</ListHead>
        <ListHead className="w-[21%]">Vehicle</ListHead>
        <ListHead className="w-[22%]">Dates</ListHead>
        <ListHead className="w-[8%]">Days</ListHead>
        <ListHead className="w-[15%]">Status</ListHead>
        <ListHead className="w-[11%]">Payment</ListHead>
        <ListHead className="w-[11%] text-right">Total</ListHead>
      </ListTableHeader>
      <ListBody>
        {rows.visible.map((rental) => {
          const status = LIFECYCLE[rental.lifecycle];
          const payment = PAYMENT[rental.paymentState];
          const days = formatNights(rental.nights);
          return (
            <ListRow key={rental.id} onOpen={() => open(rental.id)}>
              <ListCell>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(rental.id);
                  }}
                  className={cn(V2_LIST_CLASSES.identifier, 'truncate text-left hover:underline')}
                >
                  {rental.reference}
                </button>
              </ListCell>
              <ListCell className={cn(V2_LIST_CLASSES.text, 'truncate')}>
                <VehicleName vehicle={rental.vehicle} />
              </ListCell>
              <ListCell className={cn(V2_LIST_CLASSES.text, 'truncate')}>
                {formatBookingDates(rental.startDate, rental.endDate)}
              </ListCell>
              <ListCell className={cn(V2_LIST_CLASSES.text, 'tabular-nums')}>{days ?? '—'}</ListCell>
              <ListCell>
                <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
              </ListCell>
              <ListCell>
                {payment ? <ListStatusText tone={payment.tone}>{payment.label}</ListStatusText> : null}
              </ListCell>
              <ListCell className={cn(V2_LIST_CLASSES.text, 'text-right tabular-nums')}>
                {formatCurrency(rental.total)}
              </ListCell>
            </ListRow>
          );
        })}
      </ListBody>
    </ListTable>
  );
}

/** The table while bookings load: the same kit, heading row and row height, with bars for the cells. */
export function BookingsTableSkeleton({ rows = 4 }: { rows?: number }) {
  const progressive = useProgressiveRows(Array.from({ length: rows }), 'skeleton');
  return (
    <div aria-hidden>
      <ListTable rows={{ ...progressive, hasMore: false }}>
        <ListTableHeader>
          <ListHead className="w-[12%]">Reference</ListHead>
          <ListHead className="w-[21%]">Vehicle</ListHead>
          <ListHead className="w-[22%]">Dates</ListHead>
          <ListHead className="w-[8%]">Days</ListHead>
          <ListHead className="w-[15%]">Status</ListHead>
          <ListHead className="w-[11%]">Payment</ListHead>
          <ListHead className="w-[11%] text-right">Total</ListHead>
        </ListTableHeader>
        <ListBody>
          {progressive.visible.map((_, index) => (
            <ListRow key={index}>
              {[16, 28, 32, 8, 20, 14, 14].map((width, cell) => (
                <ListCell key={cell} className={cell === 6 ? 'text-right' : undefined}>
                  <span
                    className="inline-block h-3 animate-pulse rounded-full bg-v2-muted"
                    style={{ width: `${width * 4}px`, maxWidth: '100%' }}
                  />
                </ListCell>
              ))}
            </ListRow>
          ))}
        </ListBody>
      </ListTable>
    </div>
  );
}
