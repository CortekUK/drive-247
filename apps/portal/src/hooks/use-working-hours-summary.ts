'use client';

import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * Reads the tenant's CONFIGURED working hours (the per-day columns + the 24/7
 * flag that the booking widget actually enforces) and formats them into a
 * public-ready availability string.
 *
 * This powers the opt-in "Use my Working Hours" button on the Website Content →
 * Contact editor, so an operator can push their booking hours into the public
 * availability text in one click — instead of that free-text field silently
 * drifting from the hours they set. It NEVER writes anything and is NEVER
 * applied automatically: the caller decides whether to use `summary`.
 *
 * The formatting mirrors the booking-side buildWeeklySchedule (same defaults,
 * same Mon→Sun grouping) so the previewed string matches what customers are
 * actually restricted to.
 */

type DayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

const DISPLAY_ORDER: DayKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DAY_LABELS: Record<DayKey, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

interface WorkingHoursRow {
  working_hours_always_open: boolean | null;
  monday_enabled: boolean | null;
  monday_open: string | null;
  monday_close: string | null;
  tuesday_enabled: boolean | null;
  tuesday_open: string | null;
  tuesday_close: string | null;
  wednesday_enabled: boolean | null;
  wednesday_open: string | null;
  wednesday_close: string | null;
  thursday_enabled: boolean | null;
  thursday_open: string | null;
  thursday_close: string | null;
  friday_enabled: boolean | null;
  friday_open: string | null;
  friday_close: string | null;
  saturday_enabled: boolean | null;
  saturday_open: string | null;
  saturday_close: string | null;
  sunday_enabled: boolean | null;
  sunday_open: string | null;
  sunday_close: string | null;
}

interface DaySchedule {
  enabled: boolean;
  open: string;
  close: string;
}

/** Format a 24h "HH:mm" (or "HH:mm:ss") string → "9:00 AM". */
function formatTime12(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Mirrors the booking-side buildWeeklySchedule defaults so the preview equals
 * what the customer site enforces (Mon–Fri open 09:00–17:00, Sat/Sun closed).
 */
function buildSchedule(row: WorkingHoursRow): Record<DayKey, DaySchedule> {
  return {
    monday: { enabled: row.monday_enabled ?? true, open: row.monday_open ?? '09:00', close: row.monday_close ?? '17:00' },
    tuesday: { enabled: row.tuesday_enabled ?? true, open: row.tuesday_open ?? '09:00', close: row.tuesday_close ?? '17:00' },
    wednesday: { enabled: row.wednesday_enabled ?? true, open: row.wednesday_open ?? '09:00', close: row.wednesday_close ?? '17:00' },
    thursday: { enabled: row.thursday_enabled ?? true, open: row.thursday_open ?? '09:00', close: row.thursday_close ?? '17:00' },
    friday: { enabled: row.friday_enabled ?? true, open: row.friday_open ?? '09:00', close: row.friday_close ?? '17:00' },
    saturday: { enabled: row.saturday_enabled ?? false, open: row.saturday_open ?? '10:00', close: row.saturday_close ?? '14:00' },
    sunday: { enabled: row.sunday_enabled ?? false, open: row.sunday_open ?? '10:00', close: row.sunday_close ?? '14:00' },
  };
}

/**
 * Build the public availability string from a working-hours row.
 * - 24/7 → "Open 24 hours, 7 days a week"
 * - otherwise → grouped ranges, e.g. "Mon–Fri 8:30 AM – 9:00 PM · Sat 8:15 AM – 7:00 PM"
 * - every day closed → null (nothing sensible to show)
 */
export function buildAvailabilitySummary(row: WorkingHoursRow): string | null {
  if (row.working_hours_always_open ?? true) {
    return 'Open 24 hours, 7 days a week';
  }

  const schedule = buildSchedule(row);

  // Group consecutive days (Mon→Sun) sharing the same open/close (or both closed).
  type Segment = { days: DayKey[]; enabled: boolean; open: string; close: string };
  const segments: Segment[] = [];
  for (const day of DISPLAY_ORDER) {
    const d = schedule[day];
    const prev = segments[segments.length - 1];
    const sameAsPrev =
      !!prev &&
      prev.enabled === d.enabled &&
      (!d.enabled || (prev.open === d.open && prev.close === d.close));
    if (sameAsPrev) {
      prev.days.push(day);
    } else {
      segments.push({ days: [day], enabled: d.enabled, open: d.open, close: d.close });
    }
  }

  const openSegments = segments.filter((s) => s.enabled);
  if (openSegments.length === 0) return null;

  // All seven days open with identical hours → friendlier phrasing.
  if (openSegments.length === 1 && openSegments[0].days.length === 7) {
    const s = openSegments[0];
    return `Open every day, ${formatTime12(s.open)} – ${formatTime12(s.close)}`;
  }

  return openSegments
    .map((s) => {
      const label =
        s.days.length === 1
          ? DAY_LABELS[s.days[0]]
          : `${DAY_LABELS[s.days[0]]}–${DAY_LABELS[s.days[s.days.length - 1]]}`;
      return `${label} ${formatTime12(s.open)} – ${formatTime12(s.close)}`;
    })
    .join(' · ');
}

export function useWorkingHoursSummary() {
  const { tenant } = useTenant();

  // Same queryKey + column set as WorkingHoursCard, so the two share React
  // Query's cache and this incurs no extra fetch when either is mounted.
  const { data, isLoading } = useQuery({
    queryKey: ['working-hours', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;
      const { data, error } = await supabase
        .from('tenants')
        .select(`
          working_hours_always_open,
          timezone,
          monday_enabled, monday_open, monday_close,
          tuesday_enabled, tuesday_open, tuesday_close,
          wednesday_enabled, wednesday_open, wednesday_close,
          thursday_enabled, thursday_open, thursday_close,
          friday_enabled, friday_open, friday_close,
          saturday_enabled, saturday_open, saturday_close,
          sunday_enabled, sunday_open, sunday_close
        `)
        .eq('id', tenant.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!tenant?.id,
  });

  const summary = data ? buildAvailabilitySummary(data as WorkingHoursRow) : null;

  return {
    summary,
    isAlwaysOpen: (data?.working_hours_always_open ?? true) as boolean,
    isLoading,
  };
}
