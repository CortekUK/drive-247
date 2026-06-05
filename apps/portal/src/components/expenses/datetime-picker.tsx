"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  /** ISO timestamp string, or null/empty. */
  value: string | null;
  onChange: (iso: string) => void;
  disabled?: boolean;
}

export function DateTimePicker({ value, onChange, disabled }: DateTimePickerProps) {
  const date = useMemo(() => (value ? new Date(value) : null), [value]);
  const timeValue = date ? format(date, "HH:mm") : "12:00";

  const setDatePart = (picked?: Date) => {
    if (!picked) return;
    const base = date ?? new Date();
    const next = new Date(
      picked.getFullYear(),
      picked.getMonth(),
      picked.getDate(),
      base.getHours(),
      base.getMinutes()
    );
    onChange(next.toISOString());
  };

  const setTimePart = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const base = date ?? new Date();
    const next = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      Number.isFinite(h) ? h : 0,
      Number.isFinite(m) ? m : 0
    );
    onChange(next.toISOString());
  };

  return (
    <div className="flex gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "flex-1 justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            {date ? format(date, "dd MMM yyyy") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date ?? undefined}
            onSelect={setDatePart}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      <div className="relative w-[120px]">
        <Clock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="time"
          value={timeValue}
          disabled={disabled}
          onChange={(e) => setTimePart(e.target.value)}
          className="pl-8"
        />
      </div>
    </div>
  );
}
