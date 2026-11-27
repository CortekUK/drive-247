'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { db, errorText, type Block, type CallRow, type Settings } from './shared';
import { addDays, clockLabel, dateLabel, dayKey, minutesOf, mondayOf, timeOf, weekdayOf, zonedToUtc, zoneLabel } from './time';

const PX = 0.8; // pixels per minute
const mins = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/** Monday to Sunday in Bryan's zone (spec 10.13, 10.14). */
export function WeekTab({
  settings,
  blocks,
  week,
  onWeek,
  version,
  onOpen,
}: {
  settings: Settings;
  blocks: Block[];
  week: string;
  onWeek: (monday: string) => void;
  version: number;
  onOpen: (id: string) => void;
}) {
  const tz = settings.timezone;
  const today = dayKey(new Date(), tz);
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : mondayOf(today);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const ask = useRef(0);

  useEffect(() => {
    const mine = ++ask.current;
    void (async () => {
      const { data, error } = await db.rpc('admin_list_onboarding_calls', {
        p_view: 'all',
        p_from: days[0],
        p_to: days[6],
        p_search: null,
        p_limit: 100,
        p_offset: 0,
      });
      if (mine !== ask.current) return;
      if (error) {
        toast.error(errorText(error));
        setCalls([]);
        return;
      }
      setCalls(((data as { rows: CallRow[] }).rows ?? []).filter((r) => r.status !== 'cancelled'));
    })();
  }, [days, version]);

  // Rows from an hour before his earliest start to an hour after his latest end.
  const [startMin, endMin] = useMemo(() => {
    let lo = 9 * 60;
    let hi = 17 * 60;
    for (const ws of Object.values(settings.weekly_hours)) {
      for (const [a, b] of ws) {
        lo = Math.min(lo, mins(a));
        hi = Math.max(hi, b === '24:00' ? 1440 : mins(b));
      }
    }
    for (const c of calls ?? []) {
      lo = Math.min(lo, minutesOf(c.starts_at, tz));
      hi = Math.max(hi, minutesOf(c.starts_at, tz) + 60);
    }
    return [Math.max(0, Math.floor(lo / 60) * 60 - 60), Math.min(1440, Math.ceil(hi / 60) * 60 + 60)];
  }, [settings.weekly_hours, calls, tz]);

  const height = (endMin - startMin) * PX;
  const hours = Array.from({ length: (endMin - startMin) / 60 }, (_, i) => startMin + i * 60);
  const y = (m: number) => (Math.min(Math.max(m, startMin), endMin) - startMin) * PX;

  const blockParts = (day: string) => {
    const from = zonedToUtc(day, '00:00', tz).getTime();
    const to = zonedToUtc(addDays(day, 1), '00:00', tz).getTime();
    return blocks.flatMap((b) => {
      const s = Math.max(new Date(b.starts_at).getTime(), from);
      const e = Math.min(new Date(b.ends_at).getTime(), to);
      if (e <= s) return [];
      return [{ top: minutesOf(new Date(s), tz), bottom: e >= to ? 1440 : minutesOf(new Date(e), tz), label: b.label }];
    });
  };

  const nowMin = minutesOf(new Date(), tz);
  const range = `${dateLabel(days[0], { day: 'numeric', month: 'long' })} to ${dateLabel(days[6], { day: 'numeric', month: 'long', year: 'numeric' })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {range} <span className="font-normal text-muted-foreground">· {zoneLabel(tz)}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous week" onClick={() => onWeek(addDays(monday, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onWeek('')}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next week" onClick={() => onWeek(addDays(monday, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend className="bg-primary/10 ring-1 ring-primary/20">Your hours</Legend>
        <Legend className="bg-indigo-600">Booked call</Legend>
        <Legend className="bg-green-600/70">Done</Legend>
        <Legend className="bg-red-500/70">Missed</Legend>
        <Legend className="bg-[repeating-linear-gradient(45deg,hsl(var(--muted-foreground)/0.25)_0_4px,transparent_4px_8px)] ring-1 ring-border">
          Blocked or day off
        </Legend>
      </div>

      <div className="overflow-x-auto rounded-4xl bg-card ring-1 ring-foreground/10">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b">
            <div />
            {days.map((d) => {
              const off = settings.blocked_dates.includes(d) || !(settings.weekly_hours[String(weekdayOf(d))]?.length);
              return (
                <div key={d} className={cn('border-l px-2 py-2 text-center', d === today && 'bg-primary/5')}>
                  <p className={cn('text-xs font-semibold', d === today ? 'text-primary' : 'text-foreground')}>{dateLabel(d)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {settings.blocked_dates.includes(d) ? 'Day off' : off ? 'Not working' : ' '}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
            <div className="relative" style={{ height }}>
              {hours.map((h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: y(h) }}>
                  {h === startMin ? '' : clockLabel(`${String(h / 60).padStart(2, '0')}:00`).replace(':00', '')}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const dayOff = settings.blocked_dates.includes(d);
              const windows = settings.weekly_hours[String(weekdayOf(d))] ?? [];
              return (
                <div key={d} className="relative border-l" style={{ height }}>
                  {hours.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: y(h) }} />
                  ))}
                  {!dayOff &&
                    windows.map(([a, b], i) => (
                      <div
                        key={i}
                        className="absolute inset-x-0 bg-primary/10"
                        style={{ top: y(mins(a)), height: y(b === '24:00' ? 1440 : mins(b)) - y(mins(a)) }}
                      />
                    ))}
                  {dayOff && (
                    <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,hsl(var(--muted-foreground)/0.18)_0_4px,transparent_4px_8px)]" />
                  )}
                  {blockParts(d).map((p, i) => (
                    <div
                      key={i}
                      className="absolute inset-x-0.5 overflow-hidden rounded-md bg-[repeating-linear-gradient(45deg,hsl(var(--muted-foreground)/0.25)_0_4px,transparent_4px_8px)] px-1 ring-1 ring-border"
                      style={{ top: y(p.top), height: Math.max(y(p.bottom) - y(p.top), 12) }}
                      title={p.label ?? 'Blocked'}
                    >
                      <span className="text-[10px] font-medium text-muted-foreground">{p.label || 'Blocked'}</span>
                    </div>
                  ))}
                  {d === today && nowMin >= startMin && nowMin <= endMin && (
                    <div className="absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: y(nowMin) }} />
                  )}
                  {(calls ?? [])
                    .filter((c) => dayKey(c.starts_at, tz) === d)
                    .map((c) => {
                      const top = minutesOf(c.starts_at, tz);
                      const len = (new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime()) / 60_000;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onOpen(c.id)}
                          className={cn(
                            'absolute inset-x-1 z-20 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-white',
                            c.status === 'booked' && 'bg-indigo-600 hover:bg-indigo-700',
                            c.status === 'completed' && 'bg-green-600/70 hover:bg-green-600',
                            c.status === 'missed' && 'bg-red-500/70 hover:bg-red-500',
                          )}
                          style={{ top: y(top), height: Math.max(len * PX, 18) }}
                          title={`${timeOf(c.starts_at, tz)} ${c.company_name ?? ''}`}
                        >
                          <span className="block font-semibold tabular-nums">{timeOf(c.starts_at, tz)}</span>
                          <span className="block truncate">{c.company_name || c.slug}</span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {calls === null && <p className="text-xs text-muted-foreground">Loading the week</p>}
    </div>
  );
}

function Legend({ className, children }: { className: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-3 w-3 rounded-sm', className)} />
      {children}
    </span>
  );
}
