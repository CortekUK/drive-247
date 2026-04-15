import * as React from "react";
import { useState, useCallback } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { DayPicker, DayContentProps } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DateOccupancy } from "@/hooks/use-vehicle-booked-dates";

interface RentalDateRangePickerProps {
  startDate?: Date;
  endDate?: Date;
  onStartDateChange: (date: Date | undefined) => void;
  onEndDateChange: (date: Date | undefined) => void;
  occupancyMap: Map<string, DateOccupancy[]>;
  disableDate?: (date: Date) => boolean;
  className?: string;
  error?: boolean;
}

const OCCUPANCY_COLORS = {
  active: {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-800 dark:text-emerald-300",
    dot: "bg-emerald-500",
    border: "ring-1 ring-emerald-300 dark:ring-emerald-700",
  },
  pending: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500",
    border: "ring-1 ring-amber-300 dark:ring-amber-700",
  },
  upcoming: {
    bg: "bg-purple-100 dark:bg-purple-900/40",
    text: "text-purple-800 dark:text-purple-300",
    dot: "bg-purple-500",
    border: "ring-1 ring-purple-300 dark:ring-purple-700",
  },
  blocked: {
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-800 dark:text-red-300",
    dot: "bg-red-500",
    border: "ring-1 ring-red-300 dark:ring-red-700",
  },
};

const TYPE_PRIORITY: Record<string, number> = {
  blocked: 4,
  active: 3,
  pending: 2,
  upcoming: 1,
};

function DayWithOccupancy({
  date,
  displayMonth,
  occupancyMap,
  startDate,
  endDate,
}: DayContentProps & {
  occupancyMap: Map<string, DateOccupancy[]>;
  startDate?: Date;
  endDate?: Date;
}) {
  const key = date.toDateString();
  const occupancies = occupancyMap.get(key);
  const isOutside = date.getMonth() !== displayMonth.getMonth();

  // Check if this date is in the selected range
  const isStart = startDate && date.toDateString() === startDate.toDateString();
  const isEnd = endDate && date.toDateString() === endDate.toDateString();
  const isInRange =
    startDate &&
    endDate &&
    date > startDate &&
    date < endDate;

  if (!occupancies || occupancies.length === 0 || isOutside) {
    return (
      <span
        className={cn(
          "relative flex items-center justify-center w-full h-full rounded-md",
          isStart && "bg-primary text-primary-foreground font-semibold",
          isEnd && "bg-primary text-primary-foreground font-semibold",
          isInRange && "bg-primary/15 text-foreground"
        )}
      >
        {date.getDate()}
      </span>
    );
  }

  const primaryType = occupancies.reduce((best, occ) =>
    (TYPE_PRIORITY[occ.type] || 0) > (TYPE_PRIORITY[best.type] || 0) ? occ : best
  ).type;

  const colors = OCCUPANCY_COLORS[primaryType];
  const uniqueLabels = [...new Set(occupancies.map((o) => o.label))];
  const tooltipText = uniqueLabels.join("\n");

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "relative flex items-center justify-center w-full h-full rounded-md",
              isStart || isEnd
                ? "bg-primary text-primary-foreground font-semibold ring-2 ring-primary"
                : cn(colors.bg, colors.text, colors.border),
              isInRange && !isStart && !isEnd && "ring-2 ring-primary/30"
            )}
          >
            {date.getDate()}
            {occupancies.length > 1 && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-foreground/40" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[280px] text-xs whitespace-pre-line z-[100]"
        >
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const RentalDateRangePicker = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  occupancyMap,
  disableDate,
  className,
  error,
}: RentalDateRangePickerProps) => {
  const [open, setOpen] = useState(false);
  // "start" = selecting start date, "end" = selecting end date
  const [selecting, setSelecting] = useState<"start" | "end">("start");

  const handleDayClick = useCallback(
    (day: Date | undefined) => {
      if (!day) return;

      if (selecting === "start") {
        onStartDateChange(day);
        // If end date is before new start, clear it
        if (endDate && day >= endDate) {
          onEndDateChange(undefined);
        }
        setSelecting("end");
      } else {
        // Selecting end date
        if (startDate && day <= startDate) {
          // If clicked before start, treat as new start
          onStartDateChange(day);
          onEndDateChange(undefined);
          setSelecting("end");
        } else {
          onEndDateChange(day);
          setSelecting("start");
          // Don't close — user might want to adjust
        }
      }
    },
    [selecting, startDate, endDate, onStartDateChange, onEndDateChange]
  );

  const displayText = () => {
    if (startDate && endDate) {
      return `${format(startDate, "MMM d, yyyy")} — ${format(endDate, "MMM d, yyyy")}`;
    }
    if (startDate) {
      return `${format(startDate, "MMM d, yyyy")} — Select end date`;
    }
    return "Select rental dates";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setSelecting(startDate ? "end" : "start"); }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal w-full",
            !startDate && "text-muted-foreground",
            error && "border-destructive",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{displayText()}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold">Select Rental Dates</DialogTitle>
          <div className="flex items-center gap-4 mt-2">
            <button
              type="button"
              onClick={() => setSelecting("start")}
              className={cn(
                "flex-1 text-left px-3 py-2 rounded-lg border-2 transition-colors",
                selecting === "start"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30"
              )}
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Start Date</div>
              <div className="text-sm font-medium mt-0.5">
                {startDate ? format(startDate, "EEEE, MMM d, yyyy") : "Click a date below"}
              </div>
            </button>
            <div className="text-muted-foreground text-sm">→</div>
            <button
              type="button"
              onClick={() => { if (startDate) setSelecting("end"); }}
              className={cn(
                "flex-1 text-left px-3 py-2 rounded-lg border-2 transition-colors",
                selecting === "end"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30",
                !startDate && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">End Date</div>
              <div className="text-sm font-medium mt-0.5">
                {endDate ? format(endDate, "EEEE, MMM d, yyyy") : startDate ? "Click a date below" : "—"}
              </div>
            </button>
          </div>
        </DialogHeader>

        <div className="px-6 pb-2">
          <DayPicker
            numberOfMonths={2}
            mode="single"
            selected={selecting === "start" ? startDate : endDate}
            onSelect={handleDayClick}
            disabled={disableDate}
            showOutsideDays={true}
            fixedWeeks={true}
            defaultMonth={startDate || new Date()}
            className="pointer-events-auto"
            classNames={{
              months: "flex gap-6",
              month: "space-y-3",
              caption: "flex justify-center pt-1 relative items-center",
              caption_label: "text-sm font-semibold",
              nav: "space-x-1 flex items-center",
              nav_button: cn(
                buttonVariants({ variant: "outline" }),
                "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
              ),
              nav_button_previous: "absolute left-1",
              nav_button_next: "absolute right-1",
              table: "w-full border-collapse",
              head_row: "flex",
              head_cell:
                "text-muted-foreground rounded-md w-10 font-normal text-[0.8rem]",
              row: "flex w-full mt-1",
              cell: "h-10 w-10 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
              day: cn(
                buttonVariants({ variant: "ghost" }),
                "h-10 w-10 p-0 font-normal aria-selected:opacity-100"
              ),
              day_range_end: "day-range-end",
              day_selected:
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              day_today: "border-2 border-primary text-foreground",
              day_outside:
                "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
              day_disabled: "text-muted-foreground opacity-50",
              day_hidden: "invisible",
            }}
            components={{
              IconLeft: ({ ..._props }) => (
                <ChevronLeft className="h-4 w-4" />
              ),
              IconRight: ({ ..._props }) => (
                <ChevronRight className="h-4 w-4" />
              ),
              DayContent: (props) => (
                <DayWithOccupancy
                  {...props}
                  occupancyMap={occupancyMap}
                  startDate={startDate}
                  endDate={endDate}
                />
              ),
            }}
          />
        </div>

        {/* Legend + Done */}
        <div className="px-6 pb-4 pt-2 border-t flex items-center justify-between">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-900/40 ring-1 ring-emerald-300" />
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-300" />
              <span className="text-xs text-muted-foreground">Pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-purple-100 dark:bg-purple-900/40 ring-1 ring-purple-300" />
              <span className="text-xs text-muted-foreground">Upcoming</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-red-100 dark:bg-red-900/40 ring-1 ring-red-300" />
              <span className="text-xs text-muted-foreground">Blocked</span>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setOpen(false)}
            disabled={!startDate}
          >
            {startDate && endDate ? "Done" : startDate ? "Select end date" : "Select dates"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
