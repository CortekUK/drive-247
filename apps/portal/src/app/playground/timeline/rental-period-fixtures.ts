import type { TimelineData } from "@/components/timeline-v2/model";
import { EMPTY_TIMELINE } from "@/components/timeline-v2/model";
import { FIXTURE_DATA } from "./fixtures";

/** Rental-only review cases. This module is never imported by production views. */
const booking = FIXTURE_DATA.bookings[0];
export const RENTAL_PERIOD_CASES: Record<string, TimelineData> = {
  original: { ...EMPTY_TIMELINE, bookings: [booking] },
  recorded: {
    ...EMPTY_TIMELINE,
    bookings: [{ ...booking, end: "2026-09-20", returnTime: "12:00" }],
    extensions: [
      { id: "fixture-recorded-1", sequence_number: 1, previous_end_date: "2026-09-13", new_end_date: "2026-09-17", status: "paid", total_amount: null },
      { id: "fixture-recorded-2", sequence_number: 2, previous_end_date: "2026-09-17", new_end_date: "2026-09-20", status: "paid", total_amount: null },
    ],
  },
  long: { ...EMPTY_TIMELINE, bookings: [{ ...booking, start: "2026-08-29", end: "2027-01-03" }] },
  readonly: { ...EMPTY_TIMELINE, bookings: [booking] },
  unsupported: { ...EMPTY_TIMELINE, bookings: [{ ...booking, end: null }] },
};
