"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, X, Search } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";

interface PaymentFiltersProps {
  onFiltersChange: (filters: PaymentFilters) => void;
}

export interface PaymentFilters {
  search: string;
  customerSearch: string;
  vehicleSearch: string;
  method: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  quickFilter: string;
  verificationStatus: string;
}

export const PaymentFilters = ({ onFiltersChange }: PaymentFiltersProps) => {
  const searchParams = useSearchParams();

  // Initialize with thisMonth dates
  const getInitialDates = () => {
    const today = new Date();
    return {
      dateFrom: new Date(today.getFullYear(), today.getMonth(), 1),
      dateTo: today,
    };
  };

  const initialDates = getInitialDates();

  const [filters, setFilters] = useState<PaymentFilters>({
    search: searchParams?.get('search') || '',
    customerSearch: '',
    vehicleSearch: '',
    method: 'all',
    dateFrom: searchParams?.get('dateFrom') ? new Date(searchParams?.get('dateFrom')!) : initialDates.dateFrom,
    dateTo: searchParams?.get('dateTo') ? new Date(searchParams?.get('dateTo')!) : initialDates.dateTo,
    quickFilter: 'thisMonth',
    verificationStatus: searchParams?.get('status') || 'all',
  });

  const updateFilters = (newFilters: Partial<PaymentFilters>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    
    // Update URL params
    const params = new URLSearchParams();
    if (updatedFilters.customerSearch) params.set('customer', updatedFilters.customerSearch);
    if (updatedFilters.vehicleSearch) params.set('vehicle', updatedFilters.vehicleSearch);
    if (updatedFilters.method && updatedFilters.method !== 'all') params.set('method', updatedFilters.method);
    if (updatedFilters.dateFrom) params.set('dateFrom', updatedFilters.dateFrom.toISOString().split('T')[0]);
    if (updatedFilters.dateTo) params.set('dateTo', updatedFilters.dateTo.toISOString().split('T')[0]);
    if (updatedFilters.quickFilter !== 'thisMonth') params.set('period', updatedFilters.quickFilter);
    if (updatedFilters.verificationStatus && updatedFilters.verificationStatus !== 'all') params.set('status', updatedFilters.verificationStatus);

    onFiltersChange(updatedFilters);
  };

  const clearFilters = () => {
    const today = new Date();
    const clearedFilters: PaymentFilters = {
      search: '',
      customerSearch: '',
      vehicleSearch: '',
      method: 'all',
      dateFrom: new Date(today.getFullYear(), today.getMonth(), 1),
      dateTo: today,
      quickFilter: 'thisMonth',
      verificationStatus: 'all',
    };
    setFilters(clearedFilters);
    onFiltersChange(clearedFilters);
  };

  const hasActiveFilters = filters.search ||
    filters.dateFrom || filters.dateTo ||
    filters.verificationStatus !== 'all';

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="relative flex-1 min-w-[250px] max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search by customer or vehicle..."
          value={filters.search}
          onChange={(e) => updateFilters({ search: e.target.value, customerSearch: e.target.value, vehicleSearch: e.target.value })}
          className="pl-10"
        />
      </div>

      <Select value={filters.verificationStatus} onValueChange={(value) => updateFilters({ verificationStatus: value })}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
          <SelectItem value="auto_approved">Auto-Approved</SelectItem>
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "justify-start text-left font-normal",
              !filters.dateFrom && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {filters.dateFrom ? formatInTimeZone(filters.dateFrom, 'Europe/London', "dd/MM/yyyy") : "From"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.dateFrom}
            onSelect={(date) => updateFilters({ dateFrom: date })}
            initialFocus
            className="pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "justify-start text-left font-normal",
              !filters.dateTo && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {filters.dateTo ? formatInTimeZone(filters.dateTo, 'Europe/London', "dd/MM/yyyy") : "To"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.dateTo}
            onSelect={(date) => updateFilters({ dateTo: date })}
            initialFocus
            className="pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      {hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1">
          <X className="h-3 w-3" />
          Clear
        </Button>
      )}
    </div>
  );
};