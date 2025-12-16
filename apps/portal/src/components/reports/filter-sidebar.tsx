import React from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReportFilters } from '@/pages/Reports';

interface FilterSidebarProps {
  filters: ReportFilters;
  onFiltersChange: (filters: ReportFilters) => void;
}

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  filters,
  onFiltersChange
}) => {
  // Fetch filter options
  const { data: customers } = useQuery({
    queryKey: ['customers-filter'],
    queryFn: async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name')
        .order('name');
      return data || [];
    }
  });

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles-filter'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, reg, make, model')
        .order('reg');
      return data || [];
    }
  });

  const { data: rentals } = useQuery({
    queryKey: ['rentals-filter'],
    queryFn: async () => {
      const { data } = await supabase
        .from('rentals')
        .select('id, customer_id, vehicle_id')
        .order('created_at', { ascending: false });
      return data || [];
    }
  });

  const paymentTypes = [
    'Rental',
    'InitialFee', 
    'Fine',
    'Service',
    'Other'
  ];

  const statuses = [
    'Due',
    'Overdue',
    'Settled'
  ];

  const updateFilters = (key: keyof ReportFilters, value: any) => {
    onFiltersChange({
      ...filters,
      [key]: value
    });
  };

  const toggleArrayValue = (key: keyof ReportFilters, value: string) => {
    const currentArray = filters[key] as string[];
    const newArray = currentArray.includes(value)
      ? currentArray.filter(v => v !== value)
      : [...currentArray, value];
    updateFilters(key, newArray);
  };

  const clearAllFilters = () => {
    onFiltersChange({
      ...filters,
      customers: [],
      vehicles: [],
      rentals: [],
      paymentTypes: [],
      statuses: []
    });
  };

  return (
    <Card className="sticky top-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Report Filters
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="text-xs h-6 px-2"
          >
            Clear All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Date Range */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
             Date Range
          </Label>
          <div className="space-y-2">
            <div>
              <Label className="text-xs text-muted-foreground">From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !filters.fromDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.fromDate ? format(filters.fromDate, "MM/dd/yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={filters.fromDate}
                    onSelect={(date) => date && updateFilters('fromDate', date)}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !filters.toDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.toDate ? format(filters.toDate, "MM/dd/yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={filters.toDate}
                    onSelect={(date) => date && updateFilters('toDate', date)}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Customers */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            Customers
            {filters.customers.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {filters.customers.length}
              </Badge>
            )}
          </Label>
          <ScrollArea className="h-32 border rounded-md p-2">
            <div className="space-y-2">
              {customers?.map((customer) => (
                <div key={customer.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`customer-${customer.id}`}
                    checked={filters.customers.includes(customer.id)}
                    onCheckedChange={() => toggleArrayValue('customers', customer.id)}
                  />
                  <Label
                    htmlFor={`customer-${customer.id}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {customer.name}
                  </Label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Vehicles */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            Vehicles
            {filters.vehicles.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {filters.vehicles.length}
              </Badge>
            )}
          </Label>
          <ScrollArea className="h-32 border rounded-md p-2">
            <div className="space-y-2">
              {vehicles?.map((vehicle) => (
                <div key={vehicle.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`vehicle-${vehicle.id}`}
                    checked={filters.vehicles.includes(vehicle.id)}
                    onCheckedChange={() => toggleArrayValue('vehicles', vehicle.id)}
                  />
                  <Label
                    htmlFor={`vehicle-${vehicle.id}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {vehicle.reg} - {vehicle.make} {vehicle.model}
                  </Label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Payment Types */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            Payment Types
            {filters.paymentTypes.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {filters.paymentTypes.length}
              </Badge>
            )}
          </Label>
          <div className="space-y-2">
            {paymentTypes.map((type) => (
              <div key={type} className="flex items-center space-x-2">
                <Checkbox
                  id={`payment-type-${type}`}
                  checked={filters.paymentTypes.includes(type)}
                  onCheckedChange={() => toggleArrayValue('paymentTypes', type)}
                />
                <Label
                  htmlFor={`payment-type-${type}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {type}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            Status
            {filters.statuses.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {filters.statuses.length}
              </Badge>
            )}
          </Label>
          <div className="space-y-2">
            {statuses.map((status) => (
              <div key={status} className="flex items-center space-x-2">
                <Checkbox
                  id={`status-${status}`}
                  checked={filters.statuses.includes(status)}
                  onCheckedChange={() => toggleArrayValue('statuses', status)}
                />
                <Label
                  htmlFor={`status-${status}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {status}
                </Label>
              </div>
            ))}
          </div>
        </div>

      </CardContent>
    </Card>
  );
};