/**
 * The Rentals graph's metrics, shared by both portals: the operator's Rentals
 * tab (apps/portal/src/components/rentals-v2/rentals-overview.tsx) and the
 * customer portal's Rentals page. One builder, so the two graphs cannot count
 * differently.
 *
 * WHAT COUNTS.
 *   - BOOKED: a rental counts on the day it was created. Cancelled and rejected
 *     rentals never ran, so they add neither a booking nor booked value.
 *     "Booked value" sums what rentals were written for (`monthly_amount`,
 *     which despite its name is the rental's total). It is NOT money
 *     collected, and it is never called revenue.
 *   - PICKED UP: a rental counts on its start date (the table's Pickup column),
 *     once that day has come, unless it was cancelled, rejected, or is still
 *     Pending (keys not handed over). A future start date is not history yet,
 *     so it counts on no day.
 *
 * Statuses are the operator's words (`getRentalStatus`, rental-status.ts).
 */

import type { HeroMetric } from "./hero-chart";
import { parseLocalDate } from "./timeline/dates";

export interface RentalForMetrics {
  /** `created_at`, a timestamptz. */
  createdAt: string | null;
  /** `start_date`, DATE-only. */
  start: string | null;
  /** The operator's status word. */
  status: string;
  /** What the rental was written for. */
  amount: number;
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

export function rentalsHeroMetrics(
  rentals: readonly RentalForMetrics[],
  {
    format,
    countLabel,
  }: {
    /** Money in the tenant's currency. */
    format: (value: number) => string;
    /** The second metric's name: "New bookings" (operator), "New rentals" (customer). */
    countLabel: string;
  },
): HeroMetric[] {
  const booked = rentals.filter((r) => r.createdAt && !NEVER_RAN.has(r.status));
  const pickedUp = rentals.filter((r) => r.start && !NOT_PICKED_UP.has(r.status));
  const amount = (r: RentalForMetrics) => Number(r.amount) || 0;
  return [
    {
      key: "booked-value",
      label: "Booked value",
      kind: "flow",
      description: "What new rentals were booked for, excluding cancelled and rejected ones. This is not money collected.",
      format,
      events: booked.map((r) => ({ at: new Date(r.createdAt as string), amount: amount(r) })),
      secondary: {
        label: "Picked up",
        events: pickedUp.map((r) => ({ at: dayOf(r.start as string), amount: amount(r) })),
      },
    },
    {
      key: "bookings",
      label: countLabel,
      kind: "flow",
      description: "Rentals created, excluding cancelled and rejected ones.",
      format: (v) => v.toLocaleString(),
      events: booked.map((r) => ({ at: new Date(r.createdAt as string), amount: 1 })),
      secondary: {
        label: "Picked up",
        events: pickedUp.map((r) => ({ at: dayOf(r.start as string), amount: 1 })),
      },
    },
  ];
}
