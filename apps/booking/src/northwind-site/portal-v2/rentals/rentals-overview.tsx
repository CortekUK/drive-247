'use client';

/**
 * The Rentals overview slot: the Calendar view card.
 *
 * The slot held the operator's graph (booked value) until Oct 21 2026, when
 * the owner took it out — a customer's few rentals a year do not make a graph
 * worth reading. The calendar is what a customer actually opens from here, so
 * it gets the whole slot: the card is one button, the heading and line on the
 * left, and on the right a four-week preview of the customer's own rentals
 * drawn as the calendar draws them, so the card says what it opens before it
 * is pressed.
 *
 * The preview reads the same rentals as the table (search and filters
 * applied), so the two can never disagree. The filter panel is still this
 * slot's back face (shared overview-flip), turned by the top bar's button.
 */

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react-nw';

import type { CustomerRental } from '@nw/hooks/use-customer-rentals';
import { FEATURED_SHELL_CLASS } from '@portal-v2-shared/featured-card';
import { cn } from '@nw/lib/utils';

import { customerRentalStatus } from './rentals-table';

/** The preview's window: from three days ago, four weeks long. */
const WINDOW_DAYS = 28;
const LEAD_DAYS = 3;
const MAX_ROWS = 3;
const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' as local midnight. Never `new Date(str)`, which reads UTC. */
function localDay(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

interface PreviewBar {
  id: string;
  label: string;
  /** Percent of the window, clamped to it. */
  left: number;
  width: number;
  done: boolean;
}

export function RentalsOverview({
  rentals,
  filtered,
  isLoading,
  onOpenCalendar,
}: {
  /** The rentals the list is showing, search and filters applied. */
  rentals: readonly CustomerRental[];
  /** True when a filter or search narrows the list. */
  filtered: boolean;
  isLoading: boolean;
  onOpenCalendar: () => void;
}) {
  const { start, ticks, bars, upcoming } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowStart = new Date(today.getTime() - LEAD_DAYS * DAY_MS);
    const windowEnd = windowStart.getTime() + WINDOW_DAYS * DAY_MS;

    const inWindow: PreviewBar[] = [];
    for (const rental of rentals) {
      const from = localDay(rental.startDate).getTime();
      // An open-ended rental runs to the window's edge.
      const to = (rental.endDate ? localDay(rental.endDate).getTime() : windowEnd) + DAY_MS;
      if (to <= windowStart.getTime() || from >= windowEnd) continue;
      const left = Math.max(0, (from - windowStart.getTime()) / (WINDOW_DAYS * DAY_MS)) * 100;
      const right = Math.min(1, (to - windowStart.getTime()) / (WINDOW_DAYS * DAY_MS)) * 100;
      const status = customerRentalStatus(rental).toLowerCase();
      inWindow.push({
        id: rental.id,
        label: rental.vehicle?.displayName ?? rental.reference,
        left,
        width: Math.max(right - left, 3),
        done: status === 'completed' || status === 'cancelled' || status === 'rejected',
      });
    }
    inWindow.sort((a, b) => a.left - b.left);

    const weekTicks = Array.from({ length: WINDOW_DAYS / 7 }, (_, i) => {
      const day = new Date(windowStart.getTime() + i * 7 * DAY_MS);
      return {
        left: (i * 7 * 100) / WINDOW_DAYS,
        label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      };
    });

    const next = rentals.filter((r) => localDay(r.startDate).getTime() >= today.getTime()).length;
    return { start: windowStart, ticks: weekTicks, bars: inWindow.slice(0, MAX_ROWS), upcoming: next };
  }, [rentals]);

  const todayLeft = (LEAD_DAYS * 100) / WINDOW_DAYS;

  return (
    <section className={cn(FEATURED_SHELL_CLASS, 'min-h-0')} aria-label="Calendar view">
      <button
        type="button"
        onClick={onOpenCalendar}
        className="group/cal grid w-full cursor-pointer grid-cols-1 gap-6 rounded-2xl p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pv-ring/50 sm:p-6 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:items-center md:gap-8"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-pv-fg">Calendar view</h2>
            <p className="mt-1 text-[13px] leading-5 text-pv-muted-fg">
              Every rental on a timeline: when you pick up, when you return, and what is coming next.
            </p>
          </div>
          <span className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-pv-primary px-4 text-sm font-medium text-pv-primary-fg transition-colors duration-200 group-hover/cal:bg-pv-primary/80 motion-reduce:transition-none">
            Open calendar
            <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover/cal:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </div>

        {/* The preview: four weeks from three days ago, one bar per rental. */}
        <div className="min-w-0 rounded-xl border border-pv-border/70 bg-pv-card/70 p-4" aria-hidden>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-pv-muted-fg">
              {start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <span className="text-[12px] font-medium text-pv-muted-fg">
              {filtered ? 'Filtered · ' : ''}
              {upcoming === 0 ? 'Nothing upcoming' : `${upcoming} upcoming`}
            </span>
          </div>

          <div className="relative">
            {/* Week ticks */}
            <div className="relative h-5 border-b border-pv-border/70">
              {ticks.map((tick) => (
                <span key={tick.left} className="absolute top-0 text-[11px] tabular-nums text-pv-muted-fg" style={{ left: `${tick.left}%` }}>
                  {tick.label}
                </span>
              ))}
            </div>

            <div className="relative flex min-h-[108px] flex-col gap-2 overflow-hidden py-3">
              {ticks.map((tick) =>
                tick.left === 0 ? null : (
                  <span key={tick.left} className="absolute inset-y-0 w-px bg-pv-border/50" style={{ left: `${tick.left}%` }} />
                ),
              )}
              <span className="absolute inset-y-0 w-px bg-pv-primary" style={{ left: `${todayLeft}%` }}>
                <span className="absolute top-0 left-1/2 size-2 -translate-x-1/2 rounded-full bg-pv-primary" />
              </span>

              {isLoading ? (
                [0, 1].map((i) => (
                  <span key={i} className="relative h-7 animate-pulse rounded-lg bg-pv-muted" style={{ marginLeft: `${10 + i * 22}%`, width: '34%' }} />
                ))
              ) : bars.length === 0 ? (
                <p className="relative m-auto rounded-full bg-pv-card px-3 py-1 text-[12px] text-pv-muted-fg">
                  No rentals in these four weeks
                </p>
              ) : (
                bars.map((bar) => (
                  <span
                    key={bar.id}
                    className={cn(
                      'relative flex h-7 items-center truncate rounded-lg px-2.5 text-[12px] font-medium',
                      bar.done ? 'bg-pv-muted text-pv-muted-fg' : 'bg-pv-primary/15 text-pv-primary ring-1 ring-inset ring-pv-primary/25',
                    )}
                    style={{ marginLeft: `${bar.left}%`, width: `${bar.width}%`, minWidth: '4.5rem' }}
                  >
                    <span className="truncate">{bar.label}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </button>
    </section>
  );
}
