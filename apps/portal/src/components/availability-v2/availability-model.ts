/**
 * The availability week — types, time helpers, and the one function that
 * decides what a given date actually shows.
 *
 * PREVIEW ONLY. Nothing in this directory writes. The weekly pattern and the
 * real blocked ranges are READ from the database; every edit an operator makes
 * on the screen lands in React state and is thrown away on reload. That is
 * deliberate — this is a shape to look at and argue with, not a feature. See
 * the docblock in `availability-v2.tsx`.
 *
 * ── Why the resolution lives here rather than in the calendar ────────────────
 *
 * Three things can decide a single day, and they disagree with each other:
 *
 *   1. the tenant's weekly pattern       (`tenants.monday_open` … 21 columns)
 *   2. a real blocked range              (`blocked_dates` rows overlapping it)
 *   3. a one-day exception               (local state, this screen only)
 *
 * The whole point of the screen is that an operator can see WHICH of the three
 * won on any given day. If that precedence were spread through the JSX it would
 * be re-derived slightly differently in the header chip, the column body and
 * the legend, and the three would drift. So it is one pure function with one
 * answer, and the calendar only paints what it is handed.
 */

import { format } from 'date-fns';

/* ────────────────────────────── the week ───────────────────────────────── */

/** Monday-first, matching how the weekly-default panel is read top to bottom. */
export const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

/**
 * `Date.getDay()` is 0 = Sunday, so it cannot index DAY_KEYS directly. This
 * array exists purely so nobody writes `DAY_KEYS[d.getDay() - 1]` and shifts
 * the entire calendar by a day for Sundays.
 */
const DAY_KEY_BY_JS_INDEX: readonly DayKey[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function dayKeyOf(date: Date): DayKey {
  return DAY_KEY_BY_JS_INDEX[date.getDay()];
}

export const DAY_LABEL: Record<DayKey, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export const DAY_SHORT: Record<DayKey, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/** Mon–Fri. Used only by the "apply to weekdays" shortcut. */
export const WEEKDAY_KEYS: readonly DayKey[] = DAY_KEYS.slice(0, 5);

/* ───────────────────────────── time helpers ────────────────────────────── */

/** "HH:mm" → minutes since midnight. Returns 0 for anything unparseable. */
export function toMinutes(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return 0;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

/** minutes since midnight → "HH:mm". */
export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "09:00" → "9:00 AM". The operator-facing form; 24h never reaches the screen. */
export function formatTime(time: string): string {
  const total = toMinutes(time);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "09:00" → "9am" / "9:30am". The compact form, for the hour axis and chips. */
export function formatTimeShort(time: string): string {
  const total = toMinutes(time);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const period = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

/** Every half hour of the day, for the time pickers. 48 entries, 00:00–23:30. */
export const TIME_OPTIONS: readonly string[] = Array.from({ length: 48 }, (_, i) =>
  fromMinutes(i * 30),
);

export function isoOf(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/* ───────────────────────────── the data shapes ─────────────────────────── */

export interface DayHours {
  enabled: boolean;
  /** 24h "HH:mm", exactly as the tenants table stores it. */
  open: string;
  close: string;
}

/** The tenant's weekly pattern — the "global" half of the screen. */
export interface WeeklyDefaults {
  /** `tenants.working_hours_always_open`. When true the day hours are moot. */
  alwaysOpen: boolean;
  timezone: string;
  days: Record<DayKey, DayHours>;
}

/**
 * A one-day override, keyed by ISO date in the screen's state.
 *
 * `closed` and `open` are separate members rather than a nullable pair because
 * "closed" is a decision, not the absence of hours — a day closed by exception
 * still has to be told apart from a day that merely follows a closed default.
 */
export type DayException =
  | { kind: 'closed' }
  | { kind: 'hours'; open: string; close: string };

export type ExceptionMap = Record<string, DayException>;

/** A real `blocked_dates` row, flattened to what the calendar needs. */
export interface RealBlock {
  id: string;
  /** "YYYY-MM-DD", straight off the `date` column — deliberately not parsed. */
  start: string;
  end: string;
  reason: string | null;
  /** A row with no `vehicle_id` closes the whole operation; one with it does not. */
  scope: 'tenant' | 'vehicle';
  vehicleLabel: string | null;
}

/** Which of the three inputs decided this day. Drives the colour and the chip. */
export type DaySource = 'default' | 'exception' | 'blocked-dates';

export interface ResolvedDay {
  date: Date;
  iso: string;
  dayKey: DayKey;
  /** Open for business at all? */
  open: boolean;
  /** Only meaningful when `open`. 24h strings. */
  from: string;
  to: string;
  /** Open around the clock — the tenant's "always open" setting. */
  allDay: boolean;
  source: DaySource;
  /** There is a local exception on this exact date. The at-a-glance signal. */
  overridden: boolean;
  /** Real tenant-wide blocks covering this date. Never local. */
  tenantBlocks: RealBlock[];
  /** Real single-vehicle blocks. These do NOT close the day; they narrow it. */
  vehicleBlocks: RealBlock[];
}

/* ──────────────────────────────── defaults ─────────────────────────────── */

/**
 * What the screen shows before the tenant's own row arrives, and the fallback
 * for a tenant that has never touched working hours (the columns are nullable).
 * Same values the v1 card falls back to, so the two never disagree.
 */
export const FALLBACK_DEFAULTS: WeeklyDefaults = {
  alwaysOpen: true,
  timezone: 'America/Chicago',
  days: {
    monday: { enabled: true, open: '09:00', close: '17:00' },
    tuesday: { enabled: true, open: '09:00', close: '17:00' },
    wednesday: { enabled: true, open: '09:00', close: '17:00' },
    thursday: { enabled: true, open: '09:00', close: '17:00' },
    friday: { enabled: true, open: '09:00', close: '17:00' },
    saturday: { enabled: false, open: '10:00', close: '14:00' },
    sunday: { enabled: false, open: '10:00', close: '14:00' },
  },
};

/* ──────────────────────────────── resolution ───────────────────────────── */

/**
 * Which real blocks cover this date.
 *
 * `blocked_dates.start_date` / `end_date` are Postgres `date` columns and reach
 * us as "YYYY-MM-DD", so a string compare IS a date compare and no timezone can
 * shift it. Parsing them to `Date` first is what produces the classic
 * off-by-one in negative-UTC zones (see lib/date-utils).
 */
export function blocksForDate(iso: string, blocks: RealBlock[]): RealBlock[] {
  return blocks.filter((b) => iso >= b.start && iso <= b.end);
}

/**
 * The one place precedence is decided.
 *
 *   exception  >  blocked_dates  >  weekly default
 *
 * The exception wins over a real block on purpose: an operator sketching next
 * week needs to be able to say "actually we WILL open that Tuesday" and see it,
 * even though a maintenance block currently says otherwise. Nothing is written,
 * so nothing is lost by letting the sketch win on screen — and the real block
 * is still listed under the day, so it never silently disappears.
 */
export function resolveDay(
  date: Date,
  defaults: WeeklyDefaults,
  exceptions: ExceptionMap,
  covering: RealBlock[],
): ResolvedDay {
  const iso = isoOf(date);
  const dayKey = dayKeyOf(date);
  const tenantBlocks = covering.filter((b) => b.scope === 'tenant');
  const vehicleBlocks = covering.filter((b) => b.scope === 'vehicle');

  const base: Omit<ResolvedDay, 'open' | 'from' | 'to' | 'allDay' | 'source' | 'overridden'> = {
    date,
    iso,
    dayKey,
    tenantBlocks,
    vehicleBlocks,
  };

  const exception = exceptions[iso];
  if (exception) {
    if (exception.kind === 'closed') {
      return { ...base, open: false, from: '', to: '', allDay: false, source: 'exception', overridden: true };
    }
    return {
      ...base,
      open: true,
      from: exception.open,
      to: exception.close,
      allDay: false,
      source: 'exception',
      overridden: true,
    };
  }

  if (tenantBlocks.length > 0) {
    return { ...base, open: false, from: '', to: '', allDay: false, source: 'blocked-dates', overridden: false };
  }

  const pattern = defaults.days[dayKey];
  if (defaults.alwaysOpen) {
    return { ...base, open: true, from: '00:00', to: '24:00', allDay: true, source: 'default', overridden: false };
  }
  if (!pattern || !pattern.enabled) {
    return { ...base, open: false, from: '', to: '', allDay: false, source: 'default', overridden: false };
  }
  return {
    ...base,
    open: true,
    from: pattern.open,
    to: pattern.close,
    allDay: false,
    source: 'default',
    overridden: false,
  };
}

/**
 * The vertical range the grid draws, in whole hours.
 *
 * Computed from the week actually on screen rather than fixed at 00:00–24:00,
 * because a tenant open 9–5 would otherwise get sixteen empty hours of grid and
 * one small bar, which reads as a broken calendar. An hour of padding either
 * side leaves room to see that the block starts and ends somewhere.
 */
export function hourWindow(days: ResolvedDay[]): { startHour: number; endHour: number } {
  const openDays = days.filter((d) => d.open);
  if (openDays.length === 0) return { startHour: 8, endHour: 18 };
  if (openDays.some((d) => d.allDay)) return { startHour: 0, endHour: 24 };

  let min = 24 * 60;
  let max = 0;
  for (const d of openDays) {
    min = Math.min(min, toMinutes(d.from));
    max = Math.max(max, toMinutes(d.to));
  }

  let startHour = Math.max(0, Math.floor(min / 60) - 1);
  let endHour = Math.min(24, Math.ceil(max / 60) + 1);

  // Never fewer than eight hours of grid: below that the rows are so tall the
  // thing stops reading as a calendar and starts reading as a bar chart.
  while (endHour - startHour < 8) {
    if (startHour > 0) startHour -= 1;
    else if (endHour < 24) endHour += 1;
    else break;
  }

  return { startHour, endHour };
}
