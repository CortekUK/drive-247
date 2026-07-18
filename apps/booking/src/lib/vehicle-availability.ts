// Single source of truth for "is this vehicle occupied for the requested dates?"
// Used by every booking-site availability path so they can't drift apart.
//
// Root cause this fixes: availability used to be decided purely by rental
// date-overlap (start_date <= dropoff AND end_date >= pickup). When a rental's
// end_date goes STALE/past — e.g. an auto-extension that didn't roll the date
// forward, a paused auto-extend, or an overdue rental that was never closed —
// no rental "overlaps" a current/future search, so a car that is physically
// still out shows as AVAILABLE. This rule additionally treats an Active rental
// with a past end_date as still occupying the vehicle (the car hasn't come back
// until the rental is Closed), independent of the stale date.

// Rental statuses that still HOLD a vehicle (car not yet released to the fleet).
export const OPEN_RENTAL_STATUSES = ["Pending", "Active", "Upcoming", "Confirmed", "Started"] as const;

export interface OccupancyRental {
  vehicle_id?: string | null;
  status?: string | null;
  start_date: string;
  end_date: string | null;
}

/** UTC calendar day as 'YYYY-MM-DD' (rental date columns are timezone-agnostic). */
export const todayStr = (): string => new Date().toISOString().split("T")[0];

/** Statuses meaning the car is physically OUT right now (not just future-booked). */
const OUT_NOW_STATUSES = new Set(["Active", "Started"]);

/**
 * Does this OPEN rental occupy the vehicle for the requested window
 * [reqStart, reqEnd] (both 'YYYY-MM-DD')? Callers should already have filtered
 * rentals to open statuses (not Cancelled/Rejected/Closed/Completed).
 *
 * Blocks when EITHER:
 *  - the rental overlaps the window: start_date <= reqEnd AND
 *    (end_date IS NULL OR end_date >= reqStart)  — NULL end = open-ended/PAYG; OR
 *  - the rental is Active but its end_date is already in the past — the car is
 *    physically still out (stale/overdue), so it must not appear bookable.
 */
export function rentalOccupiesWindow(
  r: OccupancyRental,
  reqStart: string,
  reqEnd: string,
  today: string = todayStr(),
): boolean {
  const overlaps =
    r.start_date <= reqEnd && (r.end_date == null || r.end_date >= reqStart);
  const stillOut =
    !!r.status && OUT_NOW_STATUSES.has(r.status) && r.end_date != null && r.end_date < today;
  return overlaps || stillOut;
}
