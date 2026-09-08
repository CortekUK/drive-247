'use client';

/**
 * WEEKLY HOURS — seven rows, three controls each at most.
 *
 * ── what this replaces ──────────────────────────────────────────────────────
 *
 * Seven columns, each with a purple switch and two stacked time dropdowns:
 * 21 controls for a thing an operator reads as one sentence ("we open nine to
 * five, closed weekends"). The switch and the word "Closed" also said the same
 * thing twice, in two places, per day.
 *
 * Now: one horizontal row per day, a state selector, and — when the day is
 * open — ONE control showing the range. Start and end are chosen inside it, so
 * the resting state is `9:00 AM — 5:00 PM` rather than two permanent boxes.
 *
 * ── the three states, and why they are a selector ───────────────────────────
 *
 *   Open        — the day has hours, and the range control appears
 *   Open 24 hours — no hours to show, because there is no closing time
 *   Closed      — no hours to show, because there is no opening time
 *
 * A switch can express two of those three. The third then needs its own
 * control, which is how the old row ended up with a switch AND a separate
 * always-open concept AND a "Closed" label. One selector holds all three, and
 * the row below it shows only what applies.
 *
 * ── 24 hours is per-day here, and the global flag still wins ────────────────
 *
 * `tenants.working_hours_always_open` is a TENANT-WIDE flag: when it is on,
 * every day is open around the clock regardless of the per-day columns. A day
 * is therefore shown as "Open 24 hours" when either that flag is set or the
 * day's own range spans midnight to midnight. Setting a single day to 24 hours
 * writes 00:00–23:59 on that day and does NOT touch the global flag — turning
 * one Tuesday into a 24-hour day must never silently open all seven.
 */

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui-v2/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui-v2/select';
import { cn } from '@/lib/utils';
import { TimePick } from './time-pick';
import {
  DAY_KEYS,
  formatTime,
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
  /* The tenant-wide flag outranks the day's own hours — see the header. */
  if (defaults.alwaysOpen) return 'always';
  if (d.open === FULL_DAY.open && d.close === FULL_DAY.close) return 'always';
  return 'open';
}

/** Very light, and no traffic-light colours: this is a schedule, not an alarm. */
const STATE_STYLE: Record<DayState, string> = {
  open: 'text-foreground',
  always: 'text-primary',
  closed: 'text-muted-foreground',
};

/**
 * The range, as ONE control. Reads as "9:00 AM — 5:00 PM"; opens a popover
 * holding the two pickers, so the two dropdowns exist only while somebody is
 * actually changing them.
 */
function TimeRange({
  open,
  close,
  disabled,
  onApply,
}: {
  open: string;
  close: string;
  disabled?: boolean;
  onApply: (open: string, close: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(open);
  const [draftClose, setDraftClose] = useState(close);

  /* Seeded when the popover opens, so Cancel genuinely abandons the edit rather
     than leaving half of it behind. */
  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraftOpen(open);
      setDraftClose(close);
    }
    setIsOpen(next);
  };

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-2 rounded-full bg-muted/50 px-3 py-1.5 text-[13px] tabular-nums transition-colors',
            'hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <Clock className="size-3.5 text-muted-foreground" />
          {formatTime(open)}
          <span className="text-muted-foreground">—</span>
          {formatTime(close)}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex items-end gap-2">
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Opens</p>
            <TimePick value={draftOpen} onChange={setDraftOpen} aria-label="Opening time" />
          </div>
          <span className="pb-2 text-muted-foreground">—</span>
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Closes</p>
            <TimePick value={draftClose} onChange={setDraftClose} aria-label="Closing time" />
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onApply(draftOpen, draftClose);
              setIsOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function WeeklyHoursCard({
  defaults,
  onChange,
  canEdit,
}: {
  defaults: WeeklyDefaults;
  onChange: (next: WeeklyDefaults) => void;
  canEdit: boolean;
}) {
  const setDay = (day: DayKey, patch: Partial<WeeklyDefaults['days'][DayKey]>) => {
    onChange({
      ...defaults,
      days: { ...defaults.days, [day]: { ...defaults.days[day], ...patch } },
    });
  };

  const setState = (day: DayKey, next: DayState) => {
    if (next === 'closed') {
      setDay(day, { enabled: false });
      return;
    }
    if (next === 'always') {
      /* The day's own columns, NOT the tenant-wide flag. See the header. */
      setDay(day, { enabled: true, ...FULL_DAY });
      return;
    }
    /* Back to normal hours. If the day was storing a full-day range, give it
       something sensible to show rather than 00:00–23:59 labelled "Open". */
    const d = defaults.days[day];
    const wasFullDay = d.open === FULL_DAY.open && d.close === FULL_DAY.close;
    setDay(day, {
      enabled: true,
      open: wasFullDay ? '09:00' : d.open,
      close: wasFullDay ? '17:00' : d.close,
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Weekly hours
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Applies to every week until you change it
        </p>
      </div>

      <div className="divide-y divide-border/50">
        {DAY_KEYS.map((day) => {
          const d = defaults.days[day];
          const state = stateOf(defaults, day);
          /* The tenant-wide flag is not this row's to switch off, so a row it
             governs is shown but not editable into another state. */
          const lockedByGlobal = defaults.alwaysOpen;

          return (
            <div key={day} className="flex items-center gap-3 px-5 py-2.5">
              <span className="w-[104px] shrink-0 text-[13px] font-medium">{DAY_LABEL[day]}</span>

              <Select
                value={state}
                onValueChange={(v) => setState(day, v as DayState)}
                disabled={!canEdit || lockedByGlobal}
              >
                <SelectTrigger
                  className={cn('h-8 w-[136px] text-[13px]', STATE_STYLE[state])}
                  aria-label={`${DAY_LABEL[day]} availability`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open" className="text-[13px]">Open</SelectItem>
                  <SelectItem value="always" className="text-[13px]">Open 24 hours</SelectItem>
                  <SelectItem value="closed" className="text-[13px]">Closed</SelectItem>
                </SelectContent>
              </Select>

              {/* Only what applies. A closed day has no hours to show, and a
                  24-hour day has no closing time — showing empty or greyed
                  pickers for either is the clutter this replaces. */}
              {state === 'open' && (
                <TimeRange
                  open={d.open}
                  close={d.close}
                  disabled={!canEdit}
                  onApply={(o, c) => setDay(day, { open: o, close: c })}
                />
              )}
              {state === 'always' && (
                <span className="text-[13px] text-muted-foreground">All day</span>
              )}
              {state === 'closed' && (
                <span className="text-[13px] text-muted-foreground">Not bookable online</span>
              )}
            </div>
          );
        })}
      </div>

      {defaults.alwaysOpen && (
        <p className="border-t border-border/60 px-5 py-2.5 text-[12px] text-muted-foreground">
          This account is set to open 24/7, so every day is bookable around the clock. Turn that
          off to set hours per day.
        </p>
      )}
    </section>
  );
}
