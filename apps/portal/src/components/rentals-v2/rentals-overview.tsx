"use client";

import { useMemo } from "react";
import type { EnhancedRental, RentalStats } from "@/hooks/use-enhanced-rentals";
import { formatCurrency } from "@/lib/format-utils";
import { parseLocalDate } from "@/lib/date-utils";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { FeaturedDeck } from "@/components/shared/featured-deck-v2";

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

/** Statuses of rentals that never ran. */
const NEVER_RAN = new Set(["Cancelled", "Rejected"]);
/** Statuses of rentals whose car has not gone out, whatever the start date says. */
const NOT_PICKED_UP = new Set(["Cancelled", "Rejected", "Pending"]);

/**
 * `start_date` is a bare date ("2026-09-22"), which `new Date` would read as UTC
 * midnight and slip to the day before west of Greenwich, so it goes through
 * parseLocalDate. `created_at` is a timestamptz, a real instant.
 */
function dayOf(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDate(value) : new Date(value);
}

const DECK_ROUTES = ["/rentals", "/turo-bridge"] as const;

export function RentalsOverview({ stats, rentals, currencyCode, filtered, onOpenCalendar }: Props) {
  const metrics = useMemo<HeroMetric[]>(() => {
    const booked = rentals.filter((r) => r.created_at && !NEVER_RAN.has(r.computed_status));
    const pickedUp = rentals.filter((r) => r.start_date && !NOT_PICKED_UP.has(r.computed_status));
    return [
      {
        key: "booked-value",
        label: "Booked value",
        kind: "flow",
        description: "What new rentals were booked for, excluding cancelled and rejected ones. This is not money collected.",
        format: (v) => formatCurrency(v, currencyCode),
        events: booked.map((r) => ({ at: new Date(r.created_at as string), amount: Number(r.total_amount) || 0 })),
        secondary: {
          label: "Picked up",
          events: pickedUp.map((r) => ({ at: dayOf(r.start_date), amount: Number(r.total_amount) || 0 })),
        },
      },
      {
        key: "bookings",
        label: "New bookings",
        kind: "flow",
        description: "Rentals created, excluding cancelled and rejected ones.",
        format: (v) => v.toLocaleString(),
        events: booked.map((r) => ({ at: new Date(r.created_at as string), amount: 1 })),
        secondary: {
          label: "Picked up",
          events: pickedUp.map((r) => ({ at: dayOf(r.start_date), amount: 1 })),
        },
      },
    ];
  }, [rentals, currencyCode]);

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
