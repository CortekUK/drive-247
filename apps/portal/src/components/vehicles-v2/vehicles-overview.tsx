"use client";

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { startOfDay } from "date-fns";
import { HERO_CHART_HEIGHT, HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { FeaturedDeck } from "@/components/shared/featured-deck-v2";
import { carsOnRentCounter, type OnRentRental } from "@/hooks/use-vehicles-on-rent-v2";
import { parseLocalDate } from "@/lib/date-utils";

/**
 * The Vehicles hero row: one simple graph, "Cars on rent" against the fleet,
 * and the featured deck.
 *
 * WHY THIS REPLACED THE SIX TILES. The front of the overview used to be six
 * stat tiles (Total, Available, Currently Rented, Unavailable, Paused,
 * Utilization). The team lead's brief for every hero tab (Rentals, Customers,
 * Vehicles) is ONE graph over ~75% of the row, "extremely simple, like
 * Stripe's", because complicated graphs never get read; and a featured card
 * beside it. The per-car state those tiles counted is still on every row of the
 * table below, in the Status column, and the filter panel on the back of this
 * slot filters by it. v1 still renders the tiles, untouched.
 *
 * EVERY NUMBER HERE IS REAL. Each point is counted from the tenant's rentals
 * (`useVehiclesOnRentV2`, filtered by tenant_id) against the cars the table is
 * showing. The day-by-day count is `carsOnRentCounter` in that hook's file, and
 * the series math is lib/hero-series.ts; both have hand-worked tests.
 *
 * WHICH CARS. Every car the table currently shows (`filteredVehicles`, so search
 * and every filter narrow it, across all of its rows), disposed cars included:
 * the table still lists a disposed car, and one with a rental still out is
 * still out. "Of N cars" after the headline counts the shown cars that are NOT
 * disposed, the fleet that can be rented. When a disposed car is out today the
 * headline names it ("3 of 7 cars + 1 disposed") rather than letting it push
 * the count past the fleet unexplained. On past days a car counts on the days it
 * was out, whether or not it has been disposed of since, so selling a car never
 * rewrites the past.
 *
 * WHAT "ON RENT" MEANS on a day. Built on Insights' utilisation definition
 * (insights/_data.ts, computeUtilisation), with two deliberate differences:
 *
 *   - Only `Active` and `Closed` rentals count, as in Insights. Pending is a
 *     booking whose keys have not been handed over (the table badges that car
 *     Reserved, not Rented); Cancelled and Rejected never ran.
 *   - Both ends are inclusive, as in Insights: a rental that starts and ends on
 *     the same day had the car out that day.
 *   - A CLOSED rental counts from start_date through end_date, and needs both
 *     (Insights skips a row with no end date, and so does this).
 *   - An ACTIVE rental counts from start_date through TODAY, whatever end_date
 *     says. This is the first difference: Insights clips at end_date and drops
 *     a null one. But an Active rental past its end date is a car that has not
 *     come back (overdue, or auto-extend renewing weekly), and a null end date
 *     is pay-as-you-go or ongoing; all of those cars are out.
 *   - TODAY'S count is the cars out right now: every Active rental, and no
 *     Closed one (its car is back, even if it was returned this morning). This
 *     is the second difference, and it is what makes the headline equal the
 *     page's active-rental signal, the one the table's Status column reads to
 *     mark a car Rented rather than Reserved (`vehicles-active-rental-ids`:
 *     every Active rental with a car, no date filter), over the cars the table
 *     shows. An Active rental dated to start after today (the portal makes a
 *     rental Active at key handover, which can come before its start date)
 *     therefore counts today, and only today.
 *   - A car counts once a day however many rentals overlap on it.
 *
 * THE NUMBERS AND THE LINE.
 *   - The big number is the cars out TODAY. The smaller one is the cars out on
 *     ONE earlier day, today's date one period back, and it is labelled with that
 *     date ("On Aug 16"): a level on a day, never a total for the period.
 *   - "Last 7 days" and "Last 30 days" draw each day's own count.
 *   - "Last 3 months" and "Last 12 months" draw one point a week or a month: the
 *     AVERAGE number of cars out per day across it (a month under way: its days
 *     so far), and the tooltip says "Daily average". A month in which one car was
 *     out on 28 of its 31 days reads 0.9, where its last day alone would read 0.
 *     Averages print with one decimal, and anything above 0 that would round to
 *     0.0 prints as "< 0.1", so a quiet month never reads as an empty one.
 *
 * WHAT THIS CANNOT SEE, stated rather than hidden:
 *   - Pause and "unavailable" have no history, so they change no day's count. A
 *     car paused while a customer still has it is counted as on rent, although
 *     its badge reads Paused. Likewise a car whose status column has drifted from
 *     its rentals (a second rental closed, resetting it to Available) still
 *     counts, and so does a disposed car whose badge reads Disposed (the
 *     headline's "+ 1 disposed" names that one).
 *   - Closing a rental from its key return keeps the booked end_date, so a car
 *     returned early still counts on the days between the return and that date.
 *     (The Close Rental dialog and pay-as-you-go finalising do write the real
 *     end date.)
 *   - `rentals.vehicle_id` holds the car after any swap, so days before a swap
 *     count against the new car. The fleet total is unaffected.
 *
 * THE SECOND LINE, "Fleet", is how many of the shown cars were in the fleet on
 * each day, so the gap between the two lines is the cars standing idle. A car
 * joins on the day its record was created (`vehicles.created_at`; one with no
 * date has always been there) and leaves on its disposal date. A disposed car
 * with no disposal date on record cannot be placed, so it counts on no day,
 * exactly as "of N cars" leaves it out today. So today's Fleet is always the N
 * in "of N cars". Weeks and months average the days, like the main line.
 *
 * THE CARD is the featured deck (components/shared/featured-deck-v2.tsx):
 * Availability, Turo Sync, Ask Trax and platform announcements, each gated in
 * the registry (lib/featured-cards.ts) the way its destination is. With no
 * eligible card, the graph takes the whole row.
 *
 * Single stable root, no fixed height: the overview flip measures this face
 * with a ResizeObserver. Until the rentals arrive it draws a skeleton of the
 * same height, never a zero.
 */

/** The rentals query, as much of it as this row reads. */
export interface OnRentQuery {
  data: readonly OnRentRental[] | undefined;
  isError: boolean;
  /** When `data` was read; "today" for the count is that moment. */
  dataUpdatedAt: number;
  refetch: () => unknown;
}

/** A car, as far as this row reads it. */
export interface OverviewVehicle {
  id: string;
  is_disposed?: boolean | null;
  created_at?: string | null;
  disposal_date?: string | null;
}

interface Props {
  /** The table's rows (`filteredVehicles`), every page of them. */
  vehicles: readonly OverviewVehicle[];
  onRent: OnRentQuery;
  /** True when a filter or search narrows the list. */
  filtered: boolean;
}

/**
 * A day's count is a whole number; a week's or a month's is an average, printed
 * with one decimal. A small average that would round to "0.0" would read as no
 * cars at all, so it prints as "< 0.1".
 */
export function formatCars(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  if (value > 0 && value < 0.05) return `< ${(0.1).toLocaleString()}`;
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const carWord = (n: number) => (n === 1 ? "car" : "cars");

/** A bare date is a local calendar day; anything else is an instant. */
function dayOf(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDate(value) : new Date(value);
}

/**
 * "Fleet" as a function of the day: how many of `vehicles` were in the fleet.
 * See THE SECOND LINE above. Days after `today` are not history; nothing counts.
 */
export function fleetSizeCounter(vehicles: readonly OverviewVehicle[], today: Date): (day: Date) => number {
  const todayStart = startOfDay(today).getTime();
  const spans = vehicles.map((v) => {
    const created = v.created_at ? startOfDay(dayOf(v.created_at)).getTime() : Number.NaN;
    // No readable creation date: it has always been part of the fleet.
    const from = Number.isFinite(created) ? created : Number.NEGATIVE_INFINITY;
    // Exclusive. A disposed car is out of the fleet from its disposal date, and
    // never later than today, so today's count matches "of N cars".
    let until = Number.POSITIVE_INFINITY;
    if (v.is_disposed) {
      const disposed = v.disposal_date ? startOfDay(dayOf(v.disposal_date)).getTime() : Number.NaN;
      until = Number.isFinite(disposed) ? Math.min(disposed, todayStart) : Number.NEGATIVE_INFINITY;
    }
    return [from, until] as const;
  });
  return (day: Date) => {
    const t = startOfDay(day).getTime();
    if (!Number.isFinite(t) || t > todayStart) return 0;
    let count = 0;
    for (const [from, until] of spans) if (from <= t && t < until) count++;
    return count;
  };
}

/** "of 7 cars", "of 7 cars + 1 disposed", or with no fleet shown, "of 1 disposed car". */
export function onRentSuffix(fleetSize: number, disposedOutToday: number): string {
  if (disposedOutToday <= 0) return `of ${fleetSize.toLocaleString()} ${carWord(fleetSize)}`;
  if (fleetSize <= 0) return `of ${disposedOutToday.toLocaleString()} disposed ${carWord(disposedOutToday)}`;
  return `of ${fleetSize.toLocaleString()} ${carWord(fleetSize)} + ${disposedOutToday.toLocaleString()} disposed`;
}

const DECK_ROUTES = ["/vehicles", "/blocked-dates", "/turo-bridge"] as const;

export function VehiclesOverview({ vehicles, onRent, filtered }: Props) {
  // Every car the table shows, disposed ones included (see WHICH CARS).
  const carIds = useMemo(() => new Set(vehicles.map((v) => v.id)), [vehicles]);
  const disposedIds = useMemo(() => new Set(vehicles.filter((v) => v.is_disposed).map((v) => v.id)), [vehicles]);
  const fleetSize = useMemo(() => vehicles.filter((v) => !v.is_disposed).length, [vehicles]);
  const rentals = onRent.data;
  const updatedAt = onRent.dataUpdatedAt;
  const today = useMemo(() => new Date(updatedAt), [updatedAt]);

  const metrics = useMemo<HeroMetric[] | null>(() => {
    if (!rentals) return null;
    const valueOn = carsOnRentCounter(rentals, carIds, today);
    const disposedOutToday = disposedIds.size > 0 ? carsOnRentCounter(rentals, disposedIds, today)(today) : 0;
    return [
      {
        key: "cars-on-rent",
        label: "Cars on rent",
        kind: "stock",
        description:
          "Cars out on a rental. Today: every car with an active rental. Last 7 and 30 days: each day's count. Last 3 and 12 months: the average number out per day across each week or month.",
        format: formatCars,
        suffix: onRentSuffix(fleetSize, disposedOutToday),
        valueOn,
        secondary: { label: "Fleet", valueOn: fleetSizeCounter(vehicles, today) },
      },
    ];
  }, [rentals, carIds, disposedIds, today, fleetSize, vehicles]);

  const note = filtered ? "Filtered" : undefined;

  return (
    <div data-tour="fleet-overview">
      <HeroRow
        chart={
          metrics ? (
            <HeroChart metrics={metrics} anchor="vehicles-chart" note={note} today={today} />
          ) : (
            <ChartPlaceholder
              note={note}
              failed={onRent.isError}
              onRetry={() => {
                void onRent.refetch();
              }}
            />
          )
        }
        card={
          <FeaturedDeck
            tab="vehicles"
            routePrefixes={DECK_ROUTES}
            anchor="vehicles-featured"
            className="lg:min-h-0"
          />
        }
      />
    </div>
  );
}

/**
 * The graph's frame while the rentals load, or if they fail: the SAME elements
 * and classes HeroChart draws, with the numbers blanked, so the row is the same
 * height either way and nothing jumps when the chart lands. Deliberately no
 * digits: a zero here would be read as "no cars out".
 */
function ChartPlaceholder({
  note,
  failed,
  onRetry,
}: {
  note?: string;
  failed: boolean;
  onRetry: () => void;
}) {
  // Blank glyph boxes: inline-blocks holding a no-break space, in the same type
  // classes as the real numbers, so each line box is exactly as tall as the
  // text it stands in for. No digit is ever put in the DOM, not even the
  // comparison day's date.
  const blank = failed
    ? "inline-block"
    : "inline-block animate-pulse rounded-md bg-muted";
  const nbsp = "\u00a0";
  return (
    <section className="flex flex-col gap-3" aria-label="Cars on rent" aria-busy={!failed}>
      <div className="flex flex-col gap-2" data-tour="vehicles-chart">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-foreground">Cars on rent today</span>
          <div className="flex shrink-0 items-center gap-2">
            {note && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/80">
                {note}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
              Last 30 days
              <ChevronDown className="size-3.5" aria-hidden />
            </span>
          </div>
        </div>
        {/* The chart's second row: the number with its suffix and the change
            chip on the left, the legend strip on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5" aria-hidden>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-baseline gap-1.5">
              <span className={`font-heading text-3xl leading-none tracking-tight tabular-nums w-10 ${blank}`}>
                {failed ? "—" : nbsp}
              </span>
              <span className={`text-sm w-16 ${blank}`}>{nbsp}</span>
            </span>
            <span className={`h-6 w-12 text-xs ${blank}`}>{nbsp}</span>
          </div>
          <div className="ml-auto flex min-h-[30px] flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
            <span className={`w-56 ${blank}`}>{nbsp}</span>
          </div>
        </div>
      </div>

      {failed ? (
        <div className={`flex ${HERO_CHART_HEIGHT} w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 text-sm text-muted-foreground`}>
          <span>Couldn&apos;t load the rentals for this graph.</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className={`${HERO_CHART_HEIGHT} w-full animate-pulse rounded-xl bg-muted/60`} aria-hidden />
      )}

      {!failed && <p className="sr-only">Loading cars on rent.</p>}
    </section>
  );
}

