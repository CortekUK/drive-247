'use client';

/**
 * The global weekly pattern — "some global thing that will reflect in all of
 * the calendar".
 *
 * It is a STRIP UNDER THE CALENDAR rather than a card beside it, and each cell
 * is the exact width of the day column above it. That is the whole design: the
 * Monday default sits directly beneath every Monday, so changing it and
 * watching the column above repaint needs no explanation and no arrow. A panel
 * in a sidebar can only ever assert the relationship in words.
 *
 * The cells the operator has overridden for a specific date are marked, because
 * the honest answer to "will this change reflect everywhere?" is "everywhere
 * except the days you have already overridden", and the strip is where that
 * question gets asked.
 *
 * PREVIEW ONLY. `onChange` hands a new pattern to React state in
 * `availability-v2.tsx`. The tenants row is never written.
 */

import { Switch } from '@/components/ui-v2/switch';
import { cn } from '@/lib/utils';
import { TimePick } from './time-pick';
import { AXIS_WIDTH } from './week-calendar';
import {
  DAY_KEYS,
  DAY_SHORT,
  type DayKey,
  type WeeklyDefaults,
} from './availability-model';

interface WeeklyDefaultStripProps {
  defaults: WeeklyDefaults;
  onChange: (next: WeeklyDefaults) => void;
  canEdit: boolean;
  /** ISO dates in the visible week that carry an exception, by weekday. */
  overriddenByDay: Partial<Record<DayKey, number>>;
}

export function WeeklyDefaultStrip({
  defaults,
  onChange,
  canEdit,
  overriddenByDay,
}: WeeklyDefaultStripProps) {
  const setDay = (key: DayKey, patch: Partial<WeeklyDefaults['days'][DayKey]>) => {
    onChange({
      ...defaults,
      days: { ...defaults.days, [key]: { ...defaults.days[key], ...patch } },
    });
  };

  return (
    // `border-b`, not `border-t`: the strip now sits at the top of the card, so
    // the rule that separates it from the calendar belongs underneath it.
    //
    // `data-tour` is the tab tour's anchor for the pattern step. The strip is
    // the right size for a spotlight — full width but only ~110px tall — where
    // the card around it is ~700px and would degrade to a centred wash.
    <div data-tour="availability-pattern" className="border-b border-border bg-muted/30">
      <div className="flex">
        {/* Aligned with the hour axis above, so the seven cells line up with
            the seven columns rather than merely looking as though they do. */}
        <div
          className={cn(
            AXIS_WIDTH,
            'flex shrink-0 items-center justify-end border-r border-border px-2 py-3',
          )}
        >
          <span className="text-right text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
            Weekly
            <br />
            default
          </span>
        </div>

        <div className="grid flex-1 grid-cols-7 gap-px bg-border">
          {DAY_KEYS.map((key) => {
            const day = defaults.days[key];
            const overrides = overriddenByDay[key] || 0;

            return (
              <div key={key} className="flex flex-col gap-1.5 bg-card px-2 py-2.5">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      'text-[11px] font-medium',
                      day.enabled && !defaults.alwaysOpen
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {DAY_SHORT[key]}
                  </span>
                  <Switch
                    size="sm"
                    checked={defaults.alwaysOpen ? true : day.enabled}
                    disabled={!canEdit || defaults.alwaysOpen}
                    onCheckedChange={(v) => setDay(key, { enabled: v })}
                    aria-label={`${DAY_SHORT[key]} open by default`}
                  />
                </div>

                {defaults.alwaysOpen ? (
                  <p className="py-1 text-[11px] text-muted-foreground">Open 24 h</p>
                ) : day.enabled ? (
                  <div className="flex flex-col gap-1">
                    <TimePick
                      value={day.open}
                      disabled={!canEdit}
                      onChange={(v) => setDay(key, { open: v })}
                      className="h-7 w-full"
                      aria-label={`${DAY_SHORT[key]} opens at`}
                    />
                    <TimePick
                      value={day.close}
                      disabled={!canEdit}
                      onChange={(v) => setDay(key, { close: v })}
                      className="h-7 w-full"
                      aria-label={`${DAY_SHORT[key]} closes at`}
                    />
                  </div>
                ) : (
                  <p className="py-1 text-[11px] text-muted-foreground">Closed</p>
                )}

                {/* The honest footnote: this cell governs every date above it
                    EXCEPT the ones already overridden. A tinted pill rather than
                    amber ink, which at 10px carries nowhere near enough contrast
                    on either theme. The paragraph renders even when empty so the
                    seven cells keep one height and the strip does not jump as
                    overrides come and go. */}
                <p className="min-h-[16px] text-[10px] leading-4">
                  {overrides > 0 ? (
                    <span className="rounded-full bg-warning/25 px-1.5 text-foreground ring-1 ring-inset ring-warning/50">
                      {overrides} override{overrides === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
