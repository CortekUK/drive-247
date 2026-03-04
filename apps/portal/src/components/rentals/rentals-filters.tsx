import { useState, useEffect } from "react";
import { Search, X, Calendar, ArrowRightLeft, ChevronDown, Ban, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";

interface RentalsFiltersProps {
  filters: RentalFilters;
  onFiltersChange: (filters: RentalFilters) => void;
  onClearFilters: () => void;
}

export const RentalsFilters = ({ filters, onFiltersChange, onClearFilters }: RentalsFiltersProps) => {
  const [localSearch, setLocalSearch] = useState(filters.search || "");
  const [dateOpen, setDateOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  // Sync local state when filters are cleared externally
  useEffect(() => {
    setLocalSearch(filters.search || "");
  }, [filters.search]);

  // Debounce search filter updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== (filters.search || "")) {
        onFiltersChange({ ...filters, search: localSearch, page: 1 });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [localSearch]);

  const updateFilter = (key: keyof RentalFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value, page: 1 });
  };

  const normalizeDate = (date: Date | undefined) => {
    if (!date) return undefined;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  };

  const hasActiveFilters =
    (filters.status && filters.status !== "all") ||
    filters.bonzahStatus ||
    filters.extensionRequested ||
    filters.cancellationRequested ||
    filters.startDateFrom ||
    filters.startDateTo ||
    filters.search;

  const hasDateFilter = filters.startDateFrom || filters.startDateTo;

  const statusOptions = [
    { value: 'active', label: 'Active', color: '#22c55e' },
    { value: 'upcoming', label: 'Upcoming', color: '#3b82f6' },
    { value: 'pending', label: 'Pending', color: '#eab308' },
    { value: 'closed', label: 'Completed', color: '#a855f7' },
    { value: 'cancelled', label: 'Cancelled', color: '#ef4444' },
  ] as const;

  const activeStatusOption = statusOptions.find(s => s.value === filters.status?.toLowerCase());

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative w-full sm:w-[320px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search customer, reg, rental #..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10 h-8 text-sm"
          />
        </div>

        {/* Status + Date grouped */}
        <div className="flex items-center">
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 rounded-r-none border-r-0", activeStatusOption && "border-primary")}
              >
                {activeStatusOption ? (
                  <>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeStatusOption.color }} />
                    <span style={{ color: activeStatusOption.color }}>{activeStatusOption.label}</span>
                  </>
                ) : (
                  "Status"
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <div className="flex flex-col gap-1">
                {statusOptions.map(({ value, label, color }) => {
                  const isActive = filters.status?.toLowerCase() === value;
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        updateFilter('status', isActive ? 'all' : value);
                        setStatusOpen(false);
                      }}
                      className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors text-left"
                      style={{
                        backgroundColor: isActive ? `${color}25` : 'transparent',
                        color: color,
                      }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("rounded-l-none px-2", hasDateFilter && "border-primary text-primary")}
              >
                <Calendar className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="end">
            <div className="flex gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">From</p>
                <CalendarComponent
                  mode="single"
                  selected={filters.startDateFrom}
                  onSelect={(date) => updateFilter("startDateFrom", normalizeDate(date))}
                  className="p-0 pointer-events-auto"
                />
              </div>
              <div className="space-y-1 border-l pl-4">
                <p className="text-xs font-medium text-muted-foreground">To</p>
                <CalendarComponent
                  mode="single"
                  selected={filters.startDateTo}
                  onSelect={(date) => updateFilter("startDateTo", normalizeDate(date))}
                  className="p-0 pointer-events-auto"
                />
              </div>
            </div>
              {hasDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    onFiltersChange({ ...filters, startDateFrom: undefined, startDateTo: undefined, page: 1 });
                  }}
                >
                  Clear dates
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Requests + Ins. Quoted pushed right */}
        <div className="flex flex-wrap gap-3 items-center sm:ml-auto">

        {/* Requests group */}
        <div className="flex items-center border rounded-md overflow-hidden">
          <span className="text-xs text-muted-foreground px-2.5 shrink-0">Requests</span>
          <div className="h-5 w-px bg-border" />
          {(() => {
            const isActive = !!filters.extensionRequested;
            const color = '#f97316';
            return (
              <button
                onClick={() => updateFilter('extensionRequested', isActive ? undefined : true)}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: isActive ? `${color}25` : 'transparent',
                  color: color,
                }}
              >
                <ArrowRightLeft className="h-3 w-3" />
                Extension
                {isActive && <X className="ml-1 h-3 w-3" />}
              </button>
            );
          })()}
          <div className="h-5 w-px bg-border" />
          {(() => {
            const isActive = !!filters.cancellationRequested;
            const color = '#ef4444';
            return (
              <button
                onClick={() => updateFilter('cancellationRequested', isActive ? undefined : true)}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: isActive ? `${color}25` : 'transparent',
                  color: color,
                }}
              >
                <Ban className="h-3 w-3" />
                Cancellation
                {isActive && <X className="ml-1 h-3 w-3" />}
              </button>
            );
          })()}
        </div>

        {/* Bonzah filters group */}
        <div className="flex items-center border border-[#CC004A]/30 rounded-md overflow-hidden">
          <span className="px-2.5 shrink-0 flex items-center">
            <img src="/bonzah-logo.svg" alt="bonzah" className="h-4 w-auto dark:hidden" />
            <img src="/bonzah-logo-dark.svg" alt="bonzah" className="h-4 w-auto hidden dark:block" />
          </span>
          <div className="h-5 w-px bg-[#CC004A]/30" />
          {(() => {
            const isActive = filters.bonzahStatus === 'ins_quoted';
            return (
              <button
                onClick={() => updateFilter('bonzahStatus', isActive ? undefined : 'ins_quoted')}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: isActive ? '#CC004A' : 'transparent',
                  color: isActive ? '#fff' : '#CC004A',
                }}
              >
                Quoted
                {isActive && <X className="ml-1 h-3 w-3" />}
              </button>
            );
          })()}
          <div className="h-5 w-px bg-[#CC004A]/30" />
          {(() => {
            const isActive = filters.bonzahStatus === 'active';
            return (
              <button
                onClick={() => updateFilter('bonzahStatus', isActive ? undefined : 'active')}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: isActive ? '#CC004A' : 'transparent',
                  color: isActive ? '#fff' : '#CC004A',
                }}
              >
                Active
                {isActive && <X className="ml-1 h-3 w-3" />}
              </button>
            );
          })()}
          <div className="h-5 w-px bg-[#CC004A]/30" />
          {(() => {
            const isActive = filters.bonzahStatus === 'failed';
            return (
              <button
                onClick={() => updateFilter('bonzahStatus', isActive ? undefined : 'failed')}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: isActive ? '#CC004A' : 'transparent',
                  color: isActive ? '#fff' : '#CC004A',
                }}
              >
                Failed
                {isActive && <X className="ml-1 h-3 w-3" />}
              </button>
            );
          })()}
        </div>
        </div>

        {/* Clear All */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-8 gap-1 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
};
