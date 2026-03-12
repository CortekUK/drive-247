"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, X, Search, ChevronDown } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface PaymentFiltersProps {
  onFiltersChange: (filters: PaymentFilters) => void;
}

export interface PaymentFilters {
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

  const [filters, setFilters] = useState<PaymentFilters>({
    customerSearch: searchParams?.get('customer') || '',
    vehicleSearch: searchParams?.get('vehicle') || '',
    method: searchParams?.get('method') || 'all',
    dateFrom: searchParams?.get('dateFrom') ? new Date(searchParams?.get('dateFrom')!) : undefined,
    dateTo: searchParams?.get('dateTo') ? new Date(searchParams?.get('dateTo')!) : undefined,
    quickFilter: searchParams?.get('period') || 'thisMonth',
    verificationStatus: searchParams?.get('status') || 'all',
  });

  const [methodOpen, setMethodOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const updateFilters = (newFilters: Partial<PaymentFilters>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);

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

  const applyQuickFilter = (period: string) => {
    const today = new Date();
    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;

    switch (period) {
      case 'last7Days':
        dateFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateTo = today;
        break;
      case 'thisMonth':
        dateFrom = new Date(today.getFullYear(), today.getMonth(), 1);
        dateTo = today;
        break;
      case 'allTime':
        dateFrom = undefined;
        dateTo = undefined;
        break;
    }

    updateFilters({ quickFilter: period, dateFrom, dateTo });
  };

  const clearFilters = () => {
    const clearedFilters: PaymentFilters = {
      customerSearch: '',
      vehicleSearch: '',
      method: 'all',
      dateFrom: undefined,
      dateTo: undefined,
      quickFilter: 'thisMonth',
      verificationStatus: 'all',
    };
    setFilters(clearedFilters);
    onFiltersChange(clearedFilters);
  };

  const hasActiveFilters = filters.customerSearch || filters.vehicleSearch ||
    filters.method !== 'all' || filters.dateFrom || filters.dateTo ||
    filters.quickFilter !== 'thisMonth' || filters.verificationStatus !== 'all';

  const hasDateFilter = filters.dateFrom || filters.dateTo;

  const methodOptions = [
    { value: 'all', label: 'All Methods' },
    { value: 'Cash', label: 'Cash' },
    { value: 'Card', label: 'Card' },
    { value: 'Bank Transfer', label: 'Bank Transfer' },
    { value: 'Other', label: 'Other' },
  ];

  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'pending', label: 'Pending Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'auto_approved', label: 'Auto-Approved' },
  ];

  const activeMethod = methodOptions.find(m => m.value === filters.method);
  const activeStatus = statusOptions.find(s => s.value === filters.verificationStatus);

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search customer or vehicle..."
            value={filters.customerSearch}
            onChange={(e) => updateFilters({ customerSearch: e.target.value })}
            className="pl-10 h-8 text-sm"
          />
        </div>

        {/* Method + Status + Date grouped */}
        <div className="flex items-center">
          <Popover open={methodOpen} onOpenChange={setMethodOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 rounded-r-none border-r-0", filters.method !== 'all' && "border-primary")}
              >
                {filters.method !== 'all' ? (
                  <span className="text-primary">{activeMethod?.label}</span>
                ) : (
                  "Method"
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <div className="flex flex-col gap-1">
                {methodOptions.map(({ value, label }) => {
                  const isActive = filters.method === value;
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        updateFilters({ method: value });
                        setMethodOpen(false);
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

          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 rounded-none border-r-0", filters.verificationStatus !== 'all' && "border-primary")}
              >
                {filters.verificationStatus !== 'all' ? (
                  <span className="text-primary">{activeStatus?.label}</span>
                ) : (
                  "Status"
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <div className="flex flex-col gap-1">
                {statusOptions.map(({ value, label }) => {
                  const isActive = filters.verificationStatus === value;
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        updateFilters({ verificationStatus: value });
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

          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("rounded-l-none px-2", hasDateFilter && "border-primary text-primary")}
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="end">
              <div className="flex gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">From</p>
                  <Calendar
                    mode="single"
                    selected={filters.dateFrom}
                    onSelect={(date) => updateFilters({ dateFrom: date })}
                    className="p-0 pointer-events-auto"
                  />
                </div>
                <div className="space-y-1 border-l pl-4">
                  <p className="text-xs font-medium text-muted-foreground">To</p>
                  <Calendar
                    mode="single"
                    selected={filters.dateTo}
                    onSelect={(date) => updateFilters({ dateTo: date })}
                    className="p-0 pointer-events-auto"
                  />
                </div>
              </div>
              {hasDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs mt-2"
                  onClick={() => updateFilters({ dateFrom: undefined, dateTo: undefined })}
                >
                  Clear dates
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Quick Period filters grouped */}
        <div className="flex items-center border rounded-md overflow-hidden sm:ml-auto">
          <span className="text-xs text-muted-foreground px-2.5 shrink-0">Period</span>
          <div className="h-5 w-px bg-border" />
          {([
            { value: 'last7Days', label: '7 Days' },
            { value: 'thisMonth', label: 'This Month' },
            { value: 'allTime', label: 'All Time' },
          ] as const).map(({ value, label }, i) => {
            const isActive = filters.quickFilter === value;
            return (
              <div key={value} className="flex items-center">
                {i > 0 && <div className="h-5 w-px bg-border" />}
                <button
                  onClick={() => applyQuickFilter(value)}
                  className={cn(
                    "inline-flex items-center px-2.5 h-8 text-xs font-medium whitespace-nowrap transition-colors",
                    isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              </div>
            );
          })}
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
