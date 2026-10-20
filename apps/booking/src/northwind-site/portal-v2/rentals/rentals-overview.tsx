'use client';

/**
 * The Rentals hero row: the operator Rentals tab's row
 * (apps/portal/src/components/rentals-v2/rentals-overview.tsx) for a customer.
 * Its graph is the shared HeroChart with the shared Rentals metrics
 * (shared/portal-v2/rentals-metrics.ts): "Booked value" with "Picked up" as
 * the second line and the period before dotted, the same legend row, range
 * picker, strokes and empty state. Beside it, the operator's companion card,
 * Calendar View, which opens the calendar as it does there.
 *
 * EVERY NUMBER IS THE CUSTOMER'S OWN: the points are derived from the rentals
 * the page already loaded (`useCustomerRentals`, filtered by this customer and
 * tenant), with the operator's statuses, so nothing here can disagree with the
 * table below. It follows the search and filters, as the operator's does, and
 * says "Filtered" when they narrow it.
 *
 * ONE DIFFERENCE, the period it opens on: the last 12 months, where the
 * operator's opens on 30 days. An operator books every day; a customer rents a
 * few times a year, so 30 days is usually an empty window (the Northwind canary
 * customer's six rentals were all booked on Sep 18, which leaves the last 30
 * days at $0). Every period is still in the picker.
 */

import { useMemo } from 'react';

import { useTenant } from '@nw/contexts/TenantContext';
import type { CustomerRental } from '@nw/hooks/use-customer-rentals';
import { FEATURED_ACTION_CLASS, FeaturedCardFace, FeaturedCardShell } from '@portal-v2-shared/featured-card';
import { HERO_CHART_HEIGHT, HeroChart, HeroRow } from '@portal-v2-shared/hero-chart';
import { formatCurrency } from '@portal-v2-shared/money';
import { rentalsHeroMetrics } from '@portal-v2-shared/rentals-metrics';
import { cn } from '@nw/lib/utils';

import { customerRentalStatus } from './rentals-table';

export function RentalsOverview({
  rentals,
  filtered,
  isLoading,
  onOpenCalendar,
}: {
  /** The rentals the list is showing, search and filters applied. */
  rentals: readonly CustomerRental[];
  /** True when a filter or search narrows the list. */
  filtered: boolean;
  isLoading: boolean;
  onOpenCalendar: () => void;
}) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const metrics = useMemo(
    () =>
      rentalsHeroMetrics(
        rentals.map((r) => ({ createdAt: r.createdAt, start: r.startDate, status: customerRentalStatus(r), amount: r.total })),
        { format: (v) => formatCurrency(v, currencyCode), countLabel: 'New rentals' },
      ),
    [rentals, currencyCode],
  );

  return (
    <HeroRow
      chart={
        isLoading ? (
          <ChartLoading />
        ) : (
          <HeroChart metrics={metrics} defaultRange="12m" note={filtered ? 'Filtered' : undefined} />
        )
      }
      card={<CalendarCard onOpen={onOpenCalendar} />}
    />
  );
}

/**
 * The operator Rentals tab's companion card (featured deck: Calendar View),
 * drawn with the same shared shell and face: one card, so no dots or arrows.
 */
function CalendarCard({ onOpen }: { onOpen: () => void }) {
  return (
    <FeaturedCardShell className="lg:min-h-0" aria-label="Calendar View">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <button type="button" className={cn(FEATURED_ACTION_CLASS, 'pb-4')} onClick={onOpen}>
          <FeaturedCardFace title="Calendar View" subtitle="See your rentals on a timeline" />
        </button>
      </div>
    </FeaturedCardShell>
  );
}

/**
 * The graph's frame while the rentals load: the same label row and chart
 * height, blank where the numbers go, so nothing jumps when it lands. No
 * digits: a zero here would read as "nothing booked".
 */
function ChartLoading() {
  return (
    <section className="flex flex-col gap-3" aria-label="Booked value" aria-busy>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-v2-fg">Booked value</span>
          <span className="text-sm font-medium text-v2-muted-fg">Last 12 months</span>
        </div>
        <div className="flex min-h-[30px] items-center" aria-hidden>
          <span className="inline-block h-[30px] w-28 animate-pulse rounded-md bg-v2-muted" />
        </div>
      </div>
      <div className={cn(HERO_CHART_HEIGHT, 'w-full animate-pulse rounded-xl bg-v2-muted/60')} aria-hidden />
      <p className="sr-only">Loading your rentals.</p>
    </section>
  );
}
