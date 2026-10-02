"use client";

// ── A date field for the Bonzah application, on the app's own calendar ──────
//
// v1's application steps use `<Input type="date">`, which opens the browser's
// native panel — a grey OS widget that matches nothing in v2 and looks
// different in every browser. The steps are v1 files, so the wizard shell
// slots this field in where each native date input sits (see `useDateFields`
// in `bonzah-onboarding-v2.tsx`) and writes straight back into the same
// react-hook-form value. v1's files are untouched.
//
// The dates asked for here — a date of birth, when the business started — are
// usually years back, so the panel opens with a month and a year picker above
// the calendar instead of making the operator click back one month at a time.
// Values in and out are "yyyy-MM-dd" strings read as LOCAL dates, exactly what
// the native input produced, so nothing about saving or validation changes.

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/date-utils";
import { Calendar } from "@/components/ui-v2/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";

const MONTHS = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), "MMMM"));
/** A century back covers any date of birth or founding date this form asks for. */
const FIRST_YEAR = new Date().getFullYear() - 100;
const LAST_YEAR = new Date().getFullYear() + 5;

export function BonzahDateField({
  value,
  onChange,
  invalid,
  triggerClassName,
  placeholder = "Pick a date",
}: {
  /** "yyyy-MM-dd", or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** The field has a validation error — drawn like the other fields' errors. */
  invalid?: boolean;
  /**
   * The class list of the native input this replaces, so the trigger is the
   * same pill, border and height as every other field in the row.
   */
  triggerClassName?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => {
    if (!value) return undefined;
    const d = parseLocalDate(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }, [value]);
  const [month, setMonth] = useState<Date>(selected ?? new Date());
  const years = useMemo(
    () => Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => LAST_YEAR - i),
    [],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setMonth(selected ?? new Date());
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-invalid={invalid || undefined}
          className={cn(
            triggerClassName,
            "flex items-center justify-between gap-2 text-left",
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? format(selected, "MMM d, yyyy") : placeholder}
          </span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-auto gap-0 overflow-hidden rounded-xl bg-white p-0 dark:bg-card"
      >
        {/* Month and year, to jump decades in two clicks. */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Select
            value={String(month.getMonth())}
            onValueChange={(m) => setMonth(new Date(month.getFullYear(), Number(m), 1))}
          >
            <SelectTrigger size="sm" className="flex-1" aria-label="Month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {MONTHS.map((name, i) => (
                <SelectItem key={name} value={String(i)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(month.getFullYear())}
            onValueChange={(y) => setMonth(new Date(Number(y), month.getMonth(), 1))}
          >
            <SelectTrigger size="sm" className="w-24" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Calendar
          mode="single"
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          // The pickers above say which month this is; the calendar's own
          // caption would only repeat it.
          classNames={{ caption_label: "sr-only" }}
          onSelect={(d) => {
            if (!d) return;
            onChange(format(d, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
        {value && (
          <div className="border-t px-3 py-2">
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground motion-reduce:transition-none"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
