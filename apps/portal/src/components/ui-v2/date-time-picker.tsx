"use client";

/**
 * A date and a time in one field: a shadcn Popover holding shortcuts, the v2
 * Calendar and a column of time slots. It replaces the browser's native
 * `datetime-local` popup, which looks different in every browser and nothing
 * like v2.
 *
 * The value is the SAME wall-clock string `datetime-local` produces
 * ("2026-09-16T14:30", no zone, "" for none), so a form can swap its native
 * input for this without touching how it saves: `new Date(value)` still reads it
 * in the operator's own zone.
 *
 * Times come in 15-minute steps. Past days, and past times on a chosen day, are
 * disabled: what this picks is something to be reminded of, which only makes
 * sense in the future.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { addDays, addMinutes, format, isSameDay, nextMonday, startOfDay } from "date-fns";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import { Calendar } from "@/components/ui-v2/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { cn } from "@/lib/utils";

const STEP_MINUTES = 15;
/** Where a day picked with no time yet lands, and where the slot list opens. */
const DEFAULT_HOUR = 9;

const SLOTS = Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, i) => ({
  hours: Math.floor((i * STEP_MINUTES) / 60),
  minutes: (i * STEP_MINUTES) % 60,
}));

const slotKey = (hours: number, minutes: number) =>
  `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

/** "2026-09-16T14:30" → that wall-clock moment as a local Date; null for "" or anything malformed. */
export function parseLocalDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const [year, month, day, hours, minutes] = m.slice(1).map(Number);
  const d = new Date(year, month - 1, day, hours, minutes);
  // `new Date` rolls impossible values over (Feb 30 → Mar 2) instead of failing.
  const exact =
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day &&
    d.getHours() === hours &&
    d.getMinutes() === minutes;
  return exact ? d : null;
}

/** A local Date → the `datetime-local` string for it. */
export function toLocalDateTime(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

/** The first slot that has not started yet at `d`. */
function nextSlot(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  const into = out.getMinutes() % STEP_MINUTES;
  const onBoundary = into === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
  if (!onBoundary) out.setMinutes(out.getMinutes() - into + STEP_MINUTES);
  return out;
}

function atTime(day: Date, hours: number, minutes: number): Date {
  const d = startOfDay(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export interface DateTimePickerProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /**
   * Replaces the trigger's default classes entirely rather than merging with
   * them, so a caller painting with its own tokens gets exactly its own look.
   * The trigger carries `data-empty` and `data-state` to style against.
   */
  triggerClassName?: string;
  onTriggerKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Open on mount, for a field that appears because the operator asked to set a time. */
  defaultOpen?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick a date and time",
  triggerClassName,
  onTriggerKeyDown,
  defaultOpen = false,
  disabled,
  "aria-label": ariaLabel,
}: DateTimePickerProps) {
  const selected = parseLocalDateTime(value);
  const [open, setOpen] = useState(defaultOpen);
  // "Now" is read when the picker opens, not on every render, so disabled slots
  // don't shift under the pointer while it is open.
  const [now, setNow] = useState(() => new Date());
  const [month, setMonth] = useState<Date>(() => selected ?? now);
  const slotsRef = useRef<HTMLDivElement>(null);

  const today = startOfDay(now);
  const earliest = nextSlot(now);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      const current = new Date();
      setNow(current);
      setMonth(parseLocalDateTime(value) ?? current);
    }
    setOpen(next);
  };

  const commit = (d: Date) => onChange(toLocalDateTime(d < earliest ? earliest : d));

  const pickDay = (day: Date | undefined) => {
    // react-day-picker reports a click on the already-selected day as
    // `undefined`. Clearing the time on that would be a surprise; Clear is below.
    if (!day) return;
    if (selected) commit(atTime(day, selected.getHours(), selected.getMinutes()));
    else commit(isSameDay(day, now) ? earliest : atTime(day, DEFAULT_HOUR, 0));
  };

  const pickSlot = (hours: number, minutes: number) => {
    // With no day chosen yet, a time that has already gone today means tomorrow.
    const day = selected ?? (atTime(now, hours, minutes) < earliest ? addDays(today, 1) : today);
    commit(atTime(day, hours, minutes));
  };

  const shortcuts = [
    { label: "In 1 hour", at: nextSlot(addMinutes(now, 60)) },
    { label: "Tomorrow 9 AM", at: atTime(addDays(today, 1), 9, 0) },
    { label: "Monday 9 AM", at: atTime(nextMonday(today), 9, 0) },
  ].filter((s, i, all) => all.findIndex((o) => o.at.getTime() === s.at.getTime()) === i);

  // Bring the chosen slot (or 9:00) into view inside the list when it opens.
  const focusSlot = selected ? slotKey(selected.getHours(), selected.getMinutes()) : slotKey(DEFAULT_HOUR, 0);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const box = slotsRef.current;
      const target = box?.querySelector<HTMLElement>(`[data-slot-time="${focusSlot}"]`);
      if (!box || !target) return;
      box.scrollTop = target.offsetTop - 4;
      box.scrollLeft = target.offsetLeft - 4;
    });
    return () => cancelAnimationFrame(frame);
    // Only on open: re-scrolling after every pick would yank the list away
    // from where the operator is looking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          data-empty={!selected}
          onKeyDown={onTriggerKeyDown}
          className={
            triggerClassName ??
            "flex h-9 w-full items-center gap-2 rounded-md border border-border bg-transparent px-3 text-left text-sm tabular-nums outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 dark:hover:border-indigo-300/30 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[empty=true]:text-muted-foreground data-[state=open]:ring-2 data-[state=open]:ring-ring"
          }
        >
          <CalendarClock className="size-3.5 shrink-0" />
          <span className="truncate">{selected ? format(selected, "EEE d MMM, h:mm a") : placeholder}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
          {shortcuts.map((s) => (
            <Button
              key={s.label}
              type="button"
              variant="outline"
              size="xs"
              className="rounded-full"
              onClick={() => onChange(toLocalDateTime(s.at))}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row">
          <Calendar
            mode="single"
            selected={selected ?? undefined}
            onSelect={pickDay}
            month={month}
            onMonthChange={setMonth}
            disabled={{ before: today }}
            fixedWeeks
          />

          <div className="flex min-w-0 flex-col border-t border-border sm:w-[132px] sm:border-l sm:border-t-0">
            <div className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Time
            </div>
            <div
              ref={slotsRef}
              className="no-scrollbar relative flex gap-1 overflow-x-auto px-3 pb-3 sm:max-h-[252px] sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto"
            >
              {SLOTS.map(({ hours, minutes }) => {
                const key = slotKey(hours, minutes);
                const isSelected = !!selected && selected.getHours() === hours && selected.getMinutes() === minutes;
                const isPast = !!selected && atTime(selected, hours, minutes) < earliest;
                return (
                  <Button
                    key={key}
                    type="button"
                    data-slot-time={key}
                    variant={isSelected ? "default" : "ghost"}
                    size="sm"
                    disabled={isPast}
                    aria-pressed={isSelected}
                    onClick={() => pickSlot(hours, minutes)}
                    className="h-8 shrink-0 justify-center rounded-full px-3 tabular-nums sm:w-full"
                  >
                    {format(atTime(today, hours, minutes), "h:mm a")}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <div className={cn("flex items-center justify-between gap-2 border-t border-border px-3 py-2")}>
          <Button type="button" variant="ghost" size="sm" disabled={!selected} onClick={() => onChange("")}>
            Clear
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
