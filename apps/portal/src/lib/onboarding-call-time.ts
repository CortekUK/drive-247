/**
 * How an onboarding call's time is written for the person looking at it
 * (feat-001 spec 03). The same functions as the emails'
 * (supabase/functions/_shared/onboarding-call-time.ts); one Vitest table
 * checks both, so they cannot drift.
 *
 * The zone is the device's own, unless the person picked another with
 * "change" (kept on this device). The calendar, the booked screen and the
 * sidebar card all read it from here, so one call reads the same everywhere.
 */

function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "Asia/Karachi" is "Karachi time", "UTC" is "UTC". */
export function zoneLabel(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  if (tz === 'UTC' || tz === 'Etc/UTC' || tz === 'Etc/GMT') return 'UTC';
  if (!isZone(tz)) return tz;
  const city = tz.split('/').pop() ?? tz;
  return `${city.replace(/_/g, ' ')} time`;
}

function parts(at: Date | string, tz: string) {
  const d = typeof at === 'string' ? new Date(at) : at;
  const zone = isZone(tz) ? tz : 'UTC';
  const get = (o: Intl.DateTimeFormatOptions) => {
    const p = new Intl.DateTimeFormat('en-US', { ...o, timeZone: zone }).formatToParts(d);
    return Object.fromEntries(p.map((x) => [x.type, x.value])) as Record<string, string>;
  };
  const a = get({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const s = get({ weekday: 'short', month: 'short' });
  const t = get({ hour: 'numeric', minute: '2-digit', hour12: true });
  return {
    weekday: a.weekday,
    weekdayShort: s.weekday,
    day: a.day,
    month: a.month,
    monthShort: s.month,
    year: a.year,
    time: `${t.hour}:${t.minute} ${(t.dayPeriod ?? '').toUpperCase()}`,
  };
}

/** "7:00 PM" */
export function formatSlotTime(at: Date | string, tz: string): string {
  return parts(at, tz).time;
}

/** "Wednesday, 10 March at 7:00 PM, Karachi time" */
export function formatCallFull(at: Date | string, tz: string): string {
  const p = parts(at, tz);
  return `${p.weekday}, ${p.day} ${p.month} at ${p.time}, ${zoneLabel(tz)}`;
}

/** "Wed 10 Mar, 7:00 PM Karachi time" */
export function formatCallShort(at: Date | string, tz: string): string {
  const p = parts(at, tz);
  return `${p.weekdayShort} ${p.day} ${p.monthShort}, ${p.time} ${zoneLabel(tz)}`;
}

/** "Tue 8 Dec", the heading of a day's times. */
export function formatDayHeading(at: Date | string, tz: string): string {
  const p = parts(at, tz);
  return `${p.weekdayShort} ${p.day} ${p.monthShort}`;
}

/** "2026-12-08", the day in that zone. */
export function dayKey(at: Date | string, tz: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: isZone(tz) ? tz : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** The device's own zone, e.g. "Asia/Karachi". */
export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const KEY = 'd247:onboarding-call-zone';
export const ZONE_CHANGED_EVENT = 'd247:onboarding-call-zone';

/** The zone picked with "change" on this device, else the device's own. */
export function getChosenZone(): string {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v && isZone(v)) return v;
  } catch {
    // Storage blocked: the device's zone.
  }
  return deviceZone();
}

export function setChosenZone(tz: string | null): void {
  try {
    if (!tz || tz === deviceZone()) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, tz);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(ZONE_CHANGED_EVENT));
}

/** Every zone the browser knows, for the "change" list. */
export function allZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    // Older browsers: the short list below.
  }
  return [
    'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto',
    'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Lagos', 'Africa/Johannesburg',
    'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
    'Pacific/Auckland', 'Pacific/Honolulu',
  ];
}
