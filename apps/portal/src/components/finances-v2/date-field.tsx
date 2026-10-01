"use client";

/**
 * A date field on the app's own calendar — never the browser's native picker,
 * which draws a grey OS panel that belongs to no screen here.
 *
 * The field reads "Mon, Sep 28, 2026"; clicking it opens a light panel with the
 * month on the app's calendar (the same one the due-date picker uses). Picking
 * a day closes it. Values in and out are "yyyy-MM-dd" strings, read as LOCAL
 * dates, so a US operator never sees the day before.
 */

import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Calendar } from "@/components/ui-v2/calendar";
import { parseLocalDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export function DateField({
  value,
  onChange,
  placeholder = "Pick a date",
  ariaLabel,
  min,
  clearable,
  className,
}: {
  /** "yyyy-MM-dd", or "" for none. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Days before this ("yyyy-MM-dd") are greyed out. */
  min?: string;
  /** Offer "Clear" (for a date that may be empty, like a due date). */
  clearable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalDate(value) : undefined;
  const [month, setMonth] = useState<Date>(selected ?? new Date());

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
          aria-label={ariaLabel}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm transition-colors duration-200 ease-out hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? format(selected, "EEE, MMM d, yyyy") : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-auto gap-0 overflow-hidden rounded-xl bg-white p-0 dark:bg-card"
      >
        <Calendar
          mode="single"
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          disabled={min ? { before: parseLocalDate(min) } : undefined}
          onSelect={(d) => {
            if (!d) return;
            onChange(format(d, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
        {clearable && value && (
          <div className="border-t px-3 py-2">
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
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
