"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { EnhancedRental, RentalStats } from "@/hooks/use-enhanced-rentals";
import { formatCurrency } from "@/lib/format-utils";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";

/**
 * The Rentals hero row: one simple graph, and the Calendar View card.
 *
 * WHY THIS REPLACED THE MONTHLY BARS. The row used to show stacked monthly
 * columns by status, a legend, a separate booked-value curve and a five-line
 * tooltip. The team lead's brief for every hero tab (Rentals, Customers,
 * Vehicles) is ONE graph over ~75% of the row, "extremely simple, like
 * Stripe's", because complicated graphs never get read; and a featured card
 * beside it. So this is one line: booked value (or new bookings) over the
 * chosen period, with the previous period dotted behind it. Status mix lives in
 * the table and the filter panel, where it can be acted on.
 *
 * EVERY NUMBER HERE IS REAL. Each point is derived from the rentals the page
 * already fetched (`useEnhancedRentals`, filtered by tenant_id), so nothing on
 * this row can say something the table below does not. The series math is in
 * lib/hero-series.ts, with hand-worked tests.
 *
 * WHAT COUNTS. A rental counts on the day it was created. Cancelled and rejected
 * rentals never ran, so they add neither a booking nor booked value.
 * "Booked value" sums `total_amount`, what rentals were written for. It is NOT
 * money collected, and it is never called revenue.
 *
 * These are the FILTERED rentals, as before: the row describes the list you are
 * looking at, and says "Filtered" when a filter or search narrows it.
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

export function RentalsOverview({ stats, rentals, currencyCode, filtered, onOpenCalendar }: Props) {
  const metrics = useMemo<HeroMetric[]>(() => {
    const booked = rentals.filter((r) => r.created_at && !NEVER_RAN.has(r.computed_status));
    return [
      {
        key: "booked-value",
        label: "Booked value",
        kind: "flow",
        description: "What new rentals were booked for, excluding cancelled and rejected ones. This is not money collected.",
        format: (v) => formatCurrency(v, currencyCode),
        events: booked.map((r) => ({ at: new Date(r.created_at as string), amount: Number(r.total_amount) || 0 })),
      },
      {
        key: "bookings",
        label: "New bookings",
        kind: "flow",
        description: "Rentals created, excluding cancelled and rejected ones.",
        format: (v) => v.toLocaleString(),
        events: booked.map((r) => ({ at: new Date(r.created_at as string), amount: 1 })),
      },
    ];
  }, [rentals, currencyCode]);

  // v1 rendered nothing without stats (the query had not answered); keep that.
  if (!stats) return null;

  return (
    <HeroRow
      chart={<HeroChart metrics={metrics} anchor="rentals-chart" note={filtered ? "Filtered" : undefined} />}
      card={
        <>
      <button
        type="button"
        onClick={onOpenCalendar}
        data-tour="rentals-calendar"
        className="group relative flex cursor-pointer flex-col justify-end overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 text-left text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/15"
      >
        <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-primary/15 blur-2xl transition-all duration-300 group-hover:bg-primary/25" />
        <span className="pointer-events-none absolute -bottom-10 -left-6 size-24 rounded-full bg-primary/10 blur-2xl" />
        {/* Faint fleet-timeline preview — fills the body, echoes the Gantt view.
            `playhead-scan` and `timeline-grow` are real keyframes: they live in
            styles/v2-theme.css, which the root layout puts on <body> for the
            same gated tenants that reach this screen. */}
        <div className="pointer-events-none absolute inset-x-5 top-[38%] -translate-y-1/2 opacity-80 transition-opacity duration-300 group-hover:opacity-100">
          <span
            className="absolute -top-2 bottom-[-0.5rem] w-px bg-primary/60 shadow-[0_0_8px_hsl(var(--primary)/0.5)]"
            style={{ animation: "playhead-scan 4s ease-in-out infinite" }}
          >
            <span className="absolute -left-[3px] -top-1 size-[7px] rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
          </span>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-7 rounded-full bg-primary/20" />
              <span
                className="h-1.5 flex-[3] origin-left rounded-full bg-primary/60"
                style={{ animation: "timeline-grow 3.6s ease-in-out infinite" }}
              />
              <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-12 rounded-full bg-primary/20" />
              <span
                className="h-1.5 flex-1 origin-left rounded-full bg-primary/45"
                style={{
                  animation: "timeline-grow 3.6s ease-in-out infinite",
                  animationDelay: "0.45s",
                }}
              />
              <span className="h-1.5 flex-[2] rounded-full bg-primary/15" />
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 flex-[2] origin-left rounded-full bg-primary/50"
                style={{
                  animation: "timeline-grow 3.6s ease-in-out infinite",
                  animationDelay: "0.9s",
                }}
              />
              <span className="h-1.5 flex-[3] rounded-full bg-primary/15" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-5 rounded-full bg-primary/20" />
              <span
                className="h-1.5 flex-[2] origin-left rounded-full bg-primary/40"
                style={{
                  animation: "timeline-grow 3.6s ease-in-out infinite",
                  animationDelay: "1.35s",
                }}
              />
              <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
            </div>
          </div>
        </div>
        <div className="relative">
          <div className="mt-3 text-lg font-bold tracking-tight">Calendar View</div>
          <div className="text-sm text-muted-foreground">See your fleet on a timeline</div>
        </div>
        <ArrowRight
          className="absolute right-4 top-4 size-5 text-primary"
          style={{ animation: "arrow-nudge 4s ease-in-out infinite" }}
        />
      </button>
        </>
      }
    />
  );
}
