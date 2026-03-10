import * as React from "react";
import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DatePickerInputProps {
  date?: Date;
  onSelect: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: (date: Date) => boolean;
  className?: string;
  error?: boolean;
}

export const DatePickerInput = ({
  date,
  onSelect,
  placeholder = "Pick a date",
  disabled,
  className,
  error,
}: DatePickerInputProps) => {
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
        <Calendar
          mode="single"
          selected={date}
          onSelect={(selectedDate) => {
            onSelect(selectedDate);
            setOpen(false);
          }}
          disabled={disabled}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
};
