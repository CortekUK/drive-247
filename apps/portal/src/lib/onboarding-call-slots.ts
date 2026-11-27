/**
 * Bryan's calendar as the portal reads it (`get_onboarding_call_calendar`),
 * and the "Add to calendar" links for a booked call (feat-001 spec 07.24).
 *
 * The free times are worked out on the server only (spec 02): the page shows
 * the instants it is given, in the person's zone (`onboarding-call-time.ts`).
 */

export interface CallCalendar {
  host_name: string;
  host_title: string;
  host_photo_url: string;
  duration_minutes: number;
  /** Bryan's time zone. */
  timezone: string;
  max_days_ahead: number;
  is_accepting: boolean;
  /** Only once the caller has a booking. */
  meeting_url: string | null;
  /** Every free start, ISO, earliest first. */
  slots: string[];
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
  customer_timezone: string | null;
  ics_token: string | null;
  /** Its time has passed and Bryan has not marked it yet. */
  waiting: boolean;
}

/** Weekdays 9 to 5 New York for the next week. Only for a /fake-quick-tour run with no calendar. */
function fakeSlots(): string[] {
  const out: string[] = [];
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  for (let i = 1; out.length < 80 && i < 14; i++) {
    const d = new Date(day.getTime() + i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    for (let m = 14 * 60; m < 22 * 60; m += 30) out.push(new Date(d.getTime() + m * 60_000).toISOString());
  }
  return out;
}

export const DEFAULT_CALL_CALENDAR: CallCalendar = {
  host_name: 'Bryan Diaz',
  host_title: 'Onboarding specialist',
  host_photo_url: '/team/bryan.jpg',
  duration_minutes: 30,
  timezone: 'America/New_York',
  max_days_ahead: 30,
  is_accepting: true,
  meeting_url: null,
  get slots() {
    return fakeSlots();
  },
  mine: null,
};

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** A Google Calendar "add event" link. */
export function googleCalendarUrl(b: { starts_at: string; ends_at: string }, title: string, details: string, location?: string | null): string {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${stamp(b.starts_at)}/${stamp(b.ends_at)}`, details });
  if (location) q.set('location', location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** An Outlook "add event" link. */
export function outlookCalendarUrl(b: { starts_at: string; ends_at: string }, title: string, details: string, location?: string | null): string {
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: new Date(b.starts_at).toISOString(),
    enddt: new Date(b.ends_at).toISOString(),
    body: details,
  });
  if (location) q.set('location', location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q.toString()}`;
}

/**
 * The call's own .ics, served as text/calendar. Opening a real address is what
 * an iPhone needs: Safari ignores a `download` data link.
 */
export function icsUrl(token: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!token || !base) return null;
  return `${base.replace(/\/+$/, '')}/functions/v1/onboarding-call-ics?t=${encodeURIComponent(token)}`;
}
