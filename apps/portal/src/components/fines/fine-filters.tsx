"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Search, Calendar, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface FineFiltersProps {
  onFiltersChange: (filters: FineFilterState) => void;
}

export interface FineFilterState {
  status: string[];
  vehicleSearch: string;
  customerSearch: string;
  search?: string;
  issueDateFrom?: Date;
  issueDateTo?: Date;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  quickFilter?: 'due-next-7' | 'overdue';
}

export const FineFilters = ({ onFiltersChange }: FineFiltersProps) => {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [filters, setFilters] = useState<FineFilterState>({
    status: searchParams?.getAll('status') || [],
    vehicleSearch: '',
    customerSearch: '',
    search: searchParams?.get('search') || '',
    issueDateFrom: searchParams?.get('issueDateFrom') ? new Date(searchParams?.get('issueDateFrom')!) : undefined,
    issueDateTo: searchParams?.get('issueDateTo') ? new Date(searchParams?.get('issueDateTo')!) : undefined,
    dueDateFrom: searchParams?.get('dueDateFrom') ? new Date(searchParams?.get('dueDateFrom')!) : undefined,
    dueDateTo: searchParams?.get('dueDateTo') ? new Date(searchParams?.get('dueDateTo')!) : undefined,
    quickFilter: searchParams?.get('quickFilter') as any || undefined,
  });

  const [localSearch, setLocalSearch] = useState(filters.search || '');
  const [statusOpen, setStatusOpen] = useState(false);
  const [issueDateOpen, setIssueDateOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== (filters.search || '')) {
        updateFilter('search', localSearch);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [localSearch]);

  useEffect(() => {
    setLocalSearch(filters.search || '');
  }, [filters.search]);

  const updateFilter = <K extends keyof FineFilterState>(key: K, value: FineFilterState[K]) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFiltersChange(newFilters);

    const newSearchParams = new URLSearchParams(searchParams?.toString() || "");
    if (Array.isArray(value)) {
      newSearchParams.delete(key);
      value.forEach(v => newSearchParams.append(key, v));
    } else if (value && value !== '') {
      if (value instanceof Date) {
        newSearchParams.set(key, value.toISOString().split('T')[0]);
      } else {
        newSearchParams.set(key, value.toString());
      }
    } else {
      newSearchParams.delete(key);
    }
    router.push(`?${newSearchParams.toString()}`, { scroll: false });
  };

  const clearFilters = () => {
    const emptyFilters: FineFilterState = {
      status: [],
      vehicleSearch: '',
      customerSearch: '',
      search: '',
    };
    setFilters(emptyFilters);
    setLocalSearch('');
    onFiltersChange(emptyFilters);
    router.push("?", { scroll: false });
  };

  const normalizeDate = (date: Date | undefined) => {
    if (!date) return undefined;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  };

  const hasActiveFilters = filters.status.length > 0 ||
    filters.search ||
    filters.issueDateFrom ||
    filters.issueDateTo ||
    filters.dueDateFrom ||
    filters.dueDateTo ||
    filters.quickFilter;

  const hasIssueDateFilter = filters.issueDateFrom || filters.issueDateTo;
  const hasDueDateFilter = filters.dueDateFrom || filters.dueDateTo;

  const statusOptions = [
    { value: 'Open', label: 'Open' },
    { value: 'Charged', label: 'Charged' },
    { value: 'Waived', label: 'Waived' },
    { value: 'Appealed', label: 'Appealed' },
    { value: 'Paid', label: 'Paid' },
    { value: 'Refunded', label: 'Refunded' },
    { value: 'Partially Refunded', label: 'Partially Refunded' },
  ];

  const activeStatusLabel = filters.status.length === 1
    ? statusOptions.find(s => s.value === filters.status[0])?.label
    : filters.status.length > 1
    ? `${filters.status.length} selected`
    : undefined;

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by reference, vehicle, or customer..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10 h-8 text-sm"
          />
        </div>

        {/* Status + Issue Date + Due Date grouped */}
        <div className="flex items-center">
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 rounded-r-none border-r-0", filters.status.length > 0 && "border-primary")}
              >
                {filters.status.length > 0 ? (
                  <span className="text-primary">{activeStatusLabel}</span>
                ) : (
                  "Status"
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => { updateFilter('status', []); setStatusOpen(false); }}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors text-left",
                    filters.status.length === 0 ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  )}
                >
                  All Status
                </button>
                {statusOptions.map(({ value, label }) => {
                  const isActive = filters.status.includes(value);
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        updateFilter('status', isActive ? [] : [value]);
                        setStatusOpen(false);
                      }}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors text-left",
                        isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={issueDateOpen} onOpenChange={setIssueDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 rounded-none border-r-0", hasIssueDateFilter && "border-primary text-primary")}
              >
                {hasIssueDateFilter ? (
                  <span className="text-primary text-xs">
                    Issue: {filters.issueDateFrom ? format(filters.issueDateFrom, "MMM dd") : "..."} – {filters.issueDateTo ? format(filters.issueDateTo, "MMM dd") : "..."}
                  </span>
                ) : (
                  <>Issue Date</>
                )}
                <Calendar className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="start">
              <div className="flex gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">From</p>
                  <CalendarComponent
                    mode="single"
                    selected={filters.issueDateFrom}
                    onSelect={(date) => updateFilter("issueDateFrom", normalizeDate(date))}
                    className="p-0 pointer-events-auto"
                  />
                </div>
                <div className="space-y-1 border-l pl-4">
                  <p className="text-xs font-medium text-muted-foreground">To</p>
                  <CalendarComponent
                    mode="single"
                    selected={filters.issueDateTo}
                    onSelect={(date) => updateFilter("issueDateTo", normalizeDate(date))}
                    className="p-0 pointer-events-auto"
                  />
                </div>
              </div>
              {hasIssueDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs mt-2"
                  onClick={() => {
                    updateFilter("issueDateFrom", undefined);
                    updateFilter("issueDateTo", undefined);
                  }}
                >
                  Clear dates
                </Button>
              )}
            </PopoverContent>
          </Popover>

          <Popover open={dueDateOpen} onOpenChange={setDueDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 rounded-l-none", hasDueDateFilter && "border-primary text-primary")}
              >
                {hasDueDateFilter ? (
                  <span className="text-primary text-xs">
                    Due: {filters.dueDateFrom ? format(filters.dueDateFrom, "MMM dd") : "..."} – {filters.dueDateTo ? format(filters.dueDateTo, "MMM dd") : "..."}
                  </span>
                ) : (
                  <>Due Date</>
                )}
                <Calendar className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="end">
              <div className="flex gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">From</p>
                  <CalendarComponent
                    mode="single"
                    selected={filters.dueDateFrom}
                    onSelect={(date) => updateFilter("dueDateFrom", normalizeDate(date))}
                    className="p-0 pointer-events-auto"
                  />
                </div>
                <div className="space-y-1 border-l pl-4">
                  <p className="text-xs font-medium text-muted-foreground">To</p>
                  <CalendarComponent
                    mode="single"
                    selected={filters.dueDateTo}
                    onSelect={(date) => updateFilter("dueDateTo", normalizeDate(date))}
                    className="p-0 pointer-events-auto"
                  />
                </div>
              </div>
              {hasDueDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs mt-2"
                  onClick={() => {
                    updateFilter("dueDateFrom", undefined);
                    updateFilter("dueDateTo", undefined);
                  }}
                >
                  Clear dates
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Clear All */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
};
