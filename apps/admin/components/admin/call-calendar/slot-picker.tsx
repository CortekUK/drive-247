'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { db, errorText } from './shared';
import { dayKey, dateLabel, timeOf, zoneLabel } from './time';

/**
 * Bryan's free times without notice (spec 05.12), in his zone, with the
 * company's time beside each one.
 */
export function SlotPicker({
  hostTz,
  companyTz,
  exclude,
  value,
  onChange,
}: {
  hostTz: string;
  companyTz: string | null;
  exclude: string | null;
  value: string | null;
  onChange: (at: string) => void;
}) {
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSlots(null);
    setError(null);
    void (async () => {
      const { data, error: e } = await db.rpc('admin_onboarding_call_free_slots', { p_exclude: exclude });
      if (!live) return;
      if (e) {
        setError(errorText(e));
        setSlots([]);
        return;
      }
      setSlots(((data ?? []) as string[]).map((s) => new Date(s).toISOString()));
    })();
    return () => {
      live = false;
    };
  }, [exclude]);

  const byDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of slots ?? []) {
      const key = dayKey(s, hostTz);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [slots, hostTz]);

  const days = [...byDay.keys()];
  const shownDay = day && byDay.has(day) ? day : value ? dayKey(value, hostTz) : days[0] ?? null;
  const times = shownDay ? byDay.get(shownDay) ?? [] : [];
  const showCompany = companyTz && companyTz !== hostTz;

  if (slots === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Finding free times
      </div>
    );
  }
  if (error) return <p className="py-4 text-sm text-destructive">{error}</p>;
  if (days.length === 0) return <p className="py-4 text-sm text-muted-foreground">No free times in the booking window.</p>;

  return (
    <div className="min-w-0 space-y-3">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDay(d)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              d === shownDay
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
            )}
          >
            {dateLabel(d)}
          </button>
        ))}
      </div>
      {shownDay && (
        <p className="text-xs font-medium text-muted-foreground">
          {dateLabel(shownDay)} · {zoneLabel(hostTz)}
          {showCompany && <> (the company&apos;s time beside each, {zoneLabel(companyTz)})</>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {times.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={value === s}
            className={cn(
              'rounded-xl border px-2 py-2 text-left text-sm transition-colors',
              value === s
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:border-primary/40 hover:bg-primary/5',
            )}
          >
            <span className="block font-medium tabular-nums">{timeOf(s, hostTz)}</span>
            {showCompany && (
              <span className="block text-[11px] text-muted-foreground tabular-nums">
                {dayKey(s, companyTz) !== dayKey(s, hostTz) && `${dateLabel(dayKey(s, companyTz), { weekday: 'short' })} `}
                {timeOf(s, companyTz)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
