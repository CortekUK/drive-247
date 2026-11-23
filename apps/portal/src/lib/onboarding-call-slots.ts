import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Bryan's free slots for the onboarding call, worked out in the browser from
 * his settings (`get_onboarding_call_calendar`). Pure, so it can be tested
 * without a page.
 *
 * His hours are in HIS time zone; every slot is returned as a real instant
 * (a Date), so the page shows it in the viewer's own time zone. The server
 * checks every booking against the same rules (`book_onboarding_call`), so a
 * slot shown here that is taken a second later is refused there, not booked
 * twice.
 */

export interface CallCalendar {
  host_name: string;
  host_title: string;
  host_photo_url: string;
  duration_minutes: number;
  buffer_minutes: number;
  /** Bryan's time zone; `weekly_hours` and `blocked_dates` are in it. */
  timezone: string;
  /** JS day ("0" = Sunday) → [["09:00", "17:00"], ...]. A missing day is a day off. */
  weekly_hours: Record<string, [string, string][]>;
  /** Whole days off, "yyyy-MM-dd" in Bryan's time zone. */
  blocked_dates: string[];
  min_notice_hours: number;
  max_days_ahead: number;
  is_accepting: boolean;
  /** Only once the caller has a booking. */
  meeting_url: string | null;
  /** Other companies' booked calls: [start, end] ISO strings. */
  busy: [string, string][];
  /** The caller's own live booking, if any. */
  mine: CallBooking | null;
}

export interface CallBooking {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  starts_at: string;
  ends_at: string;
}

/**
 * The calendar as it stands before Bryan has changed anything: weekdays,
 * 9 to 5 New York time, 30 minutes. Used only on a /fake-quick-tour run when
 * the database has no calendar yet, so the booking screens can still be seen.
 */
export const DEFAULT_CALL_CALENDAR: CallCalendar = {
  host_name: 'Bryan Diaz',
  host_title: 'Onboarding specialist',
  host_photo_url: '/team/bryan.jpg',
  duration_minutes: 30,
  buffer_minutes: 0,
  timezone: 'America/New_York',
  weekly_hours: {
    '1': [['09:00', '17:00']],
    '2': [['09:00', '17:00']],
    '3': [['09:00', '17:00']],
    '4': [['09:00', '17:00']],
    '5': [['09:00', '17:00']],
  },
  blocked_dates: [],
  min_notice_hours: 12,
  max_days_ahead: 30,
  is_accepting: true,
  meeting_url: null,
  busy: [],
  mine: null,
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** Every bookable start, earliest first. */
export function buildSlots(cal: CallCalendar, now: Date = new Date()): Date[] {
  if (!cal.is_accepting) return [];
  const step = cal.duration_minutes;
  const earliest = now.getTime() + cal.min_notice_hours * 3_600_000;
  const latest = now.getTime() + cal.max_days_ahead * 86_400_000;
  const buffer = cal.buffer_minutes * 60_000;
  const busy = cal.busy.map(([s, e]) => [new Date(s).getTime() - buffer, new Date(e).getTime() + buffer] as const);
  const blocked = new Set(cal.blocked_dates);

  // Walk Bryan's own calendar days, starting from his today.
  const hostToday = parseISO(formatInTimeZone(now, cal.timezone, 'yyyy-MM-dd'));
  const out: Date[] = [];
  for (let i = 0; i <= cal.max_days_ahead + 1; i++) {
    const day = format(addDays(hostToday, i), 'yyyy-MM-dd');
    if (blocked.has(day)) continue;
    const dow = String(new Date(`${day}T12:00:00Z`).getUTCDay());
    for (const [from, to] of cal.weekly_hours[dow] ?? []) {
      const end = toMinutes(to);
      for (let t = toMinutes(from); t + step <= end; t += step) {
        const start = fromZonedTime(`${day}T${toHHMM(t)}:00`, cal.timezone);
        const s = start.getTime();
        const e = s + step * 60_000;
        if (s < earliest || s > latest) continue;
        if (busy.some(([bs, be]) => s < be && e > bs)) continue;
        out.push(start);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The viewer's own time zone, e.g. "Asia/Karachi". */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Slots grouped by the viewer's local day ("yyyy-MM-dd"). */
export function slotsByDay(slots: Date[], timeZone: string): Map<string, Date[]> {
  const map = new Map<string, Date[]>();
  for (const s of slots) {
    const key = formatInTimeZone(s, timeZone, 'yyyy-MM-dd');
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return map;
}

/** "Wednesday, 26 November at 3:00 PM", in the given time zone. */
export function formatCallWhen(at: Date | string, timeZone: string): string {
  return formatInTimeZone(typeof at === 'string' ? new Date(at) : at, timeZone, "EEEE, d MMMM 'at' h:mm a");
}

/** A Google Calendar "add event" link for the booked call. */
export function googleCalendarUrl(b: { starts_at: string; ends_at: string }, title: string, details: string): string {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${stamp(b.starts_at)}/${stamp(b.ends_at)}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** An .ics file for Apple Calendar and Outlook, as a download URL. */
export function icsDataUrl(b: { id: string; starts_at: string; ends_at: string }, title: string, details: string): string {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Drive247//Onboarding call//EN',
    'BEGIN:VEVENT',
    `UID:${b.id}@drive247.com`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.starts_at)}`,
    `DTEND:${stamp(b.ends_at)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(details)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}
