"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
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
  isFullscreen,
  onToggleFullscreen,
}: CalendarHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onPrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="outline" size="icon" onClick={onNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium ml-2">
          {formatDateRange(rangeStart, rangeEnd)}
        </span>
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
