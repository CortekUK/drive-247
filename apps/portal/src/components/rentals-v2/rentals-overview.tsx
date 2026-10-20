"use client";

import { useMemo } from "react";
import type { EnhancedRental, RentalStats } from "@/hooks/use-enhanced-rentals";
import { formatCurrency } from "@/lib/format-utils";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { FeaturedDeck } from "@/components/shared/featured-deck-v2";
import { rentalsHeroMetrics } from "../../../../../shared/portal-v2/rentals-metrics";

/**
 * The Rentals hero row: one simple graph, and the featured deck beside it.
 *
 * WHY THIS REPLACED THE MONTHLY BARS. The row used to show stacked monthly
 * columns by status, a legend, a separate booked-value curve and a five-line
 * tooltip. The team lead's brief for every hero tab (Rentals, Customers,
 * Vehicles) is ONE graph over ~75% of the row, "extremely simple, like
 * Stripe's", because complicated graphs never get read; and a featured card
 * beside it. Their second pass asked for one more line in the graph, not
 * flashy. So: booked value (or new bookings) over the chosen period, what was
 * picked up in the same period as a lighter second line, and the previous
 * period dotted behind. Status mix lives in the table and the filter panel,
 * where it can be acted on.
 *
 * EVERY NUMBER HERE IS REAL. Each point is derived from the rentals the page
 * already fetched (`useEnhancedRentals`, filtered by tenant_id), so nothing on
 * this row can say something the table below does not. The series math is in
 * lib/hero-series.ts, with hand-worked tests.
 *
 * WHAT COUNTS.
 *   - BOOKED: a rental counts on the day it was created. Cancelled and rejected
 *     rentals never ran, so they add neither a booking nor booked value.
 *     "Booked value" sums `total_amount`, what rentals were written for. It is
 *     NOT money collected, and it is never called revenue.
 *   - PICKED UP: a rental counts on its start date (the table's Pickup column),
 *     once that day has come, unless it was cancelled, rejected, or is still
 *     Pending (keys not handed over). A future start date is not history yet,
 *     so it counts on no day.
 *
 * These are the FILTERED rentals, as before: the row describes the list you are
 * looking at, and says "Filtered" when a filter or search narrows it.
 *
 * THE CARD is the featured deck (components/shared/featured-deck-v2.tsx):
 * Calendar View, Turo Sync, Ask Trax and platform announcements, each under its
 * own gate. Calendar View opens this page's calendar through `onOpenCalendar`;
 * the header's calendar button opens it too, so the timeline never depends on
 * which card happens to be showing.
 *
 * Single stable root, no fixed height: `rentals-overview-flip.tsx` measures this
 * face with a ResizeObserver.
 */

interface Props {
  stats: RentalStats | null;
  /** The full filtered set (`allRentals`), not a page of it. */
  rentals: EnhancedRental[];
  currencyCode: string;
  /** True when a filter or search narrows the list. */
  filtered: boolean;
  onOpenCalendar: () => void;
}

const DECK_ROUTES = ["/rentals", "/turo-bridge"] as const;

export function RentalsOverview({ stats, rentals, currencyCode, filtered, onOpenCalendar }: Props) {
  // The series math is shared with the customer portal's Rentals graph
  // (shared/portal-v2/rentals-metrics.ts), so the two cannot count differently.
  const metrics = useMemo<HeroMetric[]>(
    () =>
      rentalsHeroMetrics(
        rentals.map((r) => ({ createdAt: r.created_at, start: r.start_date, status: r.computed_status, amount: r.total_amount })),
        { format: (v) => formatCurrency(v, currencyCode), countLabel: "New bookings" },
      ),
    [rentals, currencyCode],
  );

  const handlers = useMemo(() => ({ openCalendar: onOpenCalendar }), [onOpenCalendar]);

  // v1 rendered nothing without stats (the query had not answered); keep that.
  if (!stats) return null;

  return (
    <HeroRow
      chart={<HeroChart metrics={metrics} anchor="rentals-chart" note={filtered ? "Filtered" : undefined} />}
      card={
        <FeaturedDeck
          tab="rentals"
          routePrefixes={DECK_ROUTES}
          handlers={handlers}
          anchor="rentals-featured"
          className="lg:min-h-0"
        />
      }
    />
  );
}
