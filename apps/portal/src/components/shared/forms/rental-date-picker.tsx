import * as React from "react";
import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { DayPicker, DayContentProps } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DateOccupancy } from "@/hooks/use-vehicle-booked-dates";

interface RentalDatePickerProps {
  date?: Date;
  onSelect: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: (date: Date) => boolean;
  className?: string;
  error?: boolean;
  occupancyMap: Map<string, DateOccupancy[]>;
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

// Priority: blocked > active > pending > upcoming
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
}: DayContentProps & { occupancyMap: Map<string, DateOccupancy[]> }) {
  const key = date.toDateString();
  const occupancies = occupancyMap.get(key);
  const isOutside = date.getMonth() !== displayMonth.getMonth();

  if (!occupancies || occupancies.length === 0 || isOutside) {
    return <span>{date.getDate()}</span>;
  }

  // Get highest priority type for background color
  const primaryType = occupancies.reduce((best, occ) =>
    (TYPE_PRIORITY[occ.type] || 0) > (TYPE_PRIORITY[best.type] || 0) ? occ : best
  ).type;

  const colors = OCCUPANCY_COLORS[primaryType];

  // Build tooltip content — deduplicate labels
  const uniqueLabels = [...new Set(occupancies.map((o) => o.label))];
  const tooltipText = uniqueLabels.join("\n");

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "relative flex items-center justify-center w-full h-full rounded-md",
              colors.bg,
              colors.text,
              colors.border
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
          className="max-w-[250px] text-xs whitespace-pre-line"
        >
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const RentalDatePicker = ({
  date,
  onSelect,
  placeholder = "Pick a date",
  disabled,
  className,
  error,
  occupancyMap,
}: RentalDatePickerProps) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal",
            !date && "text-muted-foreground",
            error && "border-destructive",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DayPicker
          mode="single"
          selected={date}
          onSelect={(selectedDate) => {
            onSelect(selectedDate);
            setOpen(false);
          }}
          disabled={disabled}
          showOutsideDays={true}
          fixedWeeks={true}
          className={cn("p-3 min-h-[280px] pointer-events-auto")}
          classNames={{
            months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
            month: "space-y-4",
            caption: "flex justify-center pt-1 relative items-center",
            caption_label: "text-sm font-medium",
            nav: "space-x-1 flex items-center",
            nav_button: cn(
              buttonVariants({ variant: "outline" }),
              "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
            ),
            nav_button_previous: "absolute left-1",
            nav_button_next: "absolute right-1",
            table: "w-full border-collapse space-y-1",
            head_row: "flex",
            head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
            row: "flex w-full mt-2",
            cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
            day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
            day_range_end: "day-range-end",
            day_selected:
              "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
            day_today: "border-2 border-primary text-foreground",
            day_outside:
              "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
            day_disabled: "text-muted-foreground opacity-50",
            day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
            day_hidden: "invisible",
          }}
          components={{
            IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
            IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
            DayContent: (props) => (
              <DayWithOccupancy {...props} occupancyMap={occupancyMap} />
            ),
          }}
        />
        {/* Legend */}
        <div className="px-3 pb-3 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-[10px] text-muted-foreground">Pending</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
            <span className="text-[10px] text-muted-foreground">Upcoming</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-[10px] text-muted-foreground">Blocked</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
