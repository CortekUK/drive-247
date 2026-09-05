/**
 * Date, time and timezone helpers for the booking sidebar.
 *
 * Pure — no React, no Supabase. Everything here works on the two shapes the
 * store holds: a 'YYYY-MM-DD' date and an 'HH:mm' 24-hour time. Nothing in this
 * file ever calls `new Date(someString)` on a date-only value; that parses as
 * UTC midnight and silently shifts the day west of Greenwich, which is the
 * whole reason `parseDateOnly` exists in `@/lib/domain`.
 */

import { formatDateOnly, parseDateOnly } from "@/lib/domain";

/* ────────────────────────────── date-only ────────────────────────────── */

/** Today in the browser's own zone, as 'YYYY-MM-DD'. */
export function todayIso(): string {
  return formatDateOnly(new Date());
}

/** Shift a 'YYYY-MM-DD' by whole days and return the same shape. */
export function addDaysIso(iso: string, days: number): string {
  const date = parseDateOnly(iso);
  date.setDate(date.getDate() + days);
  return formatDateOnly(date);
}

/** True for a well-formed, real calendar date in 'YYYY-MM-DD' form. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
  );
}

/** Human date for a label: "Wed, 12 Mar 2026". Empty string passes through. */
export function formatIsoDateLabel(iso: string): string {
  if (!isIsoDate(iso)) return "";
  return parseDateOnly(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ─────────────────────────────── clock time ──────────────────────────── */

/** True for 'HH:mm' in 24-hour form. */
export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** '14:30' -> 870. Returns null for anything malformed. */
export function minutesOfDay(time: string): number | null {
  if (!isClockTime(time)) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 870 -> '14:30'. */
export function clockFromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.floor(total)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** '14:30' -> '2:30 PM', in the viewer's locale. */
export function formatClockLabel(time: string): string {
  const minutes = minutesOfDay(time);
  if (minutes === null) return time;
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A Postgres `time` column arrives as 'HH:MM:SS'; a settings form may write
 * 'HH:MM'. Both must land on the same 'HH:mm'.
 */
export function normalizeClock(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The selectable pickup / return times.
 *
 * Bounded by the operator's working hours when they are enforced, because a
 * customer who picks 07:00 against a 09:00–17:00 depot has chosen a slot nobody
 * will be there to honour. `alwaysOpen` and a disabled working-hours setting
 * both open the whole day.
 */
export function buildTimeSlots(params: {
  enforceWorkingHours: boolean;
  open: string | null;
  close: string | null;
  stepMinutes?: number;
}): string[] {
  const step = params.stepMinutes && params.stepMinutes > 0 ? params.stepMinutes : 30;
  const openMinutes = params.enforceWorkingHours
    ? (minutesOfDay(params.open ?? "") ?? 0)
    : 0;
  const closeMinutes = params.enforceWorkingHours
    ? (minutesOfDay(params.close ?? "") ?? 24 * 60 - step)
    : 24 * 60 - step;

  // A close time at or before the open time is a misconfiguration, not an
  // instruction to render nothing — an empty time list would make the vehicle
  // unbookable with no explanation.
  const last = closeMinutes > openMinutes ? closeMinutes : 24 * 60 - step;

  const slots: string[] = [];
  for (let m = openMinutes; m <= last; m += step) slots.push(clockFromMinutes(m));
  return slots;
}

/* ──────────────────────────────── timezone ───────────────────────────── */

/**
 * How far `timeZone` is ahead of UTC at `instant`, in milliseconds.
 *
 * Formats the instant AS IF it were in the zone, reads the wall-clock parts
 * back, and subtracts. This is the standard offset trick and it is exact,
 * including across DST boundaries — which matters because the whole point of
 * the lead-time check is a comparison against "now".
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  // Some engines still emit "24" for midnight even under h23.
  const hour = read("hour") % 24;

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * Turn a wall clock reading in `timeZone` into a real instant.
 *
 * Two passes: the first offset is looked up at the naive guess, the second at
 * the corrected instant. That second pass is what gets the hour either side of
 * a DST change right — one pass is off by an hour for roughly two weeks a year.
 *
 * Returns null rather than an Invalid Date for malformed input or an
 * unrecognised zone, so callers cannot accidentally compare against NaN (which
 * is false for every operator and would silently pass a lead-time check).
 */
export function zonedWallClockToInstant(
  isoDate: string,
  clockTime: string,
  timeZone: string,
): Date | null {
  if (!isIsoDate(isoDate) || !isClockTime(clockTime)) return null;

  const [y, m, d] = isoDate.split("-").map(Number);
  const [hh, mm] = clockTime.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);

  try {
    const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
    const settled = naive - zoneOffsetMs(new Date(firstPass), timeZone);
    return new Date(settled);
  } catch {
    // An invalid IANA name throws inside Intl. Fall back to the customer's own
    // zone rather than dropping the check entirely.
    return new Date(y, m - 1, d, hh, mm);
  }
}

/** The viewer's IANA zone, or empty string where Intl cannot say. */
export function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/* ─────────────────────────────── durations ───────────────────────────── */

/** Whole hours between two instants; negative when `end` precedes `start`. */
export function hoursBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60));
}

/** Completed years between a date of birth and today. */
export function calculateAgeYears(dobIso: string): number | null {
  if (!isIsoDate(dobIso)) return null;
  const dob = parseDateOnly(dobIso);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * "2 weeks and 3 days" — the same month/week/day decomposition v1 shows beside
 * the dates, so the duration a customer reads here matches the portal's.
 */
export function formatDuration(days: number, monthlyTierDays: number): string {
  const total = Math.max(1, Math.floor(days));
  const tierDays = monthlyTierDays > 0 ? monthlyTierDays : 30;

  const plural = (count: number, unit: string) =>
    `${count} ${unit}${count === 1 ? "" : "s"}`;

  const months = Math.floor(total / tierDays);
  const afterMonths = total % tierDays;
  const weeks = Math.floor(afterMonths / 7);
  const remainder = afterMonths % 7;

  const parts: string[] = [];
  if (months > 0) parts.push(plural(months, "month"));
  if (weeks > 0) parts.push(plural(weeks, "week"));
  if (remainder > 0) parts.push(plural(remainder, "day"));

  if (parts.length === 0) return plural(total, "day");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(", ")} and ${last}`;
}

/** "1 day 1 hour" — used to explain a minimum-duration rejection. */
export function formatHourSpan(totalHours: number): string {
  const hours = Math.max(0, Math.floor(totalHours));
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (rest > 0) parts.push(`${rest} hour${rest === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" ") : "1 hour";
}
