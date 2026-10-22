'use client';

/**
 * /portal/rentals: the operator Rentals tab
 * (apps/portal/src/components/rentals-v2/rentals-list-v2.tsx), for a customer.
 * Taken piece for piece rather than redesigned:
 *
 *   - the header: "Rentals" and one plain line, in the operator's heading
 *     style. No "+ Book a car" here: booking lives in the rail (owner, Oct 21
 *     2026);
 *   - no overview card: "Calendar view" is a button in the header (owner,
 *     Oct 22 2026); the top bar's filter button opens the filter panel above
 *     the table;
 *   - the table: the shared Rentals table (shared/portal-v2/rentals-table.tsx),
 *     Customer becoming Vehicle; rows arrive as the box scrolls, with the
 *     "All N rentals shown" line under it;
 *   - the calendar: `?view=calendar`, opened from the header button, the
 *     shared rentals timeline with this customer's rentals.
 *
 * Search and filters live in the top bar, as on the operator page: the page
 * lends the bar its field (`usePageSearch`) and filter button. Both work IN
 * MEMORY over the one fetch `useCustomerRentals` already makes, and the graph
 * and the table read the same filtered set.
 */

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CarFront, SearchX } from 'lucide-react-nw';

import { V2_BUTTON_OUTLINE } from '@portal-v2-shared/button-styles';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';
import {
  NO_RENTAL_FILTERS,
  RentalsFilterPanel,
  applyRentalFilters,
  countActiveRentalFilters,
  type RentalFilters,
} from '@nw/portal-v2/rentals/rentals-filter-panel';
import { CustomerRentalsCalendar } from '@nw/portal-v2/rentals/rentals-calendar';
import { CustomerRentalsTable, CustomerRentalsTableSkeleton } from '@nw/portal-v2/rentals/rentals-table';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerRentals } from '@nw/hooks/use-customer-rentals';

export default function PortalRentalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams?.get('view') === 'calendar' ? 'calendar' : 'list';

  const { rentals, isLoading, isError, error, refetch } = useCustomerRentals('all');
  const { displayName } = useCustomer();
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<RentalFilters>(NO_RENTAL_FILTERS);

  // The filter panel is the BACK of the overview card, so its state lives here
  // where both the top bar's button and the card can see it. List view only:
  // the calendar has no overview card to turn over.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersFlipped = filtersOpen && view !== 'calendar';

  const shown = useMemo(() => applyRentalFilters(rentals, filters, term), [rentals, filters, term]);
  const activeCount = countActiveRentalFilters(filters);
  const narrowed = activeCount > 0 || term.trim() !== '';
  // No rentals at all, nothing asked for: the page is its header and the empty
  // state, with no search, filters or overview, as on the operator page.
  const noRentals = !isLoading && !isError && rentals.length === 0;

  // The top bar's field and filter button, as the operator Rentals page lends
  // them. None in the calendar, where there is no list to search.
  usePageSearch(
    view === 'calendar' || noRentals
      ? null
      : {
          placeholder: 'Search rentals…',
          value: term,
          onChange: setTerm,
          scopeLabel: 'Rentals',
          resultCount: isLoading ? undefined : shown.length,
          filters: { open: filtersFlipped, onOpenChange: setFiltersOpen, activeCount },
        },
  );

  const setView = (next: 'list' | 'calendar') => {
    // Leaving the list takes the panel's card with it; come back to the front.
    setFiltersOpen(false);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'list') params.delete('view');
    else params.set('view', next);
    const query = params.toString();
    router.push(query ? `/portal/rentals?${query}` : '/portal/rentals');
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rentals"
        description="Manage your rentals, from upcoming to completed."
        action={
          view === 'list' && !noRentals ? (
            <button type="button" onClick={() => setView('calendar')} className={V2_BUTTON_OUTLINE}>
              Calendar view
            </button>
          ) : null
        }
      />

      {view === 'calendar' ? (
        <CustomerRentalsCalendar
          rentals={rentals}
          customerName={displayName ?? 'You'}
          loading={isLoading}
          error={isError ? 'We couldn’t load your rentals. Nothing on your account has changed.' : null}
          onRetry={() => {
            void refetch();
          }}
          onExit={() => setView('list')}
        />
      ) : isError ? (
        <LoadError
          title="We could not load your rentals"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : noRentals ? (
        <Panel>
          <EmptyState
            icon={CarFront}
            title="No rentals yet"
            description="When you book a car it will appear here, with your dates, pickup location and price."
            action={{ href: '/booking', label: 'Browse the fleet' }}
          />
        </Panel>
      ) : (
        <>
          {/* The filter panel opens above the table from the top bar's button. */}
          {filtersFlipped ? (
            <RentalsFilterPanel filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
          ) : null}

          {isLoading ? (
            <CustomerRentalsTableSkeleton rows={4} />
          ) : shown.length === 0 ? (
            <Panel>
              <EmptyState
                icon={SearchX}
                title="No rentals found"
                description="No rentals match your current filters"
                action={{
                  label: 'Clear Filters',
                  onClick: () => {
                    setFilters(NO_RENTAL_FILTERS);
                    setTerm('');
                  },
                }}
              />
            </Panel>
          ) : (
            <CustomerRentalsTable rentals={shown} resetKey={`${term}|${JSON.stringify(filters)}`} fillViewport />
          )}
        </>
      )}
    </div>
  );
}
