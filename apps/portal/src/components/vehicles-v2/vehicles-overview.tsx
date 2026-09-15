"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { carsOnRentCounter, type OnRentRental } from "@/hooks/use-vehicles-on-rent-v2";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useV2 } from "@/lib/v2-context";

/**
 * The Vehicles hero row: one simple graph, "Cars on rent", and the Availability card.
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
 * WHICH CARS. The cars the table currently shows (`filteredVehicles`, so search
 * and every filter narrow it), minus disposed ones. The headline reads "of N
 * cars" over that same set. A disposed car is out of the fleet, so it counts on
 * no day, even if a stray Active rental still points at it. That includes the
 * days before it was disposed of: every point describes the fleet you have now,
 * the same cars the "of N" counts, so selling a car does not rewrite the line
 * as a fall in rentals.
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
 *   - TODAY'S point is the cars out right now: every Active rental, and no
 *     Closed one (its car is back, even if it was returned this morning). This
 *     is the second difference, and it is what makes the headline equal the
 *     page's active-rental signal, the one the table's Status column reads to
 *     mark a car Rented rather than Reserved (`vehicles-active-rental-ids`:
 *     every Active rental with a car, no date filter). An Active rental dated to
 *     start after today (the portal makes a rental Active at key handover,
 *     which can come before its start date) therefore counts today, and only
 *     today.
 *   - A car counts once a day however many rentals overlap on it.
 *
 * WHAT THIS CANNOT SEE, stated rather than hidden:
 *   - Pause and "unavailable" have no history, so they change no day's count. A
 *     car paused while a customer still has it is counted as on rent, although
 *     its badge reads Paused. Likewise a car whose status column has drifted from
 *     its rentals (a second rental closed, resetting it to Available) still counts.
 *   - Closing a rental from its key return keeps the booked end_date, so a car
 *     returned early still counts on the days between the return and that date.
 *     (The Close Rental dialog and pay-as-you-go finalising do write the real
 *     end date.)
 *   - `rentals.vehicle_id` holds the car after any swap, so days before a swap
 *     count against the new car. The fleet total is unaffected.
 *
 * THE FEATURED CARD opens the Availability screen (/blocked-dates), gated the way
 * the rail's Availability entry is. With no card, the graph takes the whole row.
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

interface Props {
  /** The table's rows (`filteredVehicles`), every page of them. */
  vehicles: readonly { id: string; is_disposed?: boolean | null }[];
  onRent: OnRentQuery;
  /** True when a filter or search narrows the list. */
  filtered: boolean;
}

const CARD =
  "group relative flex min-h-[13rem] cursor-pointer flex-col justify-end overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 text-left text-foreground shadow-sm outline-none transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/15 focus-visible:ring-2 focus-visible:ring-ring";

export function VehiclesOverview({ vehicles, onRent, filtered }: Props) {
  const fleet = useMemo(() => vehicles.filter((v) => !v.is_disposed), [vehicles]);
  const carIds = useMemo(() => new Set(fleet.map((v) => v.id)), [fleet]);
  const rentals = onRent.data;
  const updatedAt = onRent.dataUpdatedAt;
  const today = useMemo(() => new Date(updatedAt), [updatedAt]);

  /**
   * The card's gates, decided HERE rather than inside the card: HeroRow gives
   * the graph the whole row only when it receives no card, and a component that
   * renders null is still a card as far as HeroRow can tell.
   *
   *  - `useV2("availability")`: without it /blocked-dates is the v1 cards, not
   *    the screen this card describes, so there is no card.
   *  - the rail's Availability entry: a manager sees it only with a grant on the
   *    `availability` tab (ROUTE_TO_TAB → canView), which is `canAccessRoute`.
   *    No grant, or grants still loading, means no card.
   *  - someone who may look but not edit (a viewer, a manager with a viewer
   *    grant) gets the card, worded for looking rather than setting, because the
   *    screen shows them the week with its controls disabled.
   */
  const v2Availability = useV2("availability");
  const { canAccessRoute, canEdit, isLoading: permissionsLoading } = useManagerPermissions();
  const showCard = v2Availability && !permissionsLoading && canAccessRoute("/blocked-dates");

  const metrics = useMemo<HeroMetric[] | null>(() => {
    if (!rentals) return null;
    const valueOn = carsOnRentCounter(rentals, carIds, today);
    return [
      {
        key: "cars-on-rent",
        label: "Cars on rent",
        kind: "stock",
        description:
          "Cars with a rental out that day. Today is every car with an active rental; earlier days also count rentals closed since. Disposed cars are not counted.",
        format: (v) => v.toLocaleString(),
        suffix: `of ${fleet.length.toLocaleString()} ${fleet.length === 1 ? "car" : "cars"}`,
        valueOn,
      },
    ];
  }, [rentals, carIds, today, fleet.length]);

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
        card={showCard ? <AvailabilityCard editable={canEdit("availability")} /> : undefined}
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
  // number it stands in for. No digit is ever put in the DOM.
  const blank = failed
    ? "inline-block"
    : "inline-block animate-pulse rounded-md bg-muted";
  const nbsp = " ";
  return (
    <section className="flex flex-col gap-3" aria-label="Cars on rent" aria-busy={!failed}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex flex-wrap items-start gap-x-12 gap-y-3" data-tour="vehicles-chart">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Cars on rent</span>
            <div className="flex items-baseline gap-2" aria-hidden>
              <span className={`font-heading text-3xl leading-none tracking-tight tabular-nums w-10 ${blank}`}>
                {failed ? "—" : nbsp}
              </span>
              <span className={`text-sm w-16 ${blank}`}>{nbsp}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5" aria-hidden>
            <span className="text-sm text-muted-foreground">Previous 30 days</span>
            <span className={`font-heading text-xl leading-none tracking-tight tabular-nums w-8 ${blank}`}>
              {failed ? "—" : nbsp}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {note && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {note}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">Last 30 days</span>
        </div>
      </div>

      {failed ? (
        <div className="flex h-[160px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
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
        <div className="h-[160px] w-full animate-pulse rounded-xl bg-muted/60" aria-hidden />
      )}

      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span className={`w-10 ${blank}`}>{nbsp}</span>
        <span className={`w-8 ${blank}`}>{nbsp}</span>
      </div>
      {!failed && <p className="sr-only">Loading cars on rent.</p>}
    </section>
  );
}

/**
 * The featured card: the Availability screen (/blocked-dates).
 *
 * What that screen really does (components/availability-v2): it lays the week
 * out as a calendar and SAVES weekly opening hours, "Open 24 hours", the
 * timezone, and full-day closures, which are tenant-wide `blocked_dates` rows
 * the booking site honours for every car. Its own subtitle is "Control when
 * customers can book online." Custom hours for a single date cannot be saved
 * yet, so the card does not promise them. Its gates are decided by the caller.
 */
function AvailabilityCard({ editable }: { editable: boolean }) {
  return (
    <Link href="/blocked-dates" data-tour="vehicles-featured" className={CARD}>
      <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-primary/15 blur-2xl transition-all duration-300 group-hover:bg-primary/25" />
      <span className="pointer-events-none absolute -bottom-10 -left-6 size-24 rounded-full bg-primary/10 blur-2xl" />
      <WeekArt />
      <div className="relative">
        <div className="mt-3 text-lg font-bold tracking-tight">Availability</div>
        <div className="text-sm text-muted-foreground">
          {editable ? "Set when customers can book" : "See when customers can book"}
        </div>
      </div>
      <ArrowRight
        className="absolute right-4 top-4 size-5 text-primary"
        style={{ animation: "arrow-nudge 4s ease-in-out infinite" }}
        aria-hidden
      />
    </Link>
  );
}

/**
 * A faint week, echoing the screen's calendar: seven day columns, each with its
 * open hours as a bar, Sunday closed (dashed, empty), and the "now" dot glowing
 * on today. Decorative only. `v2-glow` and `v2-float` are real keyframes in
 * styles/v2-theme.css, which the root layout puts on <body> for the same gated
 * tenants that reach this screen.
 */
const WEEK: readonly { top: string; height: string; closed?: boolean }[] = [
  { top: "18%", height: "58%" },
  { top: "18%", height: "58%" },
  { top: "18%", height: "58%" },
  { top: "18%", height: "58%" },
  { top: "18%", height: "70%" },
  { top: "30%", height: "38%" },
  { top: "12%", height: "76%", closed: true },
];

function WeekArt() {
  return (
    <div
      className="pointer-events-none absolute inset-x-5 top-[34%] h-[72px] -translate-y-1/2 opacity-80 transition-opacity duration-300 group-hover:opacity-100"
      aria-hidden
    >
      <div className="grid h-full grid-cols-7 gap-1.5">
        {WEEK.map((d, i) => (
          <div key={i} className="relative rounded-md bg-primary/[0.07]">
            {d.closed ? (
              <span
                className="absolute inset-x-1 rounded-sm border border-dashed border-primary/35"
                style={{ top: d.top, height: d.height }}
              />
            ) : (
              <span
                className={`absolute inset-x-1 rounded-sm ${i === 2 ? "bg-primary/60" : "bg-primary/35"}`}
                style={{
                  top: d.top,
                  height: d.height,
                  animation: "v2-glow 3.6s ease-in-out infinite",
                  animationDelay: `${i * 0.3}s`,
                }}
              />
            )}
          </div>
        ))}
      </div>
      {/* "Now" on today's column: the screen draws the current time as a line with a dot. */}
      <span
        className="absolute top-[46%] h-px bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]"
        style={{
          // The third of seven columns with 0.375rem gaps: 6 gaps are 2.25rem.
          left: "calc((100% - 2.25rem) * 2 / 7 + 0.75rem)",
          width: "calc((100% - 2.25rem) / 7)",
          animation: "v2-float 4s ease-in-out infinite",
        }}
      >
        <span className="absolute -left-[3px] -top-[3px] size-[7px] rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
      </span>
    </div>
  );
}
