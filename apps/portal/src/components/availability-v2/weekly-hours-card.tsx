'use client';

/**
 * WEEKLY HOURS — a schedule you read, not a form you fill in.
 *
 * ── the change ──────────────────────────────────────────────────────────────
 *
 * This card has been through two shapes. First seven columns with a switch and
 * two stacked dropdowns each — 21 permanent controls. Then seven rows with a
 * status dropdown and a range button — 14. It still read as a settings table,
 * because every control was on screen whether or not anybody was editing.
 *
 * Now the resting state is TEXT:
 *
 *   Monday      9:00 AM — 5:00 PM      Open
 *   Saturday    —                      Closed
 *
 * and the whole row is a button. Click it and the editor opens over that row.
 * The week is legible at a glance, which is what an operator wants 95% of the
 * time, and the controls appear for the 5%.
 *
 * ── 24 hours: per-day, and the tenant-wide flag still wins ──────────────────
 *
 * `tenants.working_hours_always_open` opens EVERY day around the clock. A day
 * set to 24 hours here writes 00:00–23:59 on that day's own columns and does
 * NOT touch the global flag — one Tuesday must never silently open all seven.
 * While the global flag is on, the rows show it and are not editable, because
 * they are not this card's to change.
 */

import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui-v2/popover';
import { cn } from '@/lib/utils';
import { TimePick } from './time-pick';
import {
  DAY_KEYS,
  WEEKDAY_KEYS,
  formatTime,
  type DayHours,
  type DayKey,
  type WeeklyDefaults,
} from './availability-model';

const DAY_LABEL: Record<DayKey, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

type DayState = 'open' | 'always' | 'closed';

/** Midnight to one minute to midnight — how a 24-hour day is stored. */
const FULL_DAY = { open: '00:00', close: '23:59' };

function stateOf(defaults: WeeklyDefaults, day: DayKey): DayState {
  const d = defaults.days[day];
  if (!d.enabled) return 'closed';
  if (defaults.alwaysOpen) return 'always';
  if (d.open === FULL_DAY.open && d.close === FULL_DAY.close) return 'always';
  return 'open';
}

/** One label per concept. "24 hours" already says "all day"; both would not. */
const STATE_LABEL: Record<DayState, string> = {
  open: 'Open',
  always: '24 hours',
  closed: 'Closed',
};

/**
 * Quiet by design. The status must not be louder than the hours — the hours
 * are what somebody came to read.
 */
const STATE_CHIP: Record<DayState, string> = {
  open: 'text-muted-foreground',
  always: 'bg-primary/10 text-primary',
  closed: 'bg-muted text-muted-foreground',
};

/** What the row shows where the times go. */
function hoursText(defaults: WeeklyDefaults, day: DayKey): string {
  const state = stateOf(defaults, day);
  if (state === 'closed') return '—';
  if (state === 'always') return 'Open all day';
  const d = defaults.days[day];
  return `${formatTime(d.open)} — ${formatTime(d.close)}`;
}

/* ─────────────────────────── the row editor ─────────────────────────────── */

function StatusChoice({
  value,
  onChange,
}: {
  value: DayState;
  onChange: (v: DayState) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
      {(['open', 'always', 'closed'] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-pressed={value === s}
          className={cn(
            'rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors',
            value === s
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {s === 'always' ? '24 hours' : s === 'open' ? 'Open' : 'Closed'}
        </button>
      ))}
    </div>
  );
}

/**
 * Which days an edit lands on.
 *
 * `day` means this WEEKDAY in the recurring pattern — every future Monday —
 * not one calendar date. A single date is a different concept entirely and has
 * its own editor on the calendar below; this card never touches one.
 */
type ApplyScope = 'day' | 'all';

function DayEditorBody({
  title,
  initialState,
  initialHours,
  onCancel,
  onApply,
}: {
  title: string;
  initialState: DayState;
  initialHours: { open: string; close: string };
  onCancel: () => void;
  onApply: (
    state: DayState,
    hours: { open: string; close: string },
    scope: ApplyScope,
  ) => void;
}) {
  const [state, setState] = useState<DayState>(initialState);
  const [open, setOpen] = useState(initialHours.open);
  const [close, setClose] = useState(initialHours.close);
  /* Defaults to the narrow one, deliberately: editing Monday and silently
     rewriting the whole week is the mistake worth making impossible by
     default. Widening it is a click the operator chooses to make. */
  const [scope, setScope] = useState<ApplyScope>('day');

  return (
    <div className="w-[260px] space-y-3">
      <p className="text-[13px] font-semibold">{title}</p>

      <StatusChoice value={state} onChange={setState} />

      {/* Times only where there are times to set. */}
      {state === 'open' && (
        <div className="flex items-end gap-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Opens</p>
            <TimePick value={open} onChange={setOpen} aria-label="Opening time" />
          </div>
          <span className="pb-2 text-muted-foreground">—</span>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Closes</p>
            <TimePick value={close} onChange={setClose} aria-label="Closing time" />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">Apply to</p>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
          {([
            ['day', 'This day only'],
            ['all', 'All days'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              aria-pressed={scope === value}
              className={cn(
                'rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors',
                scope === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onApply(state, { open, close }, scope)}>
          Apply
        </Button>
      </div>
    </div>
  );
}

/* ──────────────────────────────── the card ──────────────────────────────── */

export function WeeklyHoursCard({
  defaults,
  onChange,
  canEdit,
}: {
  defaults: WeeklyDefaults;
  onChange: (next: WeeklyDefaults) => void;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<DayKey | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const lockedByGlobal = defaults.alwaysOpen;
  const interactive = canEdit && !lockedByGlobal;

  /** One place turns a chosen state into stored columns. */
  const hoursFor = (state: DayState, hours: { open: string; close: string }): DayHours => {
    if (state === 'closed') return { enabled: false, open: hours.open, close: hours.close };
    if (state === 'always') return { enabled: true, ...FULL_DAY };
    return { enabled: true, open: hours.open, close: hours.close };
  };

  const applyDay = (
    day: DayKey,
    state: DayState,
    hours: { open: string; close: string },
    scope: ApplyScope,
  ) => {
    const value = hoursFor(state, hours);
    /* "All days" is all SEVEN, weekend included — the editor says "All days"
       and it has to mean it. `Set weekdays` in the header is the Monday-Friday
       one, and the two are deliberately different actions. */
    const days = { ...defaults.days };
    if (scope === 'all') {
      for (const d of DAY_KEYS) days[d] = { ...value };
    } else {
      days[day] = value;
    }
    onChange({ ...defaults, days });
    setEditing(null);
  };

  /** Monday–Friday in one action — the schedule most operators actually have. */
  const applyWeekdays = (hours: { open: string; close: string }) => {
    const days = { ...defaults.days };
    for (const day of WEEKDAY_KEYS) {
      days[day] = { enabled: true, open: hours.open, close: hours.close };
    }
    onChange({ ...defaults, days });
    setBulkOpen(false);
  };

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Weekly hours
        </h2>

        {/* Most businesses do not set five days one at a time. */}
        <Popover open={bulkOpen} onOpenChange={setBulkOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px]" disabled={!interactive}>
              <CalendarRange className="size-3.5" />
              Set weekdays
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <BulkWeekdays
              initial={defaults.days.monday}
              onCancel={() => setBulkOpen(false)}
              onApply={applyWeekdays}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="divide-y divide-border/50">
        {DAY_KEYS.map((day) => {
          const state = stateOf(defaults, day);
          const d = defaults.days[day];

          const row = (
            <>
              <span className="w-[92px] shrink-0 text-[13px] font-medium">{DAY_LABEL[day]}</span>
              <span
                className={cn(
                  'flex-1 text-left text-[13px] tabular-nums',
                  state === 'closed' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {hoursText(defaults, day)}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  STATE_CHIP[state],
                )}
              >
                {STATE_LABEL[state]}
              </span>
            </>
          );

          /* Read-only when the tenant-wide flag governs the week, or the user
             cannot edit. A row that opens an editor which then refuses to
             change anything is worse than a row that does not open. */
          if (!interactive) {
            return (
              <div key={day} className="flex items-center gap-3 px-5 py-2">
                {row}
              </div>
            );
          }

          return (
            <Popover
              key={day}
              open={editing === day}
              onOpenChange={(o) => setEditing(o ? day : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-2 text-left transition-colors hover:bg-accent/50"
                >
                  {row}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3">
                <DayEditorBody
                  title={DAY_LABEL[day]}
                  initialState={state}
                  initialHours={{
                    /* A closed or 24-hour day has no useful times to seed, so
                       the editor offers a normal working day rather than
                       00:00–23:59 under a label reading "Opens". */
                    open: state === 'open' ? d.open : '09:00',
                    close: state === 'open' ? d.close : '17:00',
                  }}
                  onCancel={() => setEditing(null)}
                  onApply={(s, h, scope) => applyDay(day, s, h, scope)}
                />
              </PopoverContent>
            </Popover>
          );
        })}
      </div>

      {lockedByGlobal && (
        <p className="border-t border-border/60 px-5 py-2.5 text-[12px] text-muted-foreground">
          This account is open 24/7, so every day is bookable around the clock. Turn that off to
          set hours per day.
        </p>
      )}
    </section>
  );
}

function BulkWeekdays({
  initial,
  onCancel,
  onApply,
}: {
  initial: DayHours;
  onCancel: () => void;
  onApply: (hours: { open: string; close: string }) => void;
}) {
  const [open, setOpen] = useState(initial.open || '09:00');
  const [close, setClose] = useState(initial.close || '17:00');

  return (
    <div className="w-[260px] space-y-3">
      <div>
        <p className="text-[13px] font-semibold">Monday to Friday</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Sets all five and opens any that are closed. Saturday and Sunday are left alone.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Opens</p>
          <TimePick value={open} onChange={setOpen} aria-label="Weekday opening time" />
        </div>
        <span className="pb-2 text-muted-foreground">—</span>
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Closes</p>
          <TimePick value={close} onChange={setClose} aria-label="Weekday closing time" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onApply({ open, close })}>
          Apply
        </Button>
      </div>
    </div>
  );
}
