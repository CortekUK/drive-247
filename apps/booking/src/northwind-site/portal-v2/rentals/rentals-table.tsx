'use client';

/**
 * The customer's rentals in the operator's Rentals table: the shared
 * component itself (shared/portal-v2/rentals-table.tsx), the one the operator
 * Rentals tab draws, not a look-alike. Same columns, order and wording, with
 * the operator's Customer column as Vehicle: Rental # · Vehicle · Pickup ·
 * Return · Status.
 *
 * Status is the operator's word for the same rental (`getRentalStatus`, shared
 * with the operator portal), so a customer and the desk read the same thing.
 *
 * Rows arrive 25 at a time as the box scrolls, and one quiet line under the
 * card says how much of the set is on screen, with "Show more" as the way to
 * reach row 26 without scrolling: the operator list's footer.
 *
 * The whole row opens the rental (/portal/rentals/[id]). Shared by Rentals,
 * Rental history and Home's recent rentals.
 */

import { useRouter } from 'next/navigation';

import { cn } from '@nw/lib/utils';
import type { CustomerRental } from '@nw/hooks/use-customer-rentals';
import { V2_BUTTON_GHOST_SM } from '@portal-v2-shared/button-styles';
import { useProgressiveRows, useViewportFillCap } from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES } from '@portal-v2-shared/list-styles';
import { getRentalStatus } from '@portal-v2-shared/rental-status';
import { RentalsTable, RentalsTableSkeleton, type RentalsTableRow } from '@portal-v2-shared/rentals-table';

/** The operator's status word for this rental: Active, Upcoming, Pending, Completed, Cancelled, Rejected. */
export function customerRentalStatus(rental: CustomerRental): string {
  return getRentalStatus(rental.startDate, rental.endDate, rental.statusRaw ?? '', { returnTime: rental.returnTime });
}

function toRow(rental: CustomerRental): RentalsTableRow {
  return {
    id: rental.id,
    reference: rental.reference,
    party: rental.vehicle?.displayName ?? 'Vehicle',
    start: rental.startDate,
    end: rental.endDate,
    status: customerRentalStatus(rental),
  };
}

export function CustomerRentalsTable({
  rentals,
  resetKey = '',
  fillViewport = false,
  footer = true,
}: {
  rentals: readonly CustomerRental[];
  /** Changes when a search or filter changes the set, so the list starts from its top again. */
  resetKey?: string;
  /** The Rentals page fills the window, as the operator list does; a short list on Home does not. */
  fillViewport?: boolean;
  /** The "All N rentals shown" line. Off for Home's few recent rentals, which are not the whole set. */
  footer?: boolean;
}) {
  const router = useRouter();
  const rows = useProgressiveRows(rentals, resetKey);
  const maxHeight = useViewportFillCap(rows.scrollRootRef, fillViewport);

  return (
    <div className="flex flex-col gap-3">
      <RentalsTable
        partyLabel="Vehicle"
        rows={rows.visible.map(toRow)}
        onOpen={(id) => router.push(`/portal/rentals/${id}`)}
        scrollRootRef={rows.scrollRootRef}
        sentinelRef={rows.sentinelRef}
        hasMore={rows.hasMore}
        maxHeight={maxHeight}
      />
      {footer ? (
      <div className={V2_LIST_CLASSES.footer}>
        <span>
          {rows.hasMore
            ? `Showing ${rows.visible.length} of ${rows.total} rentals`
            : `All ${rows.total} ${rows.total === 1 ? 'rental' : 'rentals'} shown`}
        </span>
        {rows.hasMore ? (
          <button type="button" onClick={rows.showMore} className={cn(V2_BUTTON_GHOST_SM, V2_LIST_CLASSES.showMore)}>
            Show more
          </button>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

export function CustomerRentalsTableSkeleton({ rows = 4 }: { rows?: number }) {
  return <RentalsTableSkeleton partyLabel="Vehicle" rows={rows} />;
}
