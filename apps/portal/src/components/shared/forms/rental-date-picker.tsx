import * as React from "react";
import { useState, useCallback, useMemo } from "react";
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
import type {
  DateOccupancy,
  DateOccupancyType,
} from "@/hooks/use-vehicle-booked-dates";

interface BaseProps {
  startDate?: Date;
  endDate?: Date;
  occupancyMap: Map<string, DateOccupancy[]>;
  occupancyModifiers: Record<DateOccupancyType, Date[]>;
  disableDate?: (date: Date) => boolean;
  className?: string;
  error?: boolean;
}

interface RangeMode extends BaseProps {
  /** Both start and end dates are selectable (default for new rentals) */
  mode?: "range";
  onStartDateChange: (date: Date | undefined) => void;
  onEndDateChange: (date: Date | undefined) => void;
  title?: string;
}

interface EndOnlyMode extends BaseProps {
  /** Only end date is selectable (for extensions — start date is read-only) */
  mode: "end-only";
  onStartDateChange?: never;
  onEndDateChange: (date: Date | undefined) => void;
  title?: string;
}

export type RentalDateRangePickerProps = RangeMode | EndOnlyMode;

/**
 * Modifier class names applied directly to the day <button> element
 * by react-day-picker's modifiers system.
 */
const MODIFIER_CLASSES: Record<DateOccupancyType, string> = {
  active:
    "!bg-emerald-100 !text-emerald-800 dark:!bg-emerald-900/40 dark:!text-emerald-300 ring-1 ring-inset ring-emerald-300 dark:ring-emerald-700",
  pending:
    "!bg-amber-100 !text-amber-800 dark:!bg-amber-900/40 dark:!text-amber-300 ring-1 ring-inset ring-amber-300 dark:ring-amber-700",
  upcoming:
    "!bg-purple-100 !text-purple-800 dark:!bg-purple-900/40 dark:!text-purple-300 ring-1 ring-inset ring-purple-300 dark:ring-purple-700",
  blocked:
    "!bg-red-100 !text-red-800 dark:!bg-red-900/40 dark:!text-red-300 ring-1 ring-inset ring-red-300 dark:ring-red-700",
};

/**
 * DayContent override — only adds tooltip for occupied dates.
 * Background colors are handled by modifiers on the button itself.
 */
function DayWithTooltip({
  date,
  displayMonth,
  occupancyMap,
}: DayContentProps & {
  occupancyMap: Map<string, DateOccupancy[]>;
}) {
  const key = date.toDateString();
  const occupancies = occupancyMap.get(key);
  const isOutside = date.getMonth() !== displayMonth.getMonth();
  const dayNum = date.getDate();

  if (!occupancies || occupancies.length === 0 || isOutside) {
    return <span>{dayNum}</span>;
  }

  const uniqueLabels = [...new Set(occupancies.map((o) => o.label))];
  const tooltipText = uniqueLabels.join("\n");

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="relative">
            {dayNum}
            {occupancies.length > 1 && (
              <span className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-foreground/50" />
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

/** Shared calendar classNames */
const CALENDAR_CLASS_NAMES = {
  months: "flex gap-6",
  month: "space-y-3",
  caption: "flex justify-center pt-1 relative items-center",
  caption_label: "text-sm font-semibold",
  nav: "space-x-1 flex items-center",
  nav_button_previous: "absolute left-1",
  nav_button_next: "absolute right-1",
  table: "w-full border-collapse",
  head_row: "flex",
  head_cell:
    "text-muted-foreground rounded-md w-10 font-normal text-[0.8rem]",
  row: "flex w-full mt-1",
  cell: "h-10 w-10 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
  day_range_end: "day-range-end",
  day_selected: "",
  day_today: "border-2 border-primary text-foreground",
  day_outside:
    "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
  day_disabled: "text-muted-foreground opacity-50",
  day_hidden: "invisible",
};

/** Legend bar shown at the bottom of the calendar */
function OccupancyLegend() {
  return (
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
  );
}

export const RentalDateRangePicker = (props: RentalDateRangePickerProps) => {
  const {
    startDate,
    endDate,
    onEndDateChange,
    occupancyMap,
    occupancyModifiers,
    disableDate,
    className,
    error,
    title,
  } = props;

  const isEndOnly = props.mode === "end-only";
  const onStartDateChange = isEndOnly ? undefined : props.onStartDateChange;

  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState<"start" | "end">(
    isEndOnly ? "end" : "start"
  );

  const handleDayClick = useCallback(
    (day: Date | undefined) => {
      if (!day) return;

      if (isEndOnly) {
        // End-only mode: always set end date
        onEndDateChange(day);
        return;
      }

      if (selecting === "start") {
        onStartDateChange?.(day);
        if (endDate && day >= endDate) {
          onEndDateChange(undefined);
        }
        setSelecting("end");
      } else {
        if (startDate && day <= startDate) {
          onStartDateChange?.(day);
          onEndDateChange(undefined);
          setSelecting("end");
        } else {
          onEndDateChange(day);
          setSelecting("start");
        }
      }
    },
    [
      isEndOnly,
      selecting,
      startDate,
      endDate,
      onStartDateChange,
      onEndDateChange,
    ]
  );

  // Build range highlight modifiers for start/end/in-range
  const rangeModifiers = useMemo(() => {
    const mods: Record<string, Date[]> = {};
    if (startDate) mods.rangeStart = [startDate];
    if (endDate) mods.rangeEnd = [endDate];
    if (startDate && endDate) {
      const inRange: Date[] = [];
      const current = new Date(startDate);
      current.setDate(current.getDate() + 1);
      while (current < endDate) {
        inRange.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      mods.rangeMiddle = inRange;
    }
    return mods;
  }, [startDate, endDate]);

  const allModifiers = useMemo(
    () => ({
      ...occupancyModifiers,
      ...rangeModifiers,
    }),
    [occupancyModifiers, rangeModifiers]
  );

  const allModifiersClassNames = useMemo(
    () => ({
      ...MODIFIER_CLASSES,
      rangeStart:
        "!bg-primary !text-primary-foreground font-semibold ring-2 ring-primary",
      rangeEnd:
        "!bg-primary !text-primary-foreground font-semibold ring-2 ring-primary",
      rangeMiddle: "!bg-primary/15 !text-foreground",
    }),
    []
  );

  const displayText = () => {
    if (isEndOnly) {
      return endDate
        ? format(endDate, "MMM d, yyyy")
        : "Select new end date";
    }
    if (startDate && endDate) {
      return `${format(startDate, "MMM d, yyyy")} — ${format(endDate, "MMM d, yyyy")}`;
    }
    if (startDate) {
      return `${format(startDate, "MMM d, yyyy")} — Select end date`;
    }
    return "Select rental dates";
  };

  const navButtonClass = cn(
    buttonVariants({ variant: "outline" }),
    "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
  );

  const dayClass = cn(
    buttonVariants({ variant: "ghost" }),
    "h-10 w-10 p-0 font-normal aria-selected:opacity-100"
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setSelecting(isEndOnly ? "end" : startDate ? "end" : "start");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal w-full",
            !startDate && !endDate && "text-muted-foreground",
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
          <DialogTitle className="text-lg font-semibold">
            {title || (isEndOnly ? "Select New End Date" : "Select Rental Dates")}
          </DialogTitle>

          {/* Date selector pills */}
          <div className="flex items-center gap-4 mt-2">
            {/* Start date */}
            <button
              type="button"
              onClick={() => {
                if (!isEndOnly) setSelecting("start");
              }}
              className={cn(
                "flex-1 text-left px-3 py-2 rounded-lg border-2 transition-colors",
                isEndOnly
                  ? "border-muted bg-muted/30 cursor-default"
                  : selecting === "start"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
              )}
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {isEndOnly ? "Current End Date" : "Start Date"}
              </div>
              <div className="text-sm font-medium mt-0.5">
                {startDate
                  ? format(startDate, "EEEE, MMM d, yyyy")
                  : isEndOnly
                    ? "—"
                    : "Click a date below"}
              </div>
            </button>
            <div className="text-muted-foreground text-sm">→</div>
            {/* End date */}
            <button
              type="button"
              onClick={() => {
                if (isEndOnly || startDate) setSelecting("end");
              }}
              className={cn(
                "flex-1 text-left px-3 py-2 rounded-lg border-2 transition-colors",
                selecting === "end"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30",
                !isEndOnly && !startDate && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {isEndOnly ? "New End Date" : "End Date"}
              </div>
              <div className="text-sm font-medium mt-0.5">
                {endDate
                  ? format(endDate, "EEEE, MMM d, yyyy")
                  : isEndOnly || startDate
                    ? "Click a date below"
                    : "—"}
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
            defaultMonth={
              isEndOnly
                ? startDate || new Date()
                : startDate || new Date()
            }
            modifiers={allModifiers}
            modifiersClassNames={allModifiersClassNames}
            className="pointer-events-auto"
            classNames={{
              ...CALENDAR_CLASS_NAMES,
              nav_button: navButtonClass,
              day: dayClass,
            }}
            components={{
              IconLeft: ({ ..._props }) => (
                <ChevronLeft className="h-4 w-4" />
              ),
              IconRight: ({ ..._props }) => (
                <ChevronRight className="h-4 w-4" />
              ),
              DayContent: (dayProps) => (
                <DayWithTooltip {...dayProps} occupancyMap={occupancyMap} />
              ),
            }}
          />
        </div>

        {/* Legend + Done */}
        <div className="px-6 pb-4 pt-2 border-t flex items-center justify-between">
          <OccupancyLegend />
          <Button
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isEndOnly ? !endDate : !startDate}
          >
            {isEndOnly
              ? endDate
                ? "Done"
                : "Select a date"
              : startDate && endDate
                ? "Done"
                : startDate
                  ? "Select end date"
                  : "Select dates"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
