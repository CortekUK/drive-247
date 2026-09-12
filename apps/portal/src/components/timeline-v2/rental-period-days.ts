import { addMonths, format, getDaysInMonth } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { bookingBounds, dayNumber, onDay, shiftDay, type TimelineBooking } from "./model";

export const periodMonth = (date: string) => `${date.slice(0, 7)}-01`;
export const movePeriodMonth = (month: string, amount: number) => format(addMonths(parseLocalDate(month), amount), "yyyy-MM-dd");

/** This is a rental-only date presentation. Reuse the existing time boundaries,
 * including shared return dates, without changing or rounding stored periods. */
export function rentalPeriodDays(periods: TimelineBooking[], month: string, nextDate?: string) {
  const valid = periods.filter(p => Number.isFinite(dayNumber(p.start)) && p.end && Number.isFinite(dayNumber(p.end)));
  if (!valid.length || !Number.isFinite(dayNumber(month))) return [];
  const monthStart = periodMonth(month);
  // Show the complete real month, including neutral dates before and after
  // this rental. Coloring still uses the unchanged booking boundaries below.
  return Array.from({ length: getDaysInMonth(parseLocalDate(monthStart)) }, (_, i) => shiftDay(monthStart, i))
    .map(date => ({
      date, next: date === nextDate,
      periods: periods.flatMap((period, index) => {
        if (!onDay(period, date)) return [];
        const [from, to] = bookingBounds(period), day = dayNumber(date);
        return [{ period, index, from: Math.max(0, from - day), to: Math.min(1, to - day) }];
      }),
    }));
}
