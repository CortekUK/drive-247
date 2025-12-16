"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePickerInput } from "@/components/shared/forms/date-picker-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, X, Search, Calendar } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface FineFiltersProps {
  onFiltersChange: (filters: FineFilterState) => void;
}

export interface FineFilterState {
  status: string[];
  liability: string[];
  vehicleSearch: string;
  customerSearch: string;
  issueDateFrom?: Date;
  issueDateTo?: Date;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  quickFilter?: 'due-next-7' | 'overdue';
}

export const FineFilters = ({ onFiltersChange }: FineFiltersProps) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  
  const [filters, setFilters] = useState<FineFilterState>({
    status: searchParams?.getAll('status') || [],
    liability: searchParams?.getAll('liability') || [],
    vehicleSearch: searchParams?.get('vehicle') || '',
    customerSearch: searchParams?.get('customer') || '',
    issueDateFrom: searchParams?.get('issueDateFrom') ? new Date(searchParams?.get('issueDateFrom')!) : undefined,
    issueDateTo: searchParams?.get('issueDateTo') ? new Date(searchParams?.get('issueDateTo')!) : undefined,
    dueDateFrom: searchParams?.get('dueDateFrom') ? new Date(searchParams?.get('dueDateFrom')!) : undefined,
    dueDateTo: searchParams?.get('dueDateTo') ? new Date(searchParams?.get('dueDateTo')!) : undefined,
    quickFilter: searchParams?.get('quickFilter') as any || undefined,
  });

  const statusOptions = [
    { value: 'Open', label: 'Open' },
    { value: 'Charged', label: 'Charged' },
    { value: 'Waived', label: 'Waived' },
    { value: 'Appealed', label: 'Appealed' },
    { value: 'Paid', label: 'Paid' },
  ];

  const liabilityOptions = [
    { value: 'Customer', label: 'Customer' },
    { value: 'Business', label: 'Business' },
  ];

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

  const handleStatusChange = (status: string, checked: boolean) => {
    const newStatus = checked 
      ? [...filters.status, status]
      : filters.status.filter(s => s !== status);
    updateFilter('status', newStatus);
  };

  const handleLiabilityChange = (liability: string, checked: boolean) => {
    const newLiability = checked 
      ? [...filters.liability, liability]
      : filters.liability.filter(l => l !== liability);
    updateFilter('liability', newLiability);
  };

  const clearFilters = () => {
    const emptyFilters: FineFilterState = {
      status: [],
      liability: [],
      vehicleSearch: '',
      customerSearch: '',
    };
    setFilters(emptyFilters);
    onFiltersChange(emptyFilters);
    router.push("?", { scroll: false });
  };

  const hasActiveFilters = filters.status.length > 0 || 
                          filters.liability.length > 0 || 
                          filters.vehicleSearch || 
                          filters.customerSearch ||
                          filters.issueDateFrom ||
                          filters.issueDateTo ||
                          filters.dueDateFrom ||
                          filters.dueDateTo ||
                          filters.quickFilter;

  const activeFilterCount = [
    ...filters.status,
    ...filters.liability,
    filters.vehicleSearch ? 'vehicle' : null,
    filters.customerSearch ? 'customer' : null,
    filters.issueDateFrom ? 'issueFrom' : null,
    filters.issueDateTo ? 'issueTo' : null,
    filters.dueDateFrom ? 'dueFrom' : null,
    filters.dueDateTo ? 'dueTo' : null,
    filters.quickFilter ? 'quick' : null,
  ].filter(Boolean).length;

  return (
    <>
      {/* Quick Filter Pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button
          variant={filters.quickFilter === 'due-next-7' ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateFilter('quickFilter', filters.quickFilter === 'due-next-7' ? undefined : 'due-next-7')}
        >
          <Calendar className="h-4 w-4 mr-2" />
          Due Next 7 Days
        </Button>
        <Button
          variant={filters.quickFilter === 'overdue' ? 'destructive' : 'outline'}
          size="sm"
          onClick={() => updateFilter('quickFilter', filters.quickFilter === 'overdue' ? undefined : 'overdue')}
        >
          <Calendar className="h-4 w-4 mr-2" />
          Overdue
        </Button>
      </div>

      {/* Advanced Filters */}
      <Card>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Advanced Filters
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary">{activeFilterCount}</Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm">
                  {isOpen ? 'Hide' : 'Show'}
                </Button>
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-6">
              {/* Search Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="vehicle-search">Vehicle Search</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="vehicle-search"
                      placeholder="Search by reg, make, model..."
                      value={filters.vehicleSearch}
                      onChange={(e) => updateFilter('vehicleSearch', e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="customer-search">Customer Search</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="customer-search"
                      placeholder="Search by name, email, phone..."
                      value={filters.customerSearch}
                      onChange={(e) => updateFilter('customerSearch', e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              </div>

              {/* Status Filters */}
              {/* <div>
                <Label className="text-base font-medium">Status</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                  {statusOptions.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`status-${option.value}`}
                        checked={filters.status.includes(option.value)}
                        onCheckedChange={(checked) => handleStatusChange(option.value, checked as boolean)}
                      />
                      <Label htmlFor={`status-${option.value}`} className="text-sm font-normal">
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div> */}

              {/* Liability Filters */}
              <div>
                <Label className="text-base font-medium">Liability</Label>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  {liabilityOptions.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`liability-${option.value}`}
                        checked={filters.liability.includes(option.value)}
                        onCheckedChange={(checked) => handleLiabilityChange(option.value, checked as boolean)}
                      />
                      <Label htmlFor={`liability-${option.value}`} className="text-sm font-normal">
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Date Range Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label className="text-base font-medium">Issue Date Range</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <DatePickerInput
                      placeholder="From date"
                      date={filters.issueDateFrom}
                      onSelect={(date) => updateFilter('issueDateFrom', date)}
                    />
                    <DatePickerInput
                      placeholder="To date"
                      date={filters.issueDateTo}
                      onSelect={(date) => updateFilter('issueDateTo', date)}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-base font-medium">Due Date Range</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <DatePickerInput
                      placeholder="From date"
                      date={filters.dueDateFrom}
                      onSelect={(date) => updateFilter('dueDateFrom', date)}
                    />
                    <DatePickerInput
                      placeholder="To date"
                      date={filters.dueDateTo}
                      onSelect={(date) => updateFilter('dueDateTo', date)}
                    />
                  </div>
                </div>
              </div>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={clearFilters}>
                    <X className="h-4 w-4 mr-2" />
                    Clear All Filters
                  </Button>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </>
  );
};