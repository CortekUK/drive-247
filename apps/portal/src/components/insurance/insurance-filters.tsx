import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Calendar as CalendarIcon, 
  X, 
  Filter,
  Download,
  RotateCcw
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { type InsuranceFilters } from "@/hooks/use-insurance-data";

interface InsuranceFiltersProps {
  filters: InsuranceFilters;
  onFiltersChange: (filters: InsuranceFilters) => void;
  onExportCSV: () => void;
  onRecalculateStatus: () => void;
  isRecalculating?: boolean;
}

export function InsuranceFilters({
  filters,
  onFiltersChange,
  onExportCSV,
  onRecalculateStatus,
  isRecalculating = false
}: InsuranceFiltersProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const updateFilters = (updates: Partial<InsuranceFilters>) => {
    onFiltersChange({ ...filters, ...updates });
  };

  const clearDateRange = () => {
    updateFilters({
      dateRange: { from: undefined, to: undefined }
    });
  };

  const setQuickFilter = (days: number) => {
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + days);
    
    updateFilters({
      dateRange: { from: today, to: futureDate }
    });
  };

  const hasActiveFilters = 
    filters.search || 
    filters.status !== "all" || 
    filters.dateRange.from || 
    filters.dateRange.to;

  return (
    <div className="space-y-4">
      {/* Main Filters Row */}
      <div className="flex flex-wrap gap-4">
        {/* Search */}
        <div className="flex-1 min-w-[300px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by policy number, provider, customer, or vehicle..."
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className="pl-10"
          />
        </div>

        {/* Status Filter */}
        <Select 
          value={filters.status} 
          onValueChange={(status) => updateFilters({ status })}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="ExpiringSoon">Expiring Soon</SelectItem>
            <SelectItem value="Expired">Expired</SelectItem>
            <SelectItem value="Suspended">Suspended</SelectItem>
            <SelectItem value="Cancelled">Cancelled</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {/* Date Range Picker */}
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-64 justify-start text-left font-normal",
                !(filters.dateRange.from || filters.dateRange.to) && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {filters.dateRange.from ? (
                filters.dateRange.to ? (
                  <>
                    {format(filters.dateRange.from, "MMM dd")} -{" "}
                    {format(filters.dateRange.to, "MMM dd, yyyy")}
                  </>
                ) : (
                  format(filters.dateRange.from, "MMM dd, yyyy")
                )
              ) : (
                "Filter by expiry date"
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={filters.dateRange.from}
              selected={{
                from: filters.dateRange.from,
                to: filters.dateRange.to,
              }}
              onSelect={(range) => {
                updateFilters({
                  dateRange: {
                    from: range?.from,
                    to: range?.to,
                  }
                });
              }}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        {/* Actions */}
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={onExportCSV}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          
          <Button 
            variant="outline" 
            onClick={onRecalculateStatus}
            disabled={isRecalculating}
            className="flex items-center gap-2"
          >
            <RotateCcw className={cn("h-4 w-4", isRecalculating && "animate-spin")} />
            {isRecalculating ? "Updating..." : "Recalc Status"}
          </Button>
        </div>
      </div>

      {/* Quick Filters & Active Filters */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        {/* Quick Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Quick filters:</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickFilter(30)}
            className="h-7 text-xs"
          >
            Next 30 days
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickFilter(90)}
            className="h-7 text-xs"
          >
            Next 90 days
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const today = new Date();
              updateFilters({
                dateRange: { from: undefined, to: today },
                status: "all"
              });
            }}
            className="h-7 text-xs"
          >
            Overdue
          </Button>
        </div>

        {/* Active Filters */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Active filters:</span>
            {filters.search && (
              <Badge variant="secondary" className="flex items-center gap-1">
                Search: "{filters.search}"
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => updateFilters({ search: "" })}
                />
              </Badge>
            )}
            {filters.status !== "all" && (
              <Badge variant="secondary" className="flex items-center gap-1">
                Status: {filters.status}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => updateFilters({ status: "all" })}
                />
              </Badge>
            )}
            {(filters.dateRange.from || filters.dateRange.to) && (
              <Badge variant="secondary" className="flex items-center gap-1">
                Date Range
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={clearDateRange}
                />
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFiltersChange({
                search: "",
                status: "all",
                dateRange: { from: undefined, to: undefined }
              })}
              className="h-7 text-xs"
            >
              Clear All
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}