/**
 * Payment plans — display formatting. Pure, no React, no Supabase.
 *
 * Two rules every function here keeps:
 *
 *   MONEY is integer cents in, a currency string out. Nothing in the payment
 *   plan UI does arithmetic on dollars, so a total can never drift by a cent
 *   from the rows it is summed from.
 *
 *   DATES are 'YYYY-MM-DD' calendar strings. A plan's due date is a day in the
 *   PLAN's timezone, not an instant, so it is never passed through
 *   `new Date('YYYY-MM-DD')` — that parses as UTC midnight and prints the day
 *   before anywhere west of Greenwich. Calendar maths uses UTC day numbers
 *   (no DST in UTC), and display goes through `parseLocalDate`, the repo's one
 *   helper for date columns.
 */

import { parseLocalDate } from "@/lib/date-utils";

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* ── money ─────────────────────────────────────────────────────────────── */

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** 12345 → "$123.45". Always two decimals: a plan's amounts are exact. */
export function formatMoney(cents: number, currency = "USD"): string {
  const code = (currency || "USD").toUpperCase();
  let f = moneyFormatters.get(code);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormatters.set(code, f);
  }
  const value = Number.isFinite(cents) ? Math.round(cents) : 0;
  return f.format(value / 100);
}

/**
 * What an operator typed into an amount box → cents, or null when it is not a
 * usable amount. Parsed from the digits, never via `parseFloat(x) * 100`,
 * which turns "0.29" into 28.999999999999996.
 */
export function parseDollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) return null;
  const whole = m[1] === "" ? 0 : Number(m[1]);
  const frac = m[2] === undefined ? 0 : Number((m[2] + "00").slice(0, 2));
  if (!Number.isSafeInteger(whole)) return null;
  return whole * 100 + frac;
}

/** 20000 → "200.00", for pre-filling an amount box. */
export function centsToInput(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** A Postgres `numeric` money column (number or string) → integer cents. */
export function numericToCents(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/* ── calendar dates ────────────────────────────────────────────────────── */

export function isIsoDate(v: unknown): v is ISODate {
  if (typeof v !== "string") return false;
  const m = ISO_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Day number since the epoch, in pure calendar terms (UTC has no DST). */
export function dayNumber(iso: ISODate): number {
  const m = ISO_RE.exec(String(iso).slice(0, 10));
  if (!m) return NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

export function fromDayNumber(n: number): ISODate {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromDayNumber(dayNumber(iso) + n);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: ISODate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  // 1970-01-01 was a Thursday (ISO 4).
  const n = dayNumber(iso);
  return ((((n + 3) % 7) + 7) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** A JS Date (as a date picker returns it, local midnight) → 'YYYY-MM-DD'. */
export function dateToIso(d: Date): ISODate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 'YYYY-MM-DD' → a local-midnight Date for a date picker. Never UTC. */
export function isoToDate(iso: ISODate): Date {
  return parseLocalDate(iso);
}

/**
 * Today's calendar date in a timezone. A plan's dates are the plan's local
 * days, so "is this missed?" must be asked in the plan's zone, not the
 * operator's browser zone.
 */
export function todayInZone(timeZone?: string | null, now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return dateToIso(now);
  }
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function parts(iso: ISODate) {
  const m = ISO_RE.exec(String(iso).slice(0, 10));
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/** "Fri 9 Oct" — the lead's own shape ("Missed on Fri 9 Oct"). */
export function formatDay(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  const p = parts(iso);
  if (!p) return "—";
  return `${WEEKDAY_SHORT[isoWeekday(iso) - 1]} ${p.d} ${MONTH_SHORT[p.mo - 1]}`;
}

/** "Fri 9 Oct 2026". */
export function formatDayLong(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  const p = parts(iso);
  if (!p) return "—";
  return `${formatDay(iso)} ${p.y}`;
}

/** "Oct 2026" — a calendar month heading. */
export function formatMonth(iso: ISODate): string {
  const p = parts(iso);
  if (!p) return "—";
  return `${MONTH_SHORT[p.mo - 1]} ${p.y}`;
}

/**
 * What a payment covers, from a half-open period [start, endExclusive), said
 * the way a person says it: "2 – 8 Oct", "30 Sep – 1 Oct", "1 day · 2 Oct".
 */
export function formatCovers(start: ISODate | null | undefined, endExclusive: ISODate | null | undefined): string {
  if (!start || !endExclusive) return "—";
  const last = addDays(endExclusive, -1);
  const a = parts(start);
  const b = parts(last);
  if (!a || !b) return "—";
  if (dayNumber(last) <= dayNumber(start)) return `${a.d} ${MONTH_SHORT[a.mo - 1]}`;
  if (a.y !== b.y) return `${a.d} ${MONTH_SHORT[a.mo - 1]} ${a.y} – ${b.d} ${MONTH_SHORT[b.mo - 1]} ${b.y}`;
  if (a.mo !== b.mo) return `${a.d} ${MONTH_SHORT[a.mo - 1]} – ${b.d} ${MONTH_SHORT[b.mo - 1]}`;
  return `${a.d} – ${b.d} ${MONTH_SHORT[a.mo - 1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1st", "2nd", "31st". */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** An ISO instant → "Fri 9 Oct, 10:00" in the given zone (the plan's). */
export function formatInstant(isoInstant: string | null | undefined, timeZone?: string | null): string {
  if (!isoInstant) return "—";
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return "—";
  const day = todayInZone(timeZone, d);
  let time = "";
  try {
    time = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || undefined, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  } catch {
    time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${formatDay(day)}, ${time}`;
}

/** Offsets as a reminder reads: −2 → "2 days before", 0 → "on the day", 2 → "2 days after". */
export function reminderLabel(offset: number): string {
  if (offset === 0) return "On the day";
  const n = Math.abs(offset);
  return `${plural(n, "day")} ${offset < 0 ? "before" : "after"}`;
}
