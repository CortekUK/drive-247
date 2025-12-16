import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, X } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  startDate?: Date;
  endDate?: Date;
  onDateRangeChange: (startDate?: Date, endDate?: Date) => void;
  placeholder?: string;
  className?: string;
}

export const DateRangeFilter = ({ 
  startDate, 
  endDate, 
  onDateRangeChange, 
  placeholder = "Select date range...",
  className 
}: DateRangeFilterProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const clearFilter = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDateRangeChange(undefined, undefined);
  };

  const formatDateRange = () => {
    if (startDate && endDate) {
      if (format(startDate, 'yyyy-MM') === format(endDate, 'yyyy-MM')) {
        return format(startDate, 'MMMM yyyy');
      }
      return `${format(startDate, 'MMM yyyy')} - ${format(endDate, 'MMM yyyy')}`;
    }
    if (startDate) {
      return `From ${format(startDate, 'MMM yyyy')}`;
    }
    if (endDate) {
      return `Until ${format(endDate, 'MMM yyyy')}`;
    }
    return placeholder;
  };

  const hasFilter = startDate || endDate;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full sm:w-auto justify-start text-left font-normal",
            !hasFilter && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formatDateRange()}
          {hasFilter && (
            <X 
              className="ml-auto h-4 w-4 hover:bg-muted rounded-sm p-0.5" 
              onClick={clearFilter}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-4 space-y-4">
          <div className="text-sm font-medium">Select Date Range</div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Start Date</label>
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={(date) => onDateRangeChange(date, endDate)}
                disabled={(date) => endDate ? date > endDate : false}
                initialFocus
              />
            </div>
            
            <div>
              <label className="text-xs text-muted-foreground">End Date</label>
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={(date) => onDateRangeChange(startDate, date)}
                disabled={(date) => startDate ? date < startDate : false}
                initialFocus
              />
            </div>
          </div>
          
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const now = new Date();
                const thisMonth = startOfMonth(now);
                const thisMonthEnd = endOfMonth(now);
                onDateRangeChange(thisMonth, thisMonthEnd);
              }}
            >
              This Month
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const now = new Date();
                const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastMonthEnd = endOfMonth(lastMonth);
                onDateRangeChange(startOfMonth(lastMonth), lastMonthEnd);
              }}
            >
              Last Month
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDateRangeChange(undefined, undefined)}
            >
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};