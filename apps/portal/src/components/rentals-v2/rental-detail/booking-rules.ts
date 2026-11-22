/**
 * The tenant's booking rules, applied to dates picked in the portal (QA R2.7).
 *
 * Same numbers and the same minimum formula as the v1 New Rental page and the
 * booking site: minimum = max(1, min_rental_days * 24 + min_rental_hours) hours,
 * maximum = max_rental_days, notice = booking_lead_time_hours.
 *
 *   - Shorter than the minimum or longer than the maximum is REFUSED: those are
 *     rules about the rental itself.
 *   - Sooner than the booking notice is a WARNING only. The notice protects the
 *     operator from last-minute online bookings; staff renting a car to someone
 *     standing at the counter must still be able to (the v1 page warned too).
 *
 * Pure: no React, no clock of its own (`now` is passed in), so it is testable.
 */
export interface BookingRuleSettings {
  min_rental_days?: number | null;
  min_rental_hours?: number | null;
  max_rental_days?: number | null;
  booking_lead_time_hours?: number | null;
  booking_lead_time_unit?: "hours" | "days" | null;
}

export interface BookingRuleResult {
  /** Why these dates cannot be used, or null. */
  refuse: string | null;
  /** Something staff should know but may go ahead with, or null. */
  warn: string | null;
}

const at = (day: string, time: string) => new Date(`${day}T${time || "10:00"}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function describeHours(total: number): string {
  const days = Math.floor(total / 24);
  const hours = total % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(plural(days, "day"));
  if (hours > 0) parts.push(plural(hours, "hour"));
  return parts.join(" ") || plural(0, "hour");
}

export function checkBookingRules(
  pick: { start: string | null; startTime: string; end: string | null; endTime: string },
  settings: BookingRuleSettings | null | undefined,
  now: Date,
): BookingRuleResult {
  const s = settings ?? {};
  let refuse: string | null = null;
  let warn: string | null = null;

  if (pick.start && pick.end) {
    const hours = (at(pick.end, pick.endTime).getTime() - at(pick.start, pick.startTime).getTime()) / 36e5;
    const minHours = Math.max(1, (s.min_rental_days ?? 0) * 24 + (s.min_rental_hours ?? 1));
    const maxDays = s.max_rental_days ?? 90;
    if (hours <= 0) {
      refuse = "The return has to be after the pickup.";
    } else if (hours < minHours) {
      refuse = `Too short: the shortest rental is ${describeHours(minHours)}, and these dates come to ${describeHours(Math.max(0, Math.round(hours)))}. Pick a later return.`;
    } else if (maxDays > 0 && hours > maxDays * 24) {
      refuse = `Too long: the longest rental is ${plural(maxDays, "day")}. Pick an earlier return, or add a period later.`;
    }
  }

  const leadHours = s.booking_lead_time_hours ?? 0;
  if (pick.start && leadHours > 0) {
    const untilPickup = (at(pick.start, pick.startTime).getTime() - now.getTime()) / 36e5;
    if (untilPickup < leadHours) {
      const notice =
        s.booking_lead_time_unit === "days" ? plural(Math.round(leadHours / 24), "day") : plural(leadHours, "hour");
      warn = `Pickup is sooner than your ${notice} booking notice. Online bookings are refused for this; you can still book it here.`;
    }
  }

  return { refuse, warn };
}
