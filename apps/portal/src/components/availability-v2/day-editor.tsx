'use client';

/**
 * The per-day exception editor — the "even if I do one day of exception" half
 * of the screen.
 *
 * Three states, always all three visible, because the third one is the point:
 * an operator has to be able to see that a day is currently FOLLOWING the
 * weekly pattern and put it back there in one click. A control that only offers
 * "block" and "change hours" can create an exception but never clear one, and
 * the calendar then fills up with overrides nobody meant to keep.
 *
 * PREVIEW ONLY — `onSet` writes to React state in `availability-v2.tsx` and
 * nowhere else. Nothing here touches Supabase.
 */

import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { Ban, CalendarClock, Check, RotateCcw, Repeat } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { cn } from '@/lib/utils';
import { TimePick } from './time-pick';
import {
  DAY_LABEL,
  formatTime,
  toMinutes,
  type DayException,
  type ResolvedDay,
  type WeeklyDefaults,
} from './availability-model';

type Mode = 'default' | 'hours' | 'closed';

interface DayEditorPanelProps {
  day: ResolvedDay;
  defaults: WeeklyDefaults;
  onSet: (iso: string, exception: DayException | null) => void;
  /** Called when the panel has finished with itself, so the column can close it. */
  onDone: () => void;
}

/**
 * The panel only. The Popover that holds it — and its trigger, which is the day
 * column itself — live in `week-calendar.tsx`.
 *
 * Splitting it that way is not stylistic. Portal resolves two copies of
 * @types/react (19 in apps/portal, 18 at the monorepo root, which is where
 * Radix resolves its own), and their `ReactNode` types are not mutually
 * assignable — so a component that takes the trigger as a `children` prop and
 * forwards it into `PopoverTrigger` fails to typecheck, while the same JSX
 * written inline compiles. Keeping the trigger at its call site also means the
 * column owns its own open state, which is where it belongs.
 */
export function DayEditorPanel({ day, defaults, onSet, onDone }: DayEditorPanelProps) {
  const mode: Mode = !day.overridden ? 'default' : day.open ? 'hours' : 'closed';

  // Seeded from whatever the day currently resolves to, so opening "custom
  // hours" starts from the hours already on screen rather than from 9–5.
  const [draftOpen, setDraftOpen] = useState(day.open && !day.allDay ? day.from : '09:00');
  const [draftClose, setDraftClose] = useState(day.open && !day.allDay ? day.to : '17:00');

  const pattern = defaults.days[day.dayKey];
  const defaultSummary = defaults.alwaysOpen
    ? 'Open 24 hours'
    : pattern?.enabled
      ? `${formatTime(pattern.open)} – ${formatTime(pattern.close)}`
      : 'Closed';

  /**
   * An end at or before the start is the one input that produces a bar with no
   * height, so the pickers keep the operator's choice but the calendar is only
   * told about ranges that can actually be drawn. The warning below explains
   * why the column has not moved.
   */
  const setHours = (from: string, to: string) => {
    setDraftOpen(from);
    setDraftClose(to);
    if (toMinutes(to) > toMinutes(from)) {
      onSet(day.iso, { kind: 'hours', open: from, close: to });
    }
  };

  const invalidRange = toMinutes(draftClose) <= toMinutes(draftOpen);

  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <p className="font-heading text-sm font-medium text-foreground">
          {DAY_LABEL[day.dayKey]} {format(day.date, 'd MMM')}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Weekly default: {defaultSummary}
        </p>
      </div>

      <div className="space-y-1 p-2">
        <ModeRow
          icon={<Repeat className="size-4" />}
          label="Follow the weekly default"
          hint={defaultSummary}
          active={mode === 'default'}
          onClick={() => onSet(day.iso, null)}
        />

        <ModeRow
          icon={<CalendarClock className="size-4" />}
          label="Custom hours, this day only"
          hint={mode === 'hours' ? `${formatTime(draftOpen)} – ${formatTime(draftClose)}` : 'Pick a start and end'}
          active={mode === 'hours'}
          onClick={() => setHours(draftOpen, draftClose)}
        />

        {mode === 'hours' && (
          <div className="mb-1 ml-9 mr-2 flex items-center gap-2 pb-1">
            <TimePick
              value={draftOpen}
              onChange={(v) => setHours(v, draftClose)}
              aria-label="Opens at"
              className="w-full"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <TimePick
              value={draftClose}
              onChange={(v) => setHours(draftOpen, v)}
              aria-label="Closes at"
              className="w-full"
            />
          </div>
        )}

        {mode === 'hours' && invalidRange && (
          <p className="mb-1 ml-9 text-xs text-destructive">
            The closing time needs to be after the opening time.
          </p>
        )}

        <ModeRow
          icon={<Ban className="size-4" />}
          label="Closed all day"
          hint="No bookings can start or end"
          active={mode === 'closed'}
          tone="destructive"
          onClick={() => onSet(day.iso, { kind: 'closed' })}
        />
      </div>

      {/*
        The real rows behind this date, if any. They stay visible even when an
        exception is overriding them on screen, so a preview that "opens" a
        maintenance day never hides the fact that the block is still there.
      */}
      {(day.tenantBlocks.length > 0 || day.vehicleBlocks.length > 0) && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Already blocked in your data
          </p>
          <ul className="mt-1.5 space-y-1">
            {[...day.tenantBlocks, ...day.vehicleBlocks].map((b) => (
              <li key={b.id} className="text-xs text-muted-foreground">
                <span className="text-foreground">
                  {b.scope === 'tenant' ? 'Whole operation' : b.vehicleLabel}
                </span>
                {b.reason ? ` — ${b.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {day.overridden && (
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => {
              onSet(day.iso, null);
              onDone();
            }}
          >
            <RotateCcw className="size-3.5" />
            Clear this exception
          </Button>
        </div>
      )}
    </>
  );
}

function ModeRow({
  icon,
  label,
  hint,
  active,
  tone,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  active: boolean;
  tone?: 'destructive';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          active ? 'text-primary' : tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm', active ? 'font-medium text-foreground' : 'text-foreground')}>
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      {active && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
    </button>
  );
}
