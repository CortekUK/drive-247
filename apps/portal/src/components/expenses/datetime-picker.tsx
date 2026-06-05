"use client";

import { useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  /** ISO timestamp string, or null/empty. */
  value: string | null;
  onChange: (iso: string) => void;
  disabled?: boolean;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59
const PERIODS = ["AM", "PM"] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** A scrollable column of selectable values that auto-scrolls to the active one. */
function Column({
  values,
  active,
  render,
  onPick,
}: {
  values: (number | string)[];
  active: number | string;
  render: (v: number | string) => string;
  onPick: (v: number | string) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, [active]);
  return (
    <div className="h-[180px] w-14 overflow-y-auto scroll-smooth pr-1">
      <div className="flex flex-col gap-0.5">
        {values.map((v) => {
          const isActive = v === active;
          return (
            <button
              key={String(v)}
              ref={isActive ? activeRef : undefined}
              type="button"
              onClick={() => onPick(v)}
              className={cn(
                "rounded-md px-2 py-1 text-center text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted"
              )}
            >
              {render(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateTimePicker({ value, onChange, disabled }: DateTimePickerProps) {
  const date = useMemo(() => (value ? new Date(value) : null), [value]);

  const h24 = date ? date.getHours() : 12;
  const minute = date ? date.getMinutes() : 0;
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const hour12 = h24 % 12 || 12;

  const setDatePart = (picked?: Date) => {
    if (!picked) return;
    const base = date ?? new Date();
    onChange(
      new Date(
        picked.getFullYear(),
        picked.getMonth(),
        picked.getDate(),
        base.getHours(),
        base.getMinutes()
      ).toISOString()
    );
  };

  const setTime = (h12: number, m: number, p: "AM" | "PM") => {
    const base = date ?? new Date();
    const hour = p === "PM" ? (h12 % 12) + 12 : h12 % 12;
    onChange(
      new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, m).toISOString()
    );
  };

  return (
    <div className="flex gap-2">
      {/* Date */}
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
          <Calendar mode="single" selected={date ?? undefined} onSelect={setDatePart} initialFocus />
        </PopoverContent>
      </Popover>

      {/* Time */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-[132px] shrink-0 justify-start text-left font-normal"
          >
            <Clock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            {pad(hour12)}:{pad(minute)} {period}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="end">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Pick a time
          </div>
          <div className="flex gap-1">
            <Column
              values={HOURS}
              active={hour12}
              render={(v) => pad(Number(v))}
              onPick={(v) => setTime(Number(v), minute, period)}
            />
            <div className="flex items-center text-muted-foreground">:</div>
            <Column
              values={MINUTES}
              active={minute}
              render={(v) => pad(Number(v))}
              onPick={(v) => setTime(hour12, Number(v), period)}
            />
            <Column
              values={PERIODS as unknown as string[]}
              active={period}
              render={(v) => String(v)}
              onPick={(v) => setTime(hour12, minute, v as "AM" | "PM")}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
