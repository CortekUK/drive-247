"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { ViewType, formatDateRange } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Clean month/year jumper. Two on-brand <Select>s drive a controlled calendar,
// so the operator can leap to any month/year (Sam books far ahead) in a single
// pick — no react-day-picker native dropdown clutter. Mounted fresh each time the
// popover opens (Radix unmounts content on close), so it always starts on the
// current view.
function JumpPicker({
  anchor,
  onJump,
}: {
  anchor: Date;
  onJump: (date: Date) => void;
}) {
  const [displayMonth, setDisplayMonth] = useState<Date>(anchor);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 12 }, (_, i) => thisYear - 1 + i); // last year → +10

  return (
    <div className="w-[268px] space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Select
          value={String(displayMonth.getMonth())}
          onValueChange={(v) =>
            setDisplayMonth(new Date(displayMonth.getFullYear(), Number(v), 1))
          }
        >
          <SelectTrigger className="h-8 flex-1 text-sm" aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(displayMonth.getFullYear())}
          onValueChange={(v) =>
            setDisplayMonth(new Date(Number(v), displayMonth.getMonth(), 1))
          }
        >
          <SelectTrigger className="h-8 w-[86px] text-sm" aria-label="Year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
        month={displayMonth}
        onMonthChange={setDisplayMonth}
        selected={anchor}
        onSelect={(date) => date && onJump(date)}
        // The selects are the month/year control, so hide the calendar's own
        // caption entirely to keep the popover clean and minimal.
        classNames={{ caption: "hidden" }}
        className="p-0 pointer-events-auto"
      />
    </div>
  );
}

interface CalendarHeaderProps {
  rangeStart: Date;
  rangeEnd: Date;
  viewType: ViewType;
  onViewTypeChange: (type: ViewType) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onJumpToDate: (date: Date) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function CalendarHeader({
  rangeStart,
  rangeEnd,
  viewType,
  onViewTypeChange,
  onPrev,
  onNext,
  onToday,
  onJumpToDate,
  isFullscreen,
  onToggleFullscreen,
}: CalendarHeaderProps) {
  const [jumpOpen, setJumpOpen] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        <Button variant="outline" size="icon" onClick={onPrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="outline" size="icon" onClick={onNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Popover open={jumpOpen} onOpenChange={setJumpOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label="Jump to date"
              className="sm:ml-2 gap-1.5 font-medium"
            >
              <CalendarIcon className="h-4 w-4" />
              <span className="text-xs sm:text-sm">
                {formatDateRange(rangeStart, rangeEnd)}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <JumpPicker
              anchor={rangeStart}
              onJump={(date) => {
                onJumpToDate(date);
                setJumpOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-2">
      {/* Week / Month toggle */}
      <div className="flex rounded-md border overflow-hidden">
        <button
          className={cn(
            "px-3 py-1 text-xs font-medium transition-colors",
            viewType === "week"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          )}
          onClick={() => onViewTypeChange("week")}
        >
          Week
        </button>
        <button
          className={cn(
            "px-3 py-1 text-xs font-medium transition-colors border-l",
            viewType === "month"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          )}
          onClick={() => onViewTypeChange("month")}
        >
          Month
        </button>
      </div>

      <Button variant="outline" size="icon" onClick={onToggleFullscreen}>
        {isFullscreen ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </Button>
      </div>
    </div>
  );
}
