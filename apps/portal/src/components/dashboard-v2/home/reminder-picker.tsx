'use client';

/**
 * "Remind me" — the small dialog behind the clock on the To do card
 * (Sep 27 2026), in place of a loose row of chips and a bare datetime input.
 *
 * A centred dialog rather than a popover: a popover anchored to the card's
 * clock opened upwards and ran off the top of the screen. Two columns —
 * quick picks on the left (each showing the exact time it means), a compact
 * calendar on the right — and along the bottom the time, a line saying
 * exactly when the reminder will fire, and Clear / Set reminder.
 *
 * A to-do holds one time (`tenant_notes.remind_at`), so that is all this sets:
 * no repeats, no channels — nothing the table cannot store.
 *
 * The dialog is portalled out of the card, so it carries `.pv` itself to keep
 * the dashboard palette.
 */

import { useState, type ReactNode } from 'react';
import { addDays, addHours, format, isBefore, isSameDay, nextMonday, setHours, setMinutes, startOfDay, startOfTomorrow } from 'date-fns';
import { AlarmClock, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { PHONE_SHEET, SheetGrabber } from './phone-sheet';

const at = (d: Date, h: number, m = 0) => setMinutes(setHours(d, h), m);

function quickPicks(now: Date): { label: string; when: Date }[] {
  const evening = at(now, 18);
  return [
    { label: 'In 1 hour', when: addHours(now, 1) },
    ...(isBefore(now, evening) ? [{ label: 'This evening', when: evening }] : []),
    { label: 'Tomorrow morning', when: at(startOfTomorrow(), 9) },
    { label: 'Tomorrow afternoon', when: at(startOfTomorrow(), 14) },
    { label: 'Next week', when: at(nextMonday(now), 9) },
  ];
}

/** "Today 6:00 PM", "Tomorrow 9:00 AM", "Mon 6 Oct, 9:00 AM". */
export function describeWhen(d: Date, now = new Date()): string {
  const time = format(d, 'h:mm a');
  if (isSameDay(d, now)) return `Today ${time}`;
  if (isSameDay(d, addDays(now, 1))) return `Tomorrow ${time}`;
  return `${format(d, 'EEE d MMM')}, ${time}`;
}

/** The portal calendar, sized down for a small dialog. */
const COMPACT_CALENDAR = {
  month: 'space-y-2',
  caption: 'flex justify-center pt-0.5 relative items-center',
  caption_label: 'text-[13px] font-semibold',
  head_cell: 'text-[var(--pv-ink-3)] w-8 font-normal text-[11px]',
  row: 'flex w-full mt-1',
  cell: 'h-8 w-8 text-center text-[12.5px] p-0 relative',
  day: 'h-8 w-8 rounded-full p-0 font-normal transition-colors hover:bg-[var(--pv-accent-bg)] aria-selected:opacity-100',
  day_selected: 'bg-[var(--pv-accent)] text-[var(--pv-on-accent)] hover:bg-[var(--pv-accent)] focus:bg-[var(--pv-accent)]',
  day_today: 'font-semibold text-[var(--pv-accent-ink)]',
};

export function ReminderPicker({
  value,
  onChange,
  children,
}: {
  value: Date | null;
  onChange: (next: Date | null) => void;
  /** The trigger — the clock button. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Date | undefined>(value ?? undefined);
  const [time, setTime] = useState(value ? format(value, 'HH:mm') : '09:00');
  const now = new Date();

  // What the calendar half would set, once a day is picked.
  const [hh, mm] = time.split(':').map(Number);
  const custom = day ? at(startOfDay(day), hh || 0, mm || 0) : null;
  const customInPast = !!custom && isBefore(custom, now);

  const choose = (d: Date | null) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDay(value ?? undefined);
          setTime(value ? format(value, 'HH:mm') : '09:00');
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className={`pv max-w-[560px] gap-0 overflow-y-auto p-0 ${PHONE_SHEET}`}>
        <SheetGrabber onClose={() => setOpen(false)} />
        <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b border-[var(--pv-line)] px-5 py-4 text-left">
          <AlarmClock className="size-4 text-[var(--pv-accent-ink)]" strokeWidth={2.25} />
          <DialogTitle className="text-[15px] font-semibold text-[var(--pv-ink)]">Remind me</DialogTitle>
        </DialogHeader>

        <div className="grid sm:grid-cols-[1fr_auto]">
          {/* Quick picks, each with the time it actually means. */}
          <ul className="border-b border-[var(--pv-line)] p-2 sm:border-b-0 sm:border-r">
            {quickPicks(now).map((q) => (
              <li key={q.label}>
                <button
                  type="button"
                  onClick={() => choose(q.when)}
                  className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--pv-accent-bg)]"
                >
                  <span className="text-[13px] font-medium text-[var(--pv-ink)]">{q.label}</span>
                  <span className="text-[11.5px] tabular-nums text-[var(--pv-ink-3)]">{describeWhen(q.when, now)}</span>
                </button>
              </li>
            ))}
          </ul>

          {/* Or a day. */}
          <div className="flex justify-center px-4 py-3">
            <Calendar
              mode="single"
              selected={day}
              onSelect={setDay}
              disabled={(d) => isBefore(d, startOfDay(now))}
              className="min-h-0 p-0"
              classNames={COMPACT_CALENDAR}
            />
          </div>
        </div>

        {/* The time, when it will fire, and the two actions. */}
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--pv-line)] px-4 py-3">
          <label className="flex items-center gap-2 rounded-lg bg-[var(--pv-wash)] px-2.5 py-1.5">
            <Clock className="size-3.5 text-[var(--pv-ink-3)]" />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Time"
              className="bg-transparent text-[12.5px] font-medium tabular-nums text-[var(--pv-ink)] outline-none"
            />
          </label>
          <p className={cn('min-w-0 flex-1 truncate text-[12px]', customInPast ? 'text-[var(--pv-late)]' : 'text-[var(--pv-ink-3)]')}>
            {custom
              ? customInPast
                ? 'That time has passed'
                : describeWhen(custom, now)
              : value
                ? `Set for ${describeWhen(value, now)}`
                : 'Pick a day on the calendar'}
          </p>
          <div className="flex shrink-0 gap-1.5">
            {value && (
              <button
                type="button"
                onClick={() => choose(null)}
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[var(--pv-ink-2)] transition-colors hover:bg-[var(--pv-wash)]"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              disabled={!custom || customInPast}
              onClick={() => custom && choose(custom)}
              className="rounded-lg bg-[var(--pv-accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-[var(--pv-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Set reminder
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
