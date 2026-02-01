"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Search, Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FineFiltersProps {
  onFiltersChange: (filters: FineFilterState) => void;
}

export interface FineFilterState {
  status: string[];
  vehicleSearch: string;
  customerSearch: string;
  search?: string; // Unified search
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
  const [issueDateFromOpen, setIssueDateFromOpen] = useState(false);
  const [issueDateToOpen, setIssueDateToOpen] = useState(false);
  const [dueDateFromOpen, setDueDateFromOpen] = useState(false);
  const [dueDateToOpen, setDueDateToOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== (filters.search || '')) {
        updateFilter('search', localSearch);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [localSearch]);

  // Sync local search when filters change externally
  useEffect(() => {
    setLocalSearch(filters.search || '');
  }, [filters.search]);

  const updateFilter = <K extends keyof FineFilterState>(key: K, value: FineFilterState[K]) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFiltersChange(newFilters);

    // Update URL params
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

  // Helper to fix timezone issues with date picker
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

  return (
    <div className="space-y-4">
      {/* Search and main filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px] sm:min-w-[300px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by reference, vehicle, or customer..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select
          value={filters.status.length === 1 ? filters.status[0] : "all"}
          onValueChange={(value) => updateFilter('status', value === 'all' ? [] : [value])}
        >
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Open">Open</SelectItem>
            <SelectItem value="Charged">Charged</SelectItem>
            <SelectItem value="Waived">Waived</SelectItem>
            <SelectItem value="Appealed">Appealed</SelectItem>
            <SelectItem value="Paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Date filters row */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Issue Date:</span>

          <Popover open={issueDateFromOpen} onOpenChange={setIssueDateFromOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[110px] justify-start text-left font-normal",
                  !filters.issueDateFrom && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {filters.issueDateFrom ? format(filters.issueDateFrom, "MMM dd") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={filters.issueDateFrom}
                onSelect={(date) => {
                  updateFilter("issueDateFrom", normalizeDate(date));
                  setIssueDateFromOpen(false);
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Popover open={issueDateToOpen} onOpenChange={setIssueDateToOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[110px] justify-start text-left font-normal",
                  !filters.issueDateTo && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {filters.issueDateTo ? format(filters.issueDateTo, "MMM dd") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={filters.issueDateTo}
                onSelect={(date) => {
                  updateFilter("issueDateTo", normalizeDate(date));
                  setIssueDateToOpen(false);
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Due Date:</span>

          <Popover open={dueDateFromOpen} onOpenChange={setDueDateFromOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[110px] justify-start text-left font-normal",
                  !filters.dueDateFrom && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {filters.dueDateFrom ? format(filters.dueDateFrom, "MMM dd") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={filters.dueDateFrom}
                onSelect={(date) => {
                  updateFilter("dueDateFrom", normalizeDate(date));
                  setDueDateFromOpen(false);
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Popover open={dueDateToOpen} onOpenChange={setDueDateToOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[110px] justify-start text-left font-normal",
                  !filters.dueDateTo && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {filters.dueDateTo ? format(filters.dueDateTo, "MMM dd") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={filters.dueDateTo}
                onSelect={(date) => {
                  updateFilter("dueDateTo", normalizeDate(date));
                  setDueDateToOpen(false);
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        {hasActiveFilters && (
          <Button variant="outline" onClick={clearFilters} className="gap-2">
            <X className="h-4 w-4" />
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  );
};
