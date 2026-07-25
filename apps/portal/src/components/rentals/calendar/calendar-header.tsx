"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { ViewType, formatDateRange } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";

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
            <Calendar
              mode="single"
              selected={rangeStart}
              defaultMonth={rangeStart}
              // Month + year dropdowns so the operator can jump years ahead in one
              // pick (Sam gets bookings well out) instead of paging month-by-month.
              captionLayout="dropdown-buttons"
              fromYear={new Date().getFullYear() - 1}
              toYear={new Date().getFullYear() + 3}
              className="p-3 pointer-events-auto"
              onSelect={(date) => {
                if (date) {
                  onJumpToDate(date);
                  setJumpOpen(false);
                }
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
