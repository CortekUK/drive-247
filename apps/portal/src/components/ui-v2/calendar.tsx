"use client";

/**
 * The shadcn Calendar for v2, on the installed react-day-picker 8.
 *
 * `components/ui/calendar.tsx` is the v1 one: square days, a heavy 2px ring on
 * today, and v1 buttons. This is the same component with v2's parts: round
 * days, a quiet today, ui-v2 buttons, and uppercase weekday initials matching
 * the v2 table headers.
 *
 * Today and the selected day can be the same cell. react-day-picker joins its
 * class names without merging them, so today's colour is written as an
 * `aria-selected:` variant rather than a plain class that would fight the
 * selected fill for the same property.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui-v2/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        caption: "relative flex h-8 items-center justify-center",
        caption_label: "text-sm font-semibold",
        nav: "flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-8 rounded-full text-muted-foreground hover:text-foreground",
        ),
        nav_button_previous: "absolute left-0",
        nav_button_next: "absolute right-0",
        table: "w-full border-collapse",
        head_row: "flex",
        head_cell: "w-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        row: "mt-1 flex w-full",
        cell: "relative size-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "size-9 rounded-full p-0 font-normal tabular-nums aria-selected:opacity-100",
        ),
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "font-semibold text-primary aria-selected:text-primary-foreground",
        day_outside: "text-muted-foreground opacity-40 aria-selected:opacity-60",
        day_disabled: "text-muted-foreground opacity-30",
        day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="size-4" />,
        IconRight: () => <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
