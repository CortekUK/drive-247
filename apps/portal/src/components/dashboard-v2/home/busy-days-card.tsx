'use client';

/**
 * Busy days — how full the fleet was, day by day, over three months
 * (Sep 27 2026). A heatmap, deliberately NOT the GitHub strip (Ghulam: "it is
 * in people's mind too much"): three real month calendars side by side, each
 * day a soft rounded tile carrying its date, filled deeper indigo the more of
 * the fleet was out. Hover a day for the exact figure.
 *
 * Above the calendars, three plain highlights: the busiest day, the quietest
 * day of the week, and the average.
 *
 * "Busy" is cars out on rent that day ÷ cars in the fleet (useBusyDays).
 */

import { useEffect, useMemo, useRef } from 'react';
import { format, getDay, parseISO } from 'date-fns';
import type { BusyDays } from '@/hooks/use-dashboard-insights';
import { Eyebrow } from './ui';
import { buildDemoBusyDays } from './mock';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** A day's fill: paper at 0%, the full accent at 100%, a visible tint even when quiet. */
function fill(share: number): string {
  const pct = Math.round(6 + share * 88);
  return `color-mix(in srgb, var(--pv-accent) ${pct}%, var(--pv-paper))`;
}

function Month({
  month,
  byDate,
  fleet,
  today,
}: {
  month: Date;
  byDate: Map<string, number>;
  fleet: number;
  today: string;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const daysIn = new Date(year, m + 1, 0).getDate();
  // Monday-first: how many blank tiles before the 1st.
  const lead = (getDay(new Date(year, m, 1)) + 6) % 7;

  return (
    <div className="min-w-0 max-sm:w-full max-sm:shrink-0 max-sm:snap-center">
      <p className="mb-2 text-[13px] font-semibold text-[var(--pv-ink)]">{format(month, 'MMMM')}</p>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pb-0.5 text-center text-[10px] font-medium text-[var(--pv-ink-3)]">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: daysIn }, (_, i) => {
          const date = format(new Date(year, m, i + 1), 'yyyy-MM-dd');
          const rented = byDate.get(date);
          const future = date > today;
          if (future || rented === undefined) {
            return (
              <span
                key={date}
                className="flex aspect-square items-center justify-center rounded-md border border-dashed border-[var(--pv-line)] text-[10px] tabular-nums text-[var(--pv-ink-3)] opacity-60"
              >
                {i + 1}
              </span>
            );
          }
          const share = fleet ? Math.min(1, rented / fleet) : 0;
          return (
            <span
              key={date}
              title={`${format(parseISO(date), 'EEE d MMM')} · ${rented} of ${fleet} cars out · ${Math.round(share * 100)}%`}
              className="flex aspect-square cursor-default items-center justify-center rounded-md text-[10px] font-medium tabular-nums transition-transform hover:scale-110"
              style={{
                background: fill(share),
                color: share > 0.55 ? 'var(--pv-on-accent)' : 'var(--pv-ink-2)',
                outline: date === today ? '2px solid var(--pv-ink)' : undefined,
                outlineOffset: date === today ? 1 : undefined,
              }}
            >
              {i + 1}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function BusyDaysCard({ data: loadedData, isLoading }: { data: BusyDays | null; isLoading: boolean }) {
  // While loading, the sample heatmap stands in, so the skeleton has the
  // loaded card's exact shape (highlights row, three month grids).
  const placeholder = useMemo(() => buildDemoBusyDays(), []);
  const data = isLoading ? placeholder : loadedData;

  // On a phone the months scroll sideways; start on the latest one.
  const monthsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = monthsRef.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;
  }, [data]);

  const view = useMemo(() => {
    if (!data || !data.days.length) return null;
    const byDate = new Map(data.days.map((d) => [d.date, d.rented]));
    const share = (n: number) => (data.fleet ? n / data.fleet : 0);

    const busiest = data.days.reduce((a, b) => (b.rented > a.rented ? b : a));
    const avg = data.days.reduce((s, d) => s + share(d.rented), 0) / data.days.length;

    // Quietest day of the week, by its average share.
    const byWeekday = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (const d of data.days) {
      const w = getDay(parseISO(d.date));
      byWeekday[w].sum += share(d.rented);
      byWeekday[w].n += 1;
    }
    const quietest = byWeekday
      .map((w, i) => ({ i, avg: w.n ? w.sum / w.n : 1 }))
      .reduce((a, b) => (b.avg < a.avg ? b : a));

    const first = parseISO(data.days[0].date);
    const months = [0, 1, 2].map((k) => new Date(first.getFullYear(), first.getMonth() + k, 1));
    return { byDate, busiest, avg, quietest, months, share };
  }, [data]);

  return (
    <div className="flex flex-col rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] p-6 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Busy days</Eyebrow>
          <p className="mt-1 text-[12px] text-[var(--pv-ink-3)]">How much of the fleet was out, day by day</p>
        </div>
        {/* The scale, quiet to busy. */}
        <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--pv-ink-3)]">
          Quiet
          {[0, 0.25, 0.5, 0.75, 1].map((s) => (
            <span key={s} className="size-3 rounded-[4px]" style={{ background: fill(s) }} />
          ))}
          Busy
        </div>
      </div>

      {!view || !data ? (
        <div aria-hidden="true" className="mt-5 h-[220px] animate-pulse rounded-xl bg-[var(--pv-wash)] motion-reduce:animate-none" />
      ) : (
        <AutoSkeleton loading={isLoading}>
          {/* Three plain highlights. */}
          <dl className="mt-5 grid grid-cols-3 gap-3 border-b border-[var(--pv-line)] pb-5 sm:gap-4">
            <div>
              <dt className="text-[11px] text-[var(--pv-ink-3)]">Busiest day</dt>
              <dd className="mt-1 text-[13px] font-semibold leading-snug text-[var(--pv-ink)] sm:text-[15px]">
                {format(parseISO(view.busiest.date), 'EEE d MMM')}
                <span className="ml-1.5 text-[12px] font-medium text-[var(--pv-accent-ink)]">
                  {Math.round(view.share(view.busiest.rented) * 100)}%
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--pv-ink-3)]">Quietest</dt>
              <dd className="mt-1 text-[13px] font-semibold leading-snug text-[var(--pv-ink)] sm:text-[15px]">{WEEKDAY_NAMES[view.quietest.i]}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--pv-ink-3)]">On average</dt>
              <dd className="mt-1 text-[13px] font-semibold leading-snug text-[var(--pv-ink)] sm:text-[15px]">
                {Math.round(view.avg * 100)}% <span className="text-[12px] font-normal text-[var(--pv-ink-3)]">of the fleet out</span>
              </dd>
            </div>
          </dl>

          {/* Three months side by side; on a phone, one month per screen,
              swiped sideways and opening on the current month. */}
          <div
            ref={monthsRef}
            className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-3 max-sm:flex max-sm:snap-x max-sm:snap-mandatory max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden"
          >
            {view.months.map((month) => (
              <Month key={month.toISOString()} month={month} byDate={view.byDate} fleet={data.fleet} today={data.today} />
            ))}
          </div>
        </AutoSkeleton>
      )}
    </div>
  );
}
