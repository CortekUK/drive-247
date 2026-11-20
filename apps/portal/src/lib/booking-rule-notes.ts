/**
 * The booking site's rules, read against a rental an admin is setting up in
 * the portal (Settings → Booking rules: advance notice, shortest and longest
 * rental).
 *
 * The booking site REFUSES a trip that breaks one of them. The portal only
 * SAYS so, because an admin may well take a booking the site would not: a
 * walk-in with no notice, a one-night favour, a long lease. So these are
 * notes, not errors — they sit beside the dates until they are saved, and the
 * save goes through.
 *
 * Every time here is a wall-clock string in the tenant's own zone,
 * "yyyy-MM-ddTHH:mm" — the shape the When & where stage already holds — and
 * `now` is the same clock, so the notice is judged where the car is, not where
 * the admin is sitting.
 */
export interface BookingRuleSettings {
  booking_lead_time_hours?: number | null;
  booking_lead_time_unit?: "hours" | "days" | null;
  min_rental_days?: number | null;
  min_rental_hours?: number | null;
  max_rental_days?: number | null;
}

export type BookingRule = "notice" | "minimum" | "maximum";

export interface BookingRuleNote {
  rule: BookingRule;
  text: string;
}

/** Defaults match the booking site's `deriveBookingRules`. */
const DEFAULT_LEAD_TIME_HOURS = 24;
const DEFAULT_MAX_RENTAL_DAYS = 90;

/** Minutes since the epoch, reading the wall clock as if it were UTC: zone-free arithmetic. */
function wallMinutes(at: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60_000;
}

function wallDays(at: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(at);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  return Date.UTC(y, mo - 1, d) / 86_400_000;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "1 day 2 hours", "2 days", "3 hours". */
export function describeHourSpan(hours: number): string {
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(plural(days, "day"));
  if (rest > 0 || parts.length === 0) parts.push(plural(rest, "hour"));
  return parts.join(" ");
}

/** The shortest rental, in hours, as the booking site counts it (never under one hour). */
export function minimumRentalHours(settings: BookingRuleSettings | null | undefined): number {
  const days = settings?.min_rental_days ?? 0;
  const hours = settings?.min_rental_hours ?? 1;
  return Math.max(1, days * 24 + hours);
}

export function bookingRuleNotes(input: {
  pickupAt: string;
  returnAt: string;
  now: string;
  settings: BookingRuleSettings | null | undefined;
}): BookingRuleNote[] {
  const { pickupAt, returnAt, now, settings } = input;
  const notes: BookingRuleNote[] = [];
  const pickup = wallMinutes(pickupAt);
  if (pickup === null) return notes;

  // Advance notice: how far ahead the site makes customers book.
  const lead = settings?.booking_lead_time_hours ?? DEFAULT_LEAD_TIME_HOURS;
  const nowMin = wallMinutes(now);
  if (lead > 0 && nowMin !== null && pickup - nowMin < lead * 60) {
    const unit = settings?.booking_lead_time_unit ?? "hours";
    const label = unit === "days" && lead % 24 === 0 ? `${lead / 24}-day` : `${lead}-hour`;
    notes.push({ rule: "notice", text: `Pickup is inside the ${label} booking notice.` });
  }

  const ret = wallMinutes(returnAt);
  if (ret === null || ret <= pickup) return notes;

  // Shortest rental, judged in hours like the site does (a 1 day 2 hours
  // minimum lets 10:00 → 12:00 next day through and refuses 10:00 → 10:00).
  const minHours = minimumRentalHours(settings);
  if (ret - pickup < minHours * 60) {
    notes.push({
      rule: "minimum",
      text: `Shorter than the shortest rental, ${describeHourSpan(minHours)}.`,
    });
  }

  // Longest rental, in calendar days like the site.
  const maxDays = settings?.max_rental_days ?? DEFAULT_MAX_RENTAL_DAYS;
  const pickupDay = wallDays(pickupAt);
  const returnDay = wallDays(returnAt);
  if (maxDays > 0 && pickupDay !== null && returnDay !== null && returnDay - pickupDay > maxDays) {
    notes.push({
      rule: "maximum",
      text: `Longer than the longest rental, ${plural(maxDays, "day")}.`,
    });
  }
  return notes;
}
