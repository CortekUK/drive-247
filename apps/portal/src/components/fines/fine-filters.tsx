"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Search, Calendar as CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface FineFiltersProps {
  onFiltersChange: (filters: FineFilterState) => void;
}

export interface FineFilterState {
  status: string[];
  liability: string[];
  vehicleSearch: string;
  customerSearch: string;
  search: string;
  issueDate?: Date;
  dueDate?: Date;
  quickFilter?: 'due-next-7' | 'overdue';
}

export const FineFilters = ({ onFiltersChange }: FineFiltersProps) => {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [filters, setFilters] = useState<FineFilterState>({
    status: [],
    liability: [],
    vehicleSearch: '',
    customerSearch: '',
    search: searchParams?.get('search') || '',
    issueDate: searchParams?.get('issueDate') ? new Date(searchParams?.get('issueDate')!) : undefined,
    dueDate: searchParams?.get('dueDate') ? new Date(searchParams?.get('dueDate')!) : undefined,
    quickFilter: searchParams?.get('quickFilter') as any || undefined,
  });

  const updateFilter = <K extends keyof FineFilterState>(key: K, value: FineFilterState[K]) => {
    const newFilters = { ...filters, [key]: value };

    // If search is updated, also update vehicleSearch and customerSearch for compatibility
    if (key === 'search') {
      newFilters.vehicleSearch = value as string;
      newFilters.customerSearch = value as string;
    }

    setFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const clearFilters = () => {
    const emptyFilters: FineFilterState = {
      status: [],
      liability: [],
      vehicleSearch: '',
      customerSearch: '',
      search: '',
      issueDate: undefined,
      dueDate: undefined,
      quickFilter: undefined,
    };
    setFilters(emptyFilters);
    onFiltersChange(emptyFilters);
    router.push("?", { scroll: false });
  };

  const hasActiveFilters = filters.search ||
                          filters.issueDate ||
                          filters.dueDate ||
                          filters.quickFilter;

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-[250px] max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search by vehicle, customer, reference..."
          value={filters.search}
          onChange={(e) => updateFilter('search', e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Status Dropdown */}
      <Select
        value={filters.quickFilter || "all"}
        onValueChange={(value) => updateFilter('quickFilter', value === "all" ? undefined : value as any)}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="due-next-7">Due Soon</SelectItem>
          <SelectItem value="overdue">Overdue</SelectItem>
        </SelectContent>
      </Select>

      {/* Issue Date */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "justify-start text-left font-normal",
              !filters.issueDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {filters.issueDate ? format(filters.issueDate, "dd/MM/yyyy") : "Issue Date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.issueDate}
            onSelect={(date) => updateFilter('issueDate', date)}
            initialFocus
            className="pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      {/* Due Date */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "justify-start text-left font-normal",
              !filters.dueDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {filters.dueDate ? format(filters.dueDate, "dd/MM/yyyy") : "Due Date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.dueDate}
            onSelect={(date) => updateFilter('dueDate', date)}
            initialFocus
            className="pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1">
          <X className="h-3 w-3" />
          Clear
        </Button>
      )}
    </div>
  );
};
