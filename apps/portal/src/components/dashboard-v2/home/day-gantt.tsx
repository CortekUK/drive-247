'use client';

/**
 * "The day" as a Gantt chart — each event is a bar starting at its time, its
 * name centred inside, and hovering it opens a card with the detail: what,
 * when, who, and whether it is done, missed or still to come (Ghulam's sketch,
 * Sep 27 2026; after a line of pins, lanes, stacked bars, vertical tiles and
 * icons-only were tried).
 *
 * Bars are paper with ink text and no icon; only the outline carries the state
 * (grey done, red missed, indigo to come). Every bar is two hours long, since events are
 * moments, and bars that would overlap drop to the next row. Behind the chart, the time
 * already gone is washed red and the time still to come green, both strongest
 * at the bold indigo NOW line. Hours run along the bottom with faint
 * gridlines. Click an icon to open the rental.
 *
 * Flat, like the rest of the page: no shadows (the hover card included), and
 * positions are percentages of the day, so it fits the card with no sideways
 * scroll above 640px.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  CalendarClock,
  CreditCard,
  KeyRound,
  MoveDownLeft,
  MoveUpRight,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import type { DayEvent, DayEventKind, DayEventState } from '@/hooks/use-day-timeline';
import { MOTION_ENTER, MOTION_FLOATING } from '@/lib/motion';

export const ICON: Record<DayEventKind, LucideIcon> = {
  pickup: MoveUpRight,
  return: MoveDownLeft,
  payment_reminder: BellRing,
  return_reminder: CalendarClock,
  extension_charge: CreditCard,
  installment: Wallet,
  lockbox: KeyRound,
};

/** Money events are only shown to someone who can see payments. */
export const MONEY_KINDS: DayEventKind[] = ['payment_reminder', 'extension_charge', 'installment'];

/** One colour per state, shared by the bars, the legend and the list dots. */
export const STATE_FILL: Record<DayEventState, string> = {
  done: 'color-mix(in srgb, var(--pv-accent) 28%, var(--pv-paper))',
  missed: 'var(--pv-late)',
  upcoming: 'var(--pv-accent)',
};

export function clock(mins: number): string {
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export interface DayAxis {
  start: number;
  end: number;
  span: number;
  now: number;
  nowVisible: boolean;
}

/** Opening hours, widened to take in every event and NOW, snapped to whole hours. */
export function dayAxis(
  timed: DayEvent[],
  now: number,
  open: number | null | undefined,
  close: number | null | undefined
): DayAxis {
  const start = Math.floor(Math.min(open ?? 8 * 60, now, ...timed.map((e) => e.at!)) / 60) * 60;
  const end = Math.min(
    24 * 60,
    Math.ceil(Math.max(close ?? 20 * 60, now + 1, ...timed.map((e) => e.at! + 1)) / 60) * 60
  );
  return { start, end, span: Math.max(60, end - start), now, nowVisible: now >= start && now < end };
}

const ROW_H = 28;
const ROW_GAP = 6;
const MIN_ROWS = 4;
/**
 * Every bar is drawn this long. Events are moments, not spans; two hours gives
 * a bar room to carry its name, as in Ghulam's sketch (Sep 27 2026).
 */
const BAR_MINUTES = 120;
/** Clear space kept after a bar before the next may start on its row. */
const BAR_GAP_PX = 6;

/** A bar's outline carries its state; the fill stays paper and the text ink. */
const BAR_EDGE: Record<DayEventState, string> = {
  done: 'var(--pv-line-2)',
  missed: 'var(--pv-late)',
  upcoming: 'var(--pv-accent)',
};


function firstName(subject: string): string {
  return subject.split(' · ')[0].split(' ')[0];
}

const STATE_LABEL: Record<DayEventState, string> = {
  done: 'Done',
  missed: 'Missed',
  upcoming: 'To come',
};

/** Rows for bars that would otherwise overlap: each takes the first row it clears. */
function packRows(events: DayEvent[], widthPx: number, span: number) {
  const minGap = BAR_MINUTES + (BAR_GAP_PX / Math.max(1, widthPx)) * span;
  const rowEnds: number[] = [];
  return events.map((e) => {
    let row = rowEnds.findIndex((end) => e.at! >= end);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(-Infinity);
    }
    rowEnds[row] = e.at! + minGap;
    return { e, row };
  });
}

/**
 * What hovering an icon shows. Portalled out of the chart (which scrolls on a
 * phone and would clip it), so it carries `.pv` itself to keep the palette.
 */
function EventCard({ e, canOpen }: { e: DayEvent; canOpen: boolean }) {
  const Icon = ICON[e.kind];
  return (
    <div className="pv w-64">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--pv-wash)] text-[var(--pv-ink)]">
          <Icon className="size-3.5" strokeWidth={2.5} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--pv-ink)]">{e.title}</span>
        <span className="text-[12px] font-semibold tabular-nums text-[var(--pv-ink)]">{clock(e.at!)}</span>
      </div>
      <p className="mt-2 text-[12px] text-[var(--pv-ink-2)]">{e.subject}</p>
      <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--pv-ink)]">
        <span className="size-1.5 rounded-full" style={{ background: STATE_FILL[e.state] }} />
        {STATE_LABEL[e.state]}
        {e.state !== 'upcoming' && e.note && <span className="font-normal text-[var(--pv-ink-3)]">· {e.note}</span>}
      </p>
      {canOpen && <p className="mt-2.5 text-[11px] font-medium text-[var(--pv-accent-ink)]">Click to open the rental</p>}
    </div>
  );
}

export function DayGantt({
  timed,
  axis,
  onOpen,
}: {
  timed: DayEvent[];
  axis: DayAxis;
  onOpen: (e: DayEvent) => (() => void) | undefined;
}) {
  // The chart's real width, so icon spacing can be worked out in pixels.
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(1000);
  useEffect(() => {
    const el = chartRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setChartW(entry.contentRect.width || 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = useMemo(() => packRows(timed, chartW, axis.span), [timed, chartW, axis.span]);
  const rows = Math.max(MIN_ROWS, ...placed.map((p) => p.row + 1));
  const chartH = rows * (ROW_H + ROW_GAP) - ROW_GAP;
  const pct = (mins: number) => ((mins - axis.start) / axis.span) * 100;
  // Time marks every 15 minutes (Ghulam, Sep 27 2026). Below ~34px per
  // quarter the labels would collide, so the step widens to 30 minutes.
  const step = (chartW / axis.span) * 15 >= 34 ? 15 : 30;
  const marks = Array.from({ length: axis.span / step + 1 }, (_, i) => axis.start + i * step);
  const markLabel = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

  const nowHour = Math.floor(axis.now / 60) * 60;
  const nowShare = (axis.now - axis.start) / axis.span;

  return (
    <>
      {/* The washes run the card's full width, edge to edge, behind the chart.
          The chart itself sits inside a 24px gutter, so NOW is at
          24px + (card width − 48px) × its share of the day. */}
      <div className="relative pb-[10px] pt-4">
        {axis.nowVisible && (
          <>
            {/* The time already gone: red, strongest at NOW, fading toward the morning. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0"
              style={{
                top: 0,
                bottom: 10,
                width: `calc(24px + (100% - 48px) * ${nowShare})`,
                background:
                  'linear-gradient(to left, color-mix(in srgb, var(--pv-late) 14%, transparent) 0%, color-mix(in srgb, var(--pv-late) 4%, transparent) 60%, transparent 100%)',
              }}
            />
            {/* The time still to come: the green mirror, fading toward closing. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-0"
              style={{
                top: 0,
                bottom: 10,
                left: `calc(24px + (100% - 48px) * ${nowShare})`,
                background:
                  'linear-gradient(to right, color-mix(in srgb, var(--pv-clear) 14%, transparent) 0%, color-mix(in srgb, var(--pv-clear) 4%, transparent) 60%, transparent 100%)',
              }}
            />
          </>
        )}
      <div className="relative overflow-x-auto px-6">
        <div className="relative min-w-[640px]">
          <div ref={chartRef} className="relative" style={{ height: chartH }}>
            {/* Gridlines: firm on the hour, faint on each quarter. */}
            {marks.map((m) => (
              <span
                key={m}
                aria-hidden="true"
                className={cn('absolute inset-y-0 w-px bg-[var(--pv-line)]', m % 60 ? 'opacity-35' : 'opacity-80')}
                style={{ left: `${pct(m)}%` }}
              />
            ))}

            {/* NOW, through every row. */}
            {axis.nowVisible && (
              <span
                aria-hidden="true"
                className="absolute -bottom-2 -top-2 z-20 w-[3px] -translate-x-1/2 rounded-full bg-[var(--pv-accent)]"
                style={{ left: `${pct(axis.now)}%` }}
              />
            )}

            {placed.map(({ e, row }) => {
              const open = onOpen(e);
              return (
                <HoverCardPrimitive.Root key={e.id} openDelay={60} closeDelay={80}>
                  <HoverCardPrimitive.Trigger asChild>
                    <button
                      type="button"
                      onClick={open}
                      aria-label={[clock(e.at!), e.title, e.subject, STATE_LABEL[e.state], e.note].filter(Boolean).join(', ')}
                      className={cn(
                        'absolute z-10 flex items-center justify-center overflow-hidden rounded-lg border bg-[var(--pv-paper)] px-2 text-[var(--pv-ink)] transition-colors',
                        MOTION_ENTER,
                        'hover:bg-[var(--pv-wash)] data-[state=open]:bg-[var(--pv-wash)]',
                        !open && 'cursor-default'
                      )}
                      style={{
                        left: `${pct(e.at!)}%`,
                        width: `${Math.max(2, Math.min(100, pct(e.at! + BAR_MINUTES)) - pct(e.at!))}%`,
                        top: row * (ROW_H + ROW_GAP),
                        height: ROW_H,
                        borderColor: BAR_EDGE[e.state],
                      }}
                    >
                      <span className="truncate text-[11.5px] font-semibold leading-none">
                        {e.title} · {firstName(e.subject)}
                      </span>
                    </button>
                  </HoverCardPrimitive.Trigger>
                  <HoverCardPrimitive.Portal>
                    <HoverCardPrimitive.Content
                      side="top"
                      sideOffset={6}
                      className={cn('z-50 rounded-xl border border-[var(--pv-line)] bg-popover p-3.5 outline-none', MOTION_FLOATING)}
                    >
                      <EventCard e={e} canOpen={!!open} />
                    </HoverCardPrimitive.Content>
                  </HoverCardPrimitive.Portal>
                </HoverCardPrimitive.Root>
              );
            })}
          </div>

          {/* Times along the bottom, every quarter hour. */}
          <div className="relative mt-3 h-4">
            {marks.map((m) => (
              <span
                key={m}
                className={cn(
                  'absolute -translate-x-1/2 whitespace-nowrap tabular-nums',
                  m % 60 ? 'text-[10px] text-[var(--pv-ink-3)] opacity-80' : 'text-[11px] text-[var(--pv-ink-2)]',
                  m === nowHour && axis.nowVisible && 'font-semibold text-[var(--pv-accent-ink)] opacity-100'
                )}
                style={{ left: `${pct(m)}%` }}
              >
                {markLabel(m)}
              </span>
            ))}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
