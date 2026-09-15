"use client";

/**
 * The rentals behind the Vehicles hero graph, "Cars on rent" (v2 only).
 *
 * The vehicles page loads no dated data a time series could be drawn from: the
 * P&L view it reads is lifetime totals, and vehicles keep no status history. So
 * this is one extra read of `rentals`, the four columns the count needs and
 * nothing else, and a pure function that turns those rows into "how many of
 * these cars were out on a given day". The definition itself, and why each rule
 * is what it is, is written up in components/vehicles-v2/vehicles-overview.tsx.
 *
 * TENANT ISOLATION. `rentals` still carries a permissive select policy in the
 * repo's migrations, so the `.eq('tenant_id', …)` below is the boundary, not a
 * convenience. Do not drop it.
 *
 * v2 only: the page passes `useV2("chrome")`, so every other tenant issues no
 * request at all. The key is its own (`vehicles-v2-on-rent`), never the shared
 * `vehicles-list` key, which other screens cache narrower shapes under.
 */

import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { parseLocalDate } from "@/lib/date-utils";

/** One rental, as far as the count needs it. `start_date` is NOT NULL in the schema. */
export interface OnRentRental {
  vehicle_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
}

/** PostgREST hands back at most 1,000 rows a request, silently. */
const PAGE_SIZE = 1000;
/**
 * Two years of one tenant's rentals will not come near this. If a tenant ever
 * does, the chart shows its error state rather than a count built from part of
 * the book: a partial answer here would read as a real, smaller number.
 */
const MAX_ROWS = 50_000;

/**
 * The earliest day the widest comparison ever samples, as `yyyy-MM-dd`.
 *
 * "Last 12 months" against "Previous 12 months" starts on the first of the
 * month 23 months before this one (lib/hero-series.ts). Twenty-four months back
 * from the first of this month covers that with a month to spare, on the local
 * calendar (`format`, not `toISOString`, which would read the date in UTC).
 */
export function onRentHistoryStart(today: Date): string {
  return format(subMonths(startOfMonth(today), 24), "yyyy-MM-dd");
}

type RentalsPage = {
  range: (from: number, to: number) => PromiseLike<{ data: OnRentRental[] | null; error: unknown }>;
};

/**
 * Every rental that can put a car on the road on a day the graph samples.
 *
 *  - `Active` rentals: ALL of them, whatever their dates. Today's point must be
 *    the same cars the list's Status column marks Rented, and that signal
 *    (`vehicles-active-rental-ids` on the page) reads every Active rental with
 *    no date filter. A date filter here would drop the long-overdue ones.
 *  - `Closed` rentals: those that ended on or after `from`. One that ended
 *    earlier cannot touch a sampled day, and one with no end date cannot be
 *    placed at all (the count ignores it either way).
 *
 * Ordered by `id` so offset paging walks a total order: without one, rows can
 * swap between pages and be read twice or not at all.
 */
export async function fetchOnRentRentals(tenantId: string, from: string): Promise<OnRentRental[]> {
  const rows: OnRentRental[] = [];
  let offset = 0;
  for (;;) {
    const page = supabase
      .from("rentals")
      .select("vehicle_id, start_date, end_date, status")
      .eq("tenant_id", tenantId)
      .in("status", ["Active", "Closed"])
      .not("vehicle_id", "is", null)
      .or(`status.eq.Active,end_date.gte.${from}`)
      .order("id", { ascending: true }) as unknown as RentalsPage;
    // supabase-js never throws: the failure is in `error`, and an unchecked one
    // would chart an empty book as "no cars out".
    const { data, error } = await page.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    // Advance by what actually arrived and stop only on an empty page, so a
    // server cap below PAGE_SIZE cannot end the walk early.
    if (!data || data.length === 0) return rows;
    rows.push(...data);
    offset += data.length;
    if (rows.length > MAX_ROWS) {
      throw new Error(`More than ${MAX_ROWS.toLocaleString()} rentals in range; not charting a partial count.`);
    }
  }
}

export function useVehiclesOnRentV2(enabled: boolean) {
  const { tenant } = useTenant();
  const from = onRentHistoryStart(new Date());
  return useQuery({
    queryKey: ["vehicles-v2-on-rent", tenant?.id, from],
    queryFn: () => fetchOnRentRentals(tenant!.id, from),
    enabled: enabled && !!tenant?.id,
  });
}

/** A calendar day as a whole number, read off the LOCAL calendar; NaN for an invalid date. */
function dayNumber(d: Date): number {
  const t = d.getTime();
  if (Number.isNaN(t)) return Number.NaN;
  // Date.UTC over the local y/m/d: whole days apart whatever the clocks did.
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

/** How many of the ascending `sorted` numbers are at most `x`. */
function countAtMost(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many of the ascending `sorted` numbers are below `x`. */
function countBelow(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * "Cars on rent" as a function of the day: how many DISTINCT cars in `carIds`
 * had a rental on the road that day. See vehicles-overview.tsx for the rules;
 * in short:
 *
 *  - Active: out from `start_date` through today, whatever `end_date` says.
 *    If `start_date` is after today (keys handed over early), out today only.
 *  - Closed: out from `start_date` through `end_date`, both inclusive, but
 *    never today: a closed rental's car is back, so it is not out right now.
 *    Needs both dates; a row without a readable `end_date` is left out.
 *  - Every other status (Pending, Cancelled, Rejected) never counts.
 *
 * Days after `today` are not history; nothing counts on them.
 *
 * SPEED. The graph asks about every day it draws, about 700 of them for "Last 12
 * months" against the 12 before, over up to 50,000 rentals. So the work is done
 * once, here. Each car's spans are merged into runs of days that never overlap
 * (a car counts once a day however many of its rentals cover that day), and a
 * day's count is then two binary searches over the sorted run starts and ends.
 */
export function carsOnRentCounter(
  rentals: readonly OnRentRental[],
  carIds: ReadonlySet<string>,
  today: Date,
): (day: Date) => number {
  const todayN = dayNumber(today);
  if (!Number.isFinite(todayN)) return () => 0;

  const spansByCar = new Map<string, [from: number, to: number][]>();
  const addSpan = (vehicleId: string, from: number, to: number) => {
    const spans = spansByCar.get(vehicleId);
    if (spans) spans.push([from, to]);
    else spansByCar.set(vehicleId, [[from, to]]);
  };

  for (const r of rentals) {
    if (!r.vehicle_id || !carIds.has(r.vehicle_id)) continue;
    const start = dayNumber(parseLocalDate(r.start_date));

    if (r.status === "Active") {
      addSpan(r.vehicle_id, Number.isFinite(start) ? Math.min(start, todayN) : todayN, todayN);
      continue;
    }

    if (r.status === "Closed") {
      const end = dayNumber(parseLocalDate(r.end_date));
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const to = Math.min(end, todayN - 1);
      if (to < start) continue;
      addSpan(r.vehicle_id, start, to);
    }
  }

  const runStarts: number[] = [];
  const runEnds: number[] = [];
  for (const spans of spansByCar.values()) {
    spans.sort((a, b) => a[0] - b[0]);
    let [from, to] = spans[0];
    for (let k = 1; k < spans.length; k++) {
      const [nextFrom, nextTo] = spans[k];
      if (nextFrom <= to + 1) {
        // Overlapping, or back to back: one unbroken run of days out.
        to = Math.max(to, nextTo);
      } else {
        runStarts.push(from);
        runEnds.push(to);
        from = nextFrom;
        to = nextTo;
      }
    }
    runStarts.push(from);
    runEnds.push(to);
  }
  runStarts.sort((a, b) => a - b);
  runEnds.sort((a, b) => a - b);

  return (day: Date) => {
    const d = dayNumber(day);
    if (!Number.isFinite(d)) return 0;
    // The runs that have started by day d, less those that ended before it (each
    // of which had also started), are the runs covering d, and no car has two.
    return countAtMost(runStarts, d) - countBelow(runEnds, d);
  };
}
