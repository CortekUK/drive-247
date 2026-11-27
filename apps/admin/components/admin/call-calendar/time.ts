/**
 * Time helpers for the Call Calendar. Every time shown names its zone (spec 03.6, 03.7).
 * Written on Intl.DateTimeFormat, the same way as the portal's onboarding-call-time.ts.
 */

const FALLBACK_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Asia/Dubai',
  'Asia/Karachi',
  'UTC',
];

export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const all = intl.supportedValuesOf?.('timeZone');
    if (all && all.length) return all.includes('UTC') ? all : [...all, 'UTC'];
  } catch {
    // older browser: the short list
  }
  return FALLBACK_ZONES;
}

export function isZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "America/New_York" is "New York time", "UTC" stays "UTC". */
export function zoneLabel(tz: string): string {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC';
  if (!isZone(tz)) return tz;
  const city = tz.split('/').pop() ?? tz;
  return `${city.replace(/_/g, ' ')} time`;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...options });
    fmtCache.set(key, f);
  }
  return f;
}

/** "7:00 PM" in that zone. */
export function timeOf(at: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(at));
}

/** "Wed 10 Mar" in that zone. */
export function shortDay(at: string | Date, tz: string): string {
  const p = parts(at, tz);
  return `${p.weekdayShort} ${p.day} ${p.monthShort}`;
}

/** "Wed 10 Mar, 7:00 PM New York time" (spec 03.7 short form). */
export function formatShort(at: string | Date, tz: string): string {
  return `${shortDay(at, tz)}, ${timeOf(at, tz)} ${zoneLabel(tz)}`;
}

/** "Wednesday, 10 March at 7:00 PM, New York time" (spec 03.7 full form). */
export function formatFull(at: string | Date, tz: string): string {
  const p = parts(at, tz);
  return `${p.weekdayLong}, ${p.day} ${p.monthLong} at ${timeOf(at, tz)}, ${zoneLabel(tz)}`;
}

/** When something happened, for the history list. */
export function formatStamp(at: string | Date, tz: string): string {
  const p = parts(at, tz);
  return `${p.day} ${p.monthShort} ${p.year}, ${timeOf(at, tz)} ${zoneLabel(tz)}`;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekdayShort: string;
  weekdayLong: string;
  monthShort: string;
  monthLong: string;
}

export function parts(at: string | Date, tz: string): Parts {
  const d = new Date(at);
  const get = (list: Intl.DateTimeFormatPart[], type: string) => list.find((x) => x.type === type)?.value ?? '';
  const num = fmt(tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const names = fmt(tz, { weekday: 'long', month: 'long' }).formatToParts(d);
  const shortNames = fmt(tz, { weekday: 'short', month: 'short' }).formatToParts(d);
  const hour = Number(get(num, 'hour'));
  return {
    year: Number(get(num, 'year')),
    month: Number(get(num, 'month')),
    day: Number(get(num, 'day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get(num, 'minute')),
    weekdayLong: get(names, 'weekday'),
    monthLong: get(names, 'month'),
    weekdayShort: get(shortNames, 'weekday'),
    monthShort: get(shortNames, 'month').replace('.', ''),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "yyyy-MM-dd" for an instant, in a zone. */
export function dayKey(at: string | Date, tz: string): string {
  const p = parts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:mm" for an instant, in a zone. */
export function hhmm(at: string | Date, tz: string): string {
  const p = parts(at, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes after midnight for an instant, in a zone. */
export function minutesOf(at: string | Date, tz: string): number {
  const p = parts(at, tz);
  return p.hour * 60 + p.minute;
}

/** Offset of a zone from UTC at an instant, in milliseconds. */
function offsetAt(ms: number, tz: string): number {
  const p = parts(new Date(ms), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(ms / 60_000) * 60_000;
}

/** The instant of a wall time ("2026-12-03", "14:00") in a zone. "24:00" is the next midnight. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let at = guess - offsetAt(guess, tz);
  // Second pass in case the offset differs on the other side of a clock change.
  const second = guess - offsetAt(at, tz);
  if (second !== at) at = second;
  return new Date(at);
}

/** Add days to a "yyyy-MM-dd" date. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** JS weekday of a "yyyy-MM-dd" date (0 = Sunday). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday on or before a date. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** "Mon 7 Dec" for a "yyyy-MM-dd" date. */
export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
}

/** "9:00 AM" for "09:00". */
export function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
}
