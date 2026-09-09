'use client';

/**
 * The week. Seven date columns over an hour grid — a calendar, not a table of
 * ranges.
 *
 * ── The one distinction this screen exists to draw ──────────────────────────
 *
 * A day either FOLLOWS the weekly pattern or it OVERRIDES it, and an operator
 * has to be able to tell which at a glance, from across the room, without
 * reading anything. So the difference is carried by three signals at once, not
 * by a word:
 *
 *   following the pattern →  indigo, solid edges, quiet grey "Weekly default"
 *   overridden here       →  amber, DASHED outline round the whole column,
 *                            amber wash behind the header, amber pill
 *   really blocked        →  red diagonal hatch, red pill
 *
 * Colour alone would fail for the ~8% of men who cannot separate the amber from
 * the indigo reliably; the dashed outline and the hatch are the redundant
 * channel that survives that, and they also survive a greyscale print.
 *
 * ── Geometry ────────────────────────────────────────────────────────────────
 *
 * The grid is a fixed pixel height divided by however many hours are on screen,
 * rather than a fixed height per hour. A tenant open 09:00–17:00 and one open
 * around the clock then both get a calendar that fits the viewport; the
 * alternative is either sixteen empty hours of scroll or an unreadable 12px
 * hour. `hourWindow()` decides the range from the week actually resolved.
 */

import { useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { Ban, Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui-v2/popover';
import { cn } from '@/lib/utils';
import { DayEditorPanel } from './day-editor';
import {
  DAY_SHORT,
  formatTime,
  formatTimeShort,
  hourWindow,
  toMinutes,
  type DayException,
  type ResolvedDay,
  type WeeklyDefaults,
} from './availability-model';

/** Total height of the hour grid. See the geometry note above. */
const GRID_HEIGHT = 508;
/** Height of a day header, mirrored by the spacer above the hour axis. */
const HEADER_HEIGHT = 76;
/**
 * The hour-axis gutter, as a Tailwind class so the weekly-default strip can
 * reuse the identical width. If these two ever disagree, every default cell
 * sits half a column away from the dates it governs and the whole point of the
 * layout is lost — so there is one value and both import it.
 */
export const AXIS_WIDTH = 'w-[58px]';

interface WeekCalendarProps {
  days: ResolvedDay[];
  defaults: WeeklyDefaults;
  canEdit: boolean;
  onSet: (iso: string, exception: DayException | null) => void;
  /** Client-side only, so the server render never disagrees about "now". */
  now: Date | null;
}

export function WeekCalendar({ days, defaults, canEdit, onSet, now }: WeekCalendarProps) {
  const { startHour, endHour } = hourWindow(days);
  const span = Math.max(1, endHour - startHour);
  const pxPerHour = GRID_HEIGHT / span;
  // Below ~26px an hourly label turns the axis into a grey smear.
  const labelStep = pxPerHour >= 26 ? 1 : pxPerHour >= 16 ? 2 : 3;

  const hourLines = `repeating-linear-gradient(to bottom, hsl(var(--border) / 0.7) 0px, hsl(var(--border) / 0.7) 1px, transparent 1px, transparent ${pxPerHour}px)`;

  const axisHours: number[] = [];
  for (let h = startHour; h <= endHour; h += labelStep) axisHours.push(h);

  return (
    // No card wrapper here on purpose. The screen puts this and the weekly
    // default strip inside ONE card so the two share an edge, and the strip
    // repeats these exact widths (AXIS_WIDTH gutter, then grid-cols-7 gap-px)
    // so each default cell sits directly under the dates it governs. That
    // alignment is the argument the screen is making; it must not be able to
    // drift, so the constant is exported rather than typed twice.
    <div className="flex">
      {/* ── hour axis ───────────────────────────────────────────────── */}
      {/* The tab tour points HERE for "the week, drawn as hours" rather than at
          the seven columns: the grid runs the full content width at ~584px
          tall, which is past the point where a spotlight degrades to a wash.
          The axis is 58px wide, so the card stands beside it and the whole
          calendar stays visible. */}
      <div data-tour="availability-hours" className={cn(AXIS_WIDTH, 'shrink-0 border-r border-border')}>
        <div style={{ height: HEADER_HEIGHT }} className="border-b border-border" />
        <div className="relative" style={{ height: GRID_HEIGHT }}>
          {axisHours.map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: (h - startHour) * pxPerHour }}
            >
              {formatTimeShort(`${String(h % 24).padStart(2, '0')}:00`)}
            </span>
          ))}
        </div>
      </div>

      {/* ── seven day columns ───────────────────────────────────────── */}
      <div className="grid flex-1 grid-cols-7 gap-px bg-border">
        {days.map((day) => (
          <DayColumn
            key={day.iso}
            day={day}
            defaults={defaults}
            canEdit={canEdit}
            onSet={onSet}
            now={now}
            startHour={startHour}
            endHour={endHour}
            pxPerHour={pxPerHour}
            hourLines={hourLines}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  defaults,
  canEdit,
  onSet,
  now,
  startHour,
  endHour,
  pxPerHour,
  hourLines,
}: {
  day: ResolvedDay;
  defaults: WeeklyDefaults;
  canEdit: boolean;
  onSet: (iso: string, exception: DayException | null) => void;
  now: Date | null;
  startHour: number;
  endHour: number;
  pxPerHour: number;
  hourLines: string;
}) {
  const [editing, setEditing] = useState(false);
  const isToday = !!now && isSameDay(day.date, now);
  const isException = day.source === 'exception';
  const isRealBlock = day.source === 'blocked-dates';

  // Where "now" sits in this column, if it is on screen at all.
  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() : null;
  const showNowLine =
    isToday &&
    nowMinutes !== null &&
    nowMinutes >= startHour * 60 &&
    nowMinutes <= endHour * 60;

  const top = day.open ? ((toMinutes(day.from) - startHour * 60) / 60) * pxPerHour : 0;
  const height = day.open
    ? ((toMinutes(day.to) - toMinutes(day.from)) / 60) * pxPerHour
    : 0;

  /* A flat wash, not diagonal hatching. The stripes read as "broken" rather
     than "not open" — a closed Sunday is a normal state of a business, and it
     was the loudest thing on the screen. Kept distinguishable by TONE, so a
     blocked date and a routine closure are still not the same colour. */
  const closedFill = isRealBlock
    ? 'bg-destructive/[0.06]'
    : isException
      ? 'bg-warning/[0.10]'
      : 'bg-muted/40';

  const label = day.open
    ? day.allDay
      ? 'Open 24 hours'
      : `${formatTime(day.from)} – ${formatTime(day.to)}`
    : isRealBlock
      ? 'Blocked'
      : 'Closed';

  return (
    <Popover open={editing} onOpenChange={setEditing}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button
          type="button"
          // Seven of these; `findAnchor` takes the first VISIBLE match, so the
          // tab tour always lands on Monday's column and the spotlight is
          // deterministic rather than dependent on what the week happens to
          // hold. One column is ~200px wide, well inside the spotlight budget.
          data-tour="availability-day"
          aria-label={`${format(day.date, 'EEEE d MMMM')} — ${label}. Edit this day.`}
          className={cn(
            'group relative flex flex-col bg-card text-left outline-none transition-colors',
            'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary/60',
            isToday && !isException && 'bg-primary/[0.035]',
            isException && 'bg-warning/[0.07]',
            canEdit && 'cursor-pointer hover:bg-muted/40',
            !canEdit && 'cursor-default',
          )}
        >
          {/*
            The exception outline. An absolutely positioned dashed border rather
            than a ring, because Tailwind's ring cannot be dashed and the dash is
            doing the accessibility work — it is what tells the two states apart
            without relying on the amber.
          */}
          {isException && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-warning"
            />
          )}

          {/* ── day header ───────────────────────────────────────────── */}
          <span
            // The tour's anchor for the status chip step. The header, not the
            // chip itself: the chip is ~50px of text, and the step is about the
            // three words in the context of the date above them.
            data-tour="availability-day-header"
            className={cn(
              'flex flex-col items-center justify-center gap-1 border-b border-border px-1',
              isException && 'bg-warning/15',
            )}
            style={{ height: HEADER_HEIGHT }}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {DAY_SHORT[day.dayKey]}
            </span>
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-full font-heading text-[15px] tabular-nums',
                isToday
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'font-medium text-foreground',
              )}
            >
              {format(day.date, 'd')}
            </span>
            <StatusChip day={day} />
          </span>

          {/* ── the hours themselves ─────────────────────────────────── */}
          <span
            className="relative block"
            style={{ height: GRID_HEIGHT, backgroundImage: hourLines }}
          >
            {day.open ? (
              day.allDay ? (
                /* A 24-hour day gets a compact bar, not a column-height slab.
                   The grid no longer stretches to midnight for it (see
                   `hourWindow`), so a block spanning "the whole day" would
                   have been both enormous and a lie about the visible range. */
                <span
                  className={cn(
                    'absolute inset-x-1 top-1 flex items-center justify-center rounded-lg px-1.5 py-1 text-[11px] font-medium',
                    isException
                      ? 'border border-dashed border-warning bg-warning/20 text-foreground'
                      : 'bg-primary/10 text-primary',
                  )}
                >
                  Open 24 hours
                </span>
              ) : (
                <span
                  className={cn(
                    'absolute left-1 right-1 flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg px-1.5 py-1',
                    isException
                      ? 'border border-dashed border-warning bg-warning/20'
                      : 'border border-primary/20 bg-primary/[0.08]',
                  )}
                  style={{ top, height: Math.max(height, 22) }}
                >
                  {/* One readable range beats "9am" over "to 5pm". */}
                  <span
                    className={cn(
                      'truncate text-[11px] font-medium leading-tight',
                      isException ? 'text-foreground' : 'text-primary',
                    )}
                  >
                    {height > 34
                      ? `${formatTimeShort(day.from)} – ${formatTimeShort(day.to)}`
                      : formatTimeShort(day.from)}
                  </span>
                  {height > 58 && (
                    <span className="truncate text-[11px] leading-tight text-muted-foreground">
                      Available online
                    </span>
                  )}
                </span>
              )
            ) : (
              <span
                // Only a REAL tenant-wide block gets the tour's attribute, not
                // every closed day: the step it anchors is specifically about
                // red hatching, and a grey "Closed" column would make that
                // sentence a lie. Absent, the step falls back to a plain column
                // and its body still reads correctly.
                data-tour={isRealBlock ? 'availability-blocked' : undefined}
                // The hatch moved out of an inline `style` and into `closedFill`
                // during the calendar redesign; it still draws the red hatching
                // the tour step above describes.
                className={cn(
                  'absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-1 text-center',
                  closedFill,
                )}
              >
                <Ban
                  className={cn(
                    'size-4',
                    isRealBlock
                      ? 'text-destructive'
                      : isException
                        ? 'text-warning'
                        : 'text-muted-foreground',
                  )}
                />
                <span
                  className={cn(
                    'text-[11px] font-medium',
                    isRealBlock ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {isRealBlock ? 'Blocked' : 'Closed'}
                </span>
                {isRealBlock && day.tenantBlocks[0]?.reason && (
                  <span className="line-clamp-2 px-1 text-[10px] leading-tight text-muted-foreground">
                    {day.tenantBlocks[0].reason}
                  </span>
                )}
              </span>
            )}

            {/* Vehicles blocked on a day the operation is otherwise open. This is
                real data and it is NOT the same thing as being closed, so it gets
                a footnote rather than a hatch. */}
            {day.vehicleBlocks.length > 0 && (
              <span
                data-tour="availability-vehicles-out"
                className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-lg bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
              >
                <Clock className="size-2.5 shrink-0" />
                <span className="truncate">
                  {day.vehicleBlocks.length} {day.vehicleBlocks.length === 1 ? 'vehicle' : 'vehicles'} out
                </span>
              </span>
            )}

            {showNowLine && (
              <span
                aria-hidden
                data-tour="availability-now"
                className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                style={{ top: ((nowMinutes as number) - startHour * 60) / 60 * pxPerHour }}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                <span className="h-px flex-1 bg-destructive" />
              </span>
            )}
          </span>
        </button>
      </PopoverTrigger>

      {/* `gap-0` because PopoverContent is a flex column with a base `gap-4`,
          which would push 16px between the panel's own bordered sections; and
          `overflow-hidden` so those sections are clipped to its rounded edge. */}
      <PopoverContent align="center" className="w-[286px] gap-0 overflow-hidden p-0">
        <DayEditorPanel
          day={day}
          defaults={defaults}
          onSet={onSet}
          onDone={() => setEditing(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The word under the date. Says which of the three inputs decided this day. */
function StatusChip({ day }: { day: ResolvedDay }) {
  if (day.source === 'exception') {
    return (
      <span className="rounded-full border border-dashed border-warning bg-warning/20 px-1.5 text-[10px] font-medium leading-4 text-foreground">
        {day.open ? 'Custom' : 'Closed'}
      </span>
    );
  }
  if (day.source === 'blocked-dates') {
    return (
      <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-medium leading-4 text-destructive">
        Blocked
      </span>
    );
  }
  return (
    <span className="px-1.5 text-[10px] leading-4 text-muted-foreground">Default</span>
  );
}
