import { Clock } from 'lucide-react-nw';
import { cache } from 'react';

import { supabase } from '@nw/integrations/supabase/client';
import { getTenantSlug } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';

/**
 * Northwind booking site v2 — when a renter can collect or return a car, on
 * /contact. These are the operator's own Working Hours (portal → Blocked
 * dates → Working Hours), the same schedule the booking flow limits pickup
 * and drop-off times to, so the page can never promise a time the booking
 * form refuses.
 *
 * Days with the same hours run together ("Tuesday – Friday"), a closed day
 * says so, today's row is marked (in the operator's time zone), and the zone
 * is named once under the list. "Always open" is one line. If the schedule
 * cannot be read, the card is left out rather than guessed at.
 */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = (typeof DAYS)[number];
const LABEL: Record<Day, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

type Row = Record<`${Day}_enabled`, boolean | null> &
  Record<`${Day}_open` | `${Day}_close`, string | null> & {
    working_hours_always_open: boolean | null;
    timezone: string | null;
  };

export type HoursGroup = { days: string; hours: string | null; today: boolean };
export type OpeningHours = { alwaysOpen: boolean; groups: HoursGroup[]; zone: string | null };

/** "06:00:00" → "6am", "17:30" → "5:30pm". */
function clock(value: string | null): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const h = Number(match[1]);
  const m = match[2];
  const suffix = h < 12 || h === 24 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === '00' ? '' : `:${m}`}${suffix}`;
}

/** "Eastern Time" — the zone's everyday name, when the runtime knows it. */
function zoneName(timezone: string | null): string | null {
  if (!timezone) return null;
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

function todayIn(timezone: string | null): Day | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone ?? undefined, weekday: 'long' })
      .format(new Date())
      .toLowerCase();
    return (DAYS as readonly string[]).includes(name) ? (name as Day) : null;
  } catch {
    return null;
  }
}

export const loadOpeningHours = cache(async (): Promise<OpeningHours | null> => {
  const slug = await getTenantSlug();
  if (!slug) return null;

  const columns = [
    'working_hours_always_open',
    'timezone',
    ...DAYS.flatMap((day) => [`${day}_enabled`, `${day}_open`, `${day}_close`]),
  ].join(', ');

  try {
    const { data, error } = await supabase
      .from('tenants')
      .select(columns)
      .eq('slug', slug)
      .maybeSingle()
      .overrideTypes<Row, { merge: false }>();
    if (error || !data) return null;

    const zone = zoneName(data.timezone);
    if (data.working_hours_always_open) return { alwaysOpen: true, groups: [], zone };

    const today = todayIn(data.timezone);
    const hoursOf = (day: Day): string | null => {
      if (data[`${day}_enabled`] === false) return null;
      const open = clock(data[`${day}_open`]);
      const close = clock(data[`${day}_close`]);
      return open && close ? `${open} – ${close}` : null;
    };

    const groups: HoursGroup[] = [];
    let start = 0;
    for (let i = 1; i <= DAYS.length; i++) {
      if (i < DAYS.length && hoursOf(DAYS[i]) === hoursOf(DAYS[start])) continue;
      const run = DAYS.slice(start, i);
      groups.push({
        days: run.length === 1 ? LABEL[run[0]] : `${LABEL[run[0]]} – ${LABEL[run[run.length - 1]]}`,
        hours: hoursOf(DAYS[start]),
        today: today !== null && run.includes(today),
      });
      start = i;
    }
    return { alwaysOpen: false, groups, zone };
  } catch {
    return null;
  }
});

export function OpeningHoursCard({ hours, className }: { hours: OpeningHours; className?: string }) {
  return (
    <div className={cn('rounded-2xl bg-pv-tint p-6 sm:p-7', className)}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-pv-card text-pv-primary">
          <Clock aria-hidden className="size-[18px]" strokeWidth={2} />
        </span>
        <h2 className="text-[20px] font-extrabold tracking-[-0.03em] text-pv-fg md:text-[22px]">Pickup and return hours</h2>
      </div>
      <p className="mt-3 text-[14.5px] leading-relaxed text-pv-muted-on-tint">
        You can collect and return a car during these hours.
      </p>

      {hours.alwaysOpen ? (
        <p className="mt-5 text-[16px] font-semibold text-pv-fg">Every day, any time</p>
      ) : (
        <dl className="mt-5 divide-y divide-pv-primary/10">
          {hours.groups.map((group) => (
            <div key={group.days} className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
              <dt className={cn('text-pv-fg', group.today && 'font-semibold')}>
                {group.days}
                {group.today ? (
                  <span className="ml-2 rounded-full bg-pv-card px-2 py-0.5 text-[12px] font-semibold text-pv-primary dark:text-pv-fg">
                    Today
                  </span>
                ) : null}
              </dt>
              <dd
                className={cn(
                  'shrink-0 tabular-nums',
                  group.hours ? 'font-semibold text-pv-fg' : 'text-pv-muted-on-tint',
                )}
              >
                {group.hours ?? 'Closed'}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {hours.zone ? <p className="mt-4 text-[13px] text-pv-muted-on-tint">All times are {hours.zone}.</p> : null}
    </div>
  );
}
