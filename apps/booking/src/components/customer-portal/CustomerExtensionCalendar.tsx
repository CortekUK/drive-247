"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, DayContentProps } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
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

interface CustomerExtensionCalendarProps {
  /** The rental's current end date — shown as read-only and is not selectable */
  currentEndDate: Date;
  /** The new end date chosen by the customer */
  newEndDate: Date | undefined;
  onNewEndDateChange: (date: Date | undefined) => void;
  /** Occupied dates (other rentals, blocked dates) — rendered disabled/greyed */
  occupancyMap: Map<string, DateOccupancy[]>;
  occupancyModifiers: Record<DateOccupancyType, Date[]>;
  /** Optional extra disable predicate (e.g. past dates, before current end date) */
  disableDate?: (date: Date) => boolean;
  className?: string;
  error?: boolean;
}

/** Render occupied dates with a tooltip but strip colors — customer sees "disabled". */
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

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="relative">{dayNum}</span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[220px] text-xs z-[100]"
        >
          Unavailable
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const CALENDAR_CLASS_NAMES = {
  months: "flex flex-col sm:flex-row gap-6",
  month: "space-y-3",
  caption: "flex justify-center pt-1 relative items-center",
  caption_label: "text-sm font-semibold",
  nav: "space-x-1 flex items-center",
  nav_button_previous: "absolute left-1",
  nav_button_next: "absolute right-1",
  table: "w-full border-collapse",
  head_row: "flex",
  head_cell: "text-muted-foreground rounded-md w-10 font-normal text-[0.8rem]",
  row: "flex w-full mt-1",
  cell: "h-10 w-10 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
  day_today: "border-2 border-primary text-foreground",
  day_outside:
    "day-outside text-muted-foreground opacity-40 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
  day_disabled: "text-muted-foreground/60 opacity-40 cursor-not-allowed line-through decoration-muted-foreground/40",
  day_hidden: "invisible",
};

export function CustomerExtensionCalendar({
  currentEndDate,
  newEndDate,
  onNewEndDateChange,
  occupancyMap,
  occupancyModifiers,
  disableDate,
  className,
  error,
}: CustomerExtensionCalendarProps) {
  const [open, setOpen] = useState(false);

  // Merge all occupancy types into a single "unavailable" array so every
  // occupied date looks identical (grey/disabled). No colors for customers.
  const unavailableDates = useMemo(() => {
    return [
      ...occupancyModifiers.active,
      ...occupancyModifiers.pending,
      ...occupancyModifiers.upcoming,
      ...occupancyModifiers.blocked,
    ];
  }, [occupancyModifiers]);

  const isUnavailable = (date: Date) => {
    const key = date.toDateString();
    return occupancyMap.has(key);
  };

  // Final disabled predicate: customer's own disable rule OR occupied by another
  // rental/block. Occupied dates are not clickable.
  const combinedDisable = (date: Date) => {
    if (isUnavailable(date)) return true;
    return disableDate ? disableDate(date) : false;
  };

  const handleDayClick = (day: Date | undefined) => {
    if (!day) return;
    if (combinedDisable(day)) return;
    onNewEndDateChange(day);
  };

  const rangeModifiers = useMemo(() => {
    const mods: Record<string, Date[]> = { currentEnd: [currentEndDate] };
    if (newEndDate) mods.rangeEnd = [newEndDate];
    if (newEndDate && newEndDate > currentEndDate) {
      const inRange: Date[] = [];
      const current = new Date(currentEndDate);
      current.setDate(current.getDate() + 1);
      while (current < newEndDate) {
        inRange.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      mods.rangeMiddle = inRange;
    }
    return mods;
  }, [currentEndDate, newEndDate]);

  const allModifiers = useMemo(
    () => ({
      ...rangeModifiers,
      unavailable: unavailableDates,
    }),
    [rangeModifiers, unavailableDates]
  );

  const modifiersClassNames = {
    // Every occupied date is styled identically — greyed out, no color coding.
    unavailable:
      "!bg-muted/40 !text-muted-foreground/60 line-through decoration-muted-foreground/50 cursor-not-allowed hover:!bg-muted/40",
    currentEnd:
      "!bg-muted !text-foreground font-semibold ring-1 ring-inset ring-muted-foreground/30",
    rangeEnd:
      "!bg-primary !text-primary-foreground font-semibold ring-2 ring-primary",
    rangeMiddle: "!bg-primary/15 !text-foreground",
  };

  const displayText = newEndDate
    ? format(newEndDate, "MMM d, yyyy")
    : "Select new end date";

  const navButtonClass = cn(
    buttonVariants({ variant: "outline" }),
    "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
  );

  const dayClass = cn(
    buttonVariants({ variant: "ghost" }),
    "h-10 w-10 p-0 font-normal aria-selected:opacity-100"
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal w-full",
            !newEndDate && "text-muted-foreground",
            error && "border-destructive",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{displayText}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold">Select New End Date</DialogTitle>

          <div className="flex items-center gap-4 mt-2">
            <div className="flex-1 text-left px-3 py-2 rounded-lg border-2 border-muted bg-muted/30 cursor-default">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Current End Date
              </div>
              <div className="text-sm font-medium mt-0.5">
                {format(currentEndDate, "EEEE, MMM d, yyyy")}
              </div>
            </div>
            <div className="text-muted-foreground text-sm">→</div>
            <div
              className={cn(
                "flex-1 text-left px-3 py-2 rounded-lg border-2 transition-colors",
                newEndDate ? "border-primary bg-primary/5" : "border-muted"
              )}
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                New End Date
              </div>
              <div className="text-sm font-medium mt-0.5">
                {newEndDate
                  ? format(newEndDate, "EEEE, MMM d, yyyy")
                  : "Click a date below"}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pb-2">
          <DayPicker
            numberOfMonths={2}
            mode="single"
            selected={newEndDate}
            onSelect={handleDayClick}
            disabled={combinedDisable}
            showOutsideDays
            fixedWeeks
            defaultMonth={newEndDate || currentEndDate}
            modifiers={allModifiers}
            modifiersClassNames={modifiersClassNames}
            className="pointer-events-auto"
            classNames={{
              ...CALENDAR_CLASS_NAMES,
              nav_button: navButtonClass,
              day: dayClass,
            }}
            components={{
              IconLeft: () => <ChevronLeft className="h-4 w-4" />,
              IconRight: () => <ChevronRight className="h-4 w-4" />,
              DayContent: (dayProps) => (
                <DayWithTooltip {...dayProps} occupancyMap={occupancyMap} />
              ),
            }}
          />
        </div>

        <div className="px-6 pb-4 pt-2 border-t flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Greyed-out dates are unavailable.
          </p>
          <Button size="sm" onClick={() => setOpen(false)} disabled={!newEndDate}>
            {newEndDate ? "Done" : "Select a date"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
