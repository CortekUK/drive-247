import { useState, useEffect } from "react";
import { Search, Filter, Calendar, X, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";

interface RentalsFiltersProps {
  filters: RentalFilters;
  onFiltersChange: (filters: RentalFilters) => void;
  onClearFilters: () => void;
}

export const RentalsFilters = ({ filters, onFiltersChange, onClearFilters }: RentalsFiltersProps) => {
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(filters.search || "");
  const [localDurationMin, setLocalDurationMin] = useState(filters.durationMin?.toString() || "");
  const [localDurationMax, setLocalDurationMax] = useState(filters.durationMax?.toString() || "");

  // Sync local state when filters are cleared externally
  useEffect(() => {
    setLocalSearch(filters.search || "");
    setLocalDurationMin(filters.durationMin?.toString() || "");
    setLocalDurationMax(filters.durationMax?.toString() || "");
  }, [filters.search, filters.durationMin, filters.durationMax]);

  // Debounce search filter updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== (filters.search || "")) {
        onFiltersChange({ ...filters, search: localSearch, page: 1 });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [localSearch]);

  // Debounce duration filter updates
  useEffect(() => {
    const timer = setTimeout(() => {
      const minValue = localDurationMin ? parseInt(localDurationMin) : undefined;
      const maxValue = localDurationMax ? parseInt(localDurationMax) : undefined;

      if (minValue !== filters.durationMin || maxValue !== filters.durationMax) {
        onFiltersChange({ ...filters, durationMin: minValue, durationMax: maxValue, duration: "all", page: 1 });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [localDurationMin, localDurationMax]);

  const updateFilter = (key: keyof RentalFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value, page: 1 });
  };

  // Helper to fix timezone issues with date picker
  const normalizeDate = (date: Date | undefined) => {
    if (!date) return undefined;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  };

  const hasActiveFilters = Object.values(filters).some(value => 
    value && value !== "all" && value !== "" && value !== 1
  );

  return (
    <div className="space-y-4">
      {/* Quick Filter Buttons */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Button
          variant={filters.status === 'Pending' ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateFilter('status', filters.status === 'Pending' ? 'all' : 'Pending')}
          className="whitespace-nowrap"
        >
          <Clock className="mr-2 h-4 w-4 flex-shrink-0" />
          <span className="hidden xs:inline">New Bookings</span>
          <span className="xs:hidden">New</span>
          {filters.status === 'Pending' && <X className="ml-2 h-3 w-3 flex-shrink-0" />}
        </Button>
        <Button
          variant={filters.captureStatus === 'requires_capture' ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateFilter('captureStatus', filters.captureStatus === 'requires_capture' ? undefined : 'requires_capture')}
          className="whitespace-nowrap"
        >
          <AlertCircle className="mr-2 h-4 w-4 flex-shrink-0" />
          <span className="hidden xs:inline">Pending Approval</span>
          <span className="xs:hidden">Pending</span>
          {filters.captureStatus === 'requires_capture' && <X className="ml-2 h-3 w-3 flex-shrink-0" />}
        </Button>
      </div>

      {/* Search and main filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px] sm:min-w-[300px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by customer, vehicle reg, or rental #..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <Select value={filters.status || "all"} onValueChange={(value) => updateFilter("status", value)}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-2rem)]">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.customerType || "all"} onValueChange={(value) => updateFilter("customerType", value)}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Customer Type" />
          </SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-2rem)]">
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Individual">Individual</SelectItem>
            <SelectItem value="Company">Company</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex gap-2 items-center flex-wrap w-full sm:w-auto">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Duration (mo):</span>
=======
        <div className="flex gap-2 items-center flex-wrap w-full sm:w-auto">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Duration (mo):</span>
>>>>>>> b7fb88f (UI for mobile mode fixed for booking and portal)
          <Input
            type="number"
            placeholder="Min"
            value={localDurationMin}
            onChange={(e) => setLocalDurationMin(e.target.value)}
            className="w-[70px] sm:w-[80px]"
            min="0"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            placeholder="Max"
            value={localDurationMax}
            onChange={(e) => setLocalDurationMax(e.target.value)}
            className="w-[70px] sm:w-[80px]"
            min="0"
          />
        </div>

        <Select value={filters.initialPayment || "all"} onValueChange={(value) => updateFilter("initialPayment", value)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Initial Payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Rentals</SelectItem>
            <SelectItem value="set">Initial Fee Paid</SelectItem>
            <SelectItem value="missing">Initial Fee Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Advanced filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground">Start Date:</span>
          
          <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[120px] justify-start text-left font-normal",
                  !filters.startDateFrom && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {filters.startDateFrom ? format(filters.startDateFrom, "MMM dd") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={filters.startDateFrom}
                onSelect={(date) => {
                  updateFilter("startDateFrom", normalizeDate(date));
                  setStartDateOpen(false);
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[120px] justify-start text-left font-normal",
                  !filters.startDateTo && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {filters.startDateTo ? format(filters.startDateTo, "MMM dd") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={filters.startDateTo}
                onSelect={(date) => {
                  updateFilter("startDateTo", normalizeDate(date));
                  setEndDateOpen(false);
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        <Select value={filters.sortBy || "start_date"} onValueChange={(value) => updateFilter("sortBy", value)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="start_date">Start Date</SelectItem>
            <SelectItem value="end_date">End Date</SelectItem>
            <SelectItem value="monthly_amount">Monthly Amount</SelectItem>
            <SelectItem value="rental_number">Rental #</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.sortOrder || "desc"} onValueChange={(value) => updateFilter("sortOrder", value)}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Desc</SelectItem>
            <SelectItem value="asc">Asc</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="outline" onClick={onClearFilters} className="gap-2">
            <X className="h-4 w-4" />
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  );
};