'use client';

/**
 * Every rental the customer has, newest first, laid out as an operator v2 list
 * page (Northwind Customers): the page header with its one labelled action at
 * the top right, then the list table, then one quiet line saying how much of
 * the list is shown.
 *
 * Search and filters live in the top bar, as on the operator portal: the page
 * lends the bar its field (`usePageSearch`), which filters this list as you
 * type, and its filter button opens the filter panel. With no overview row to
 * turn over, the panel opens in place above the table.
 *
 * No overview row. The two slots above the table stay empty on purpose: the
 * one candidate that cleared the bar, a "Next pickup" card, needs pickup time
 * and place on every booking, and today about half have neither (GitHub #31).
 *
 * The search and filters work IN MEMORY over the one fetch `useCustomerRentals`
 * already makes, so the bookings data and its query are unchanged.
 */

import { useMemo, useState } from 'react';
import { CarFront, Plus, SearchX } from 'lucide-react-nw';

import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2 } from '@portal-v2-shared/header';
import { V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { V2_LIST_CLASSES } from '@portal-v2-shared/list-styles';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';
import {
  BookingsFilterPanel,
  NO_BOOKING_FILTERS,
  applyBookingFilters,
  countActiveBookingFilters,
  type BookingFilters,
} from '@nw/portal-v2/bookings/bookings-filter-panel';
import { BookingsTable, BookingsTableSkeleton } from '@nw/portal-v2/bookings/bookings-table';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import { useCustomerRentals } from '@nw/hooks/use-customer-rentals';
import { cn } from '@nw/lib/utils';

export default function PortalBookingsPage() {
  const { rentals, isLoading, isError, error, refetch } = useCustomerRentals('all');
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<BookingFilters>(NO_BOOKING_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const shown = useMemo(() => applyBookingFilters(rentals, filters, term), [rentals, filters, term]);
  const activeCount = countActiveBookingFilters(filters);
  const narrowed = activeCount > 0 || term.trim() !== '';

  // The top bar's field and filter button, as an operator list page lends them.
  usePageSearch({
    placeholder: 'Search bookings…',
    value: term,
    onChange: setTerm,
    scopeLabel: 'Bookings',
    resultCount: isLoading ? undefined : shown.length,
    filters: { open: filtersOpen, onOpenChange: setFiltersOpen, activeCount },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bookings"
        description="Your rentals, upcoming and past"
        actionClassName={HEADER_ACTIONS_V2}
        action={
          <QuickBookTrigger className={cn(V2_BUTTON_PRIMARY, HEADER_PRIMARY_V2, 'flex-1 sm:flex-none')}>
            <Plus aria-hidden />
            Book a car
          </QuickBookTrigger>
        }
      />

      {filtersOpen ? (
        <BookingsFilterPanel filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
      ) : null}

      <section className="flex flex-col gap-3">
        {isError ? (
          <LoadError
            title="We could not load your bookings"
            error={error}
            onRetry={() => {
              void refetch();
            }}
          />
        ) : isLoading ? (
          <BookingsTableSkeleton rows={4} />
        ) : rentals.length === 0 ? (
          <Panel>
            <EmptyState
              icon={CarFront}
              title="No bookings yet"
              description="When you book a car it will appear here, with your dates, pickup location and price."
              action={{ href: '/booking', label: 'Browse the fleet' }}
            />
          </Panel>
        ) : shown.length === 0 ? (
          <Panel>
            <EmptyState
              icon={SearchX}
              title="No bookings match"
              description="Try a different search, or clear the filters to see every booking."
            />
          </Panel>
        ) : (
          <>
            <BookingsTable
              rentals={shown}
              resetKey={`${term}|${JSON.stringify(filters)}`}
              fillViewport
            />
            <p className={V2_LIST_CLASSES.footer}>
              {narrowed
                ? `${shown.length} of ${rentals.length} bookings shown`
                : `All ${rentals.length} ${rentals.length === 1 ? 'booking' : 'bookings'} shown`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
