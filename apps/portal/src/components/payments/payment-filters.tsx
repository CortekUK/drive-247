"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, X, Search, Filter, Clock } from "lucide-react";
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

  const { data: customers } = useQuery({
    queryKey: ["customers-search"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-search"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model")
        .order("reg");
      if (error) throw error;
      return data;
    },
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

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Quick Filter Pills */}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={filters.quickFilter === 'last7Days' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => applyQuickFilter('last7Days')}
            >
              Last 7 Days
            </Badge>
            <Badge
              variant={filters.quickFilter === 'thisMonth' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => applyQuickFilter('thisMonth')}
            >
              This Month
            </Badge>
            <Badge
              variant={filters.quickFilter === 'allTime' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => applyQuickFilter('allTime')}
            >
              All Time
            </Badge>
          </div>

          {/* Filter Controls */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            <div>
              <Input
                placeholder="Search Customers..."
                value={filters.customerSearch}
                onChange={(e) => updateFilters({ customerSearch: e.target.value })}
                className="w-full"
              />
            </div>

            <div>
              <Input
                placeholder="Search Vehicles..."
                value={filters.vehicleSearch}
                onChange={(e) => updateFilters({ vehicleSearch: e.target.value })}
                className="w-full"
              />
            </div>

            <div>
              <Select value={filters.method} onValueChange={(value) => updateFilters({ method: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Payment Method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Methods</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Card">Card</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select value={filters.verificationStatus} onValueChange={(value) => updateFilters({ verificationStatus: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Verification Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-orange-500" />
                      Pending Review
                    </div>
                  </SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="auto_approved">Auto-Approved</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !filters.dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateFrom ? formatInTimeZone(filters.dateFrom, 'America/New_York', "MM/dd/yyyy") : "From Date"}
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
            </div>

            <div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !filters.dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateTo ? formatInTimeZone(filters.dateTo, 'America/New_York', "MM/dd/yyyy") : "To Date"}
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
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex justify-between items-center pt-2">
              <div className="text-sm text-muted-foreground">
                <Filter className="inline h-4 w-4 mr-1" />
                Filters Active
              </div>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};