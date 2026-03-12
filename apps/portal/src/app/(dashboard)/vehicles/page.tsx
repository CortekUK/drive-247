"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, Plus, Search, BarChart3, ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { AddVehicleDialog } from "@/components/vehicles/add-vehicle-dialog";
import { FleetSummaryCards } from "@/components/vehicles/fleet-summary-cards";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import { VehicleStatus, VehiclePLData } from "@/lib/vehicle-utils";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

interface VehiclePhoto {
  photo_url: string;
  display_order: number | null;
}

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  colour: string;
  year?: number;
  acquisition_type: string;
  purchase_price?: number;
  mot_due_date?: string;
  tax_due_date?: string;
  warranty_start_date?: string;
  warranty_end_date?: string;
  is_disposed: boolean;
  disposal_date?: string;
  status: string;
  photo_url?: string;
  vehicle_photos?: VehiclePhoto[];
  has_logbook?: boolean;
  has_service_plan?: boolean;
  has_spare_key?: boolean;
  spare_key_holder?: string | null;
  spare_key_notes?: string | null;
  description?: string;
}

type SortField = 'reg' | 'make_model' | 'year' | 'status';
type SortDirection = 'asc' | 'desc';
type PerformanceFilter = 'all' | 'profitable' | 'loss';

interface FiltersState {
  search: string;
  status: string;
  make: string;
  year: string;
  performance: PerformanceFilter;
  servicePlan: string;
  spareKey: string;
}

function VehicleFilterPopover({
  label, active, activeLabel, options, value, onChange, className
}: {
  label: string;
  active: boolean;
  activeLabel?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5", active && "border-primary", className)}
        >
          {active ? (
            <span className="text-primary truncate max-w-[80px]">{activeLabel}</span>
          ) : (
            label
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2 max-h-[280px] overflow-y-auto" align="start">
        <div className="flex flex-col gap-1">
          {options.map(({ value: v, label: l }) => {
            const isActive = value === v;
            return (
              <button
                key={v}
                onClick={() => { onChange(v); setOpen(false); }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors text-left whitespace-nowrap",
                  isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                {l}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function VehiclesListEnhanced() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();

  // State from URL params
  const [filters, setFilters] = useState<FiltersState>({
    search: searchParams.get('search') || '',
    status: searchParams.get('status') || 'all',
    make: searchParams.get('make') || 'all',
    year: searchParams.get('year') || 'all',
    performance: (searchParams.get('performance') as PerformanceFilter) || 'all',
    servicePlan: searchParams.get('servicePlan') || 'all',
    spareKey: searchParams.get('spareKey') || 'all',
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sync pagination state with URL params
  useEffect(() => {
    const urlCurrentPage = parseInt(searchParams.get('page') || '1');
    const urlPageSize = parseInt(searchParams.get('limit') || '25');

    setCurrentPage(urlCurrentPage);
    setPageSize(urlPageSize);
  }, [searchParams]);

  // Read sort params directly from URL
  const sortField = searchParams.get('sort') as SortField | null;
  const sortDirection = (searchParams.get('dir') as SortDirection) || 'asc';

  // Update URL params when filters change
  const updateFilters = (newFilters: Partial<FiltersState>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);

    const params = new URLSearchParams();
    Object.entries(updatedFilters).forEach(([key, value]) => {
      if (value && value !== 'all') params.set(key, value);
    });
    if (sortField) params.set('sort', sortField);
    if (sortDirection !== 'asc') params.set('dir', sortDirection);
    if (currentPage !== 1) params.set('page', currentPage.toString());
    if (pageSize !== 25) params.set('limit', pageSize.toString());

    router.push(`?${params.toString()}`);
  };

  // Data fetching
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ["vehicles-list", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("vehicles")
        .select(`
          *,
          vehicle_photos (
            photo_url,
            display_order
          )
        `);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;

      // Transform to get only the first photo (by display_order) for each vehicle
      const transformedData = data?.map(vehicle => ({
        ...vehicle,
        vehicle_photos: vehicle.vehicle_photos
          ?.sort((a: { display_order: number | null }, b: { display_order: number | null }) =>
            (a.display_order ?? 999) - (b.display_order ?? 999)
          )
          .slice(0, 1) || []
      })) || [];

      return transformedData as Vehicle[];
    },
    enabled: !!tenant,
  });

  const { data: plData = [], isLoading: plLoading } = useQuery({
    queryKey: ["vehicles-pl", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("view_pl_by_vehicle")
        .select("*");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as VehiclePLData[];
    },
    enabled: !!tenant,
  });

  const isLoading = vehiclesLoading || plLoading;

  // Combine vehicle data with P&L
  const enhancedVehicles = useMemo(() => {
    return vehicles.map(vehicle => {
      const plEntry = plData.find(pl => pl.vehicle_id === vehicle.id);

      return {
        ...vehicle,
        pl_data: plEntry || {
          total_revenue: 0,
          total_costs: 0,
          net_profit: 0,
          revenue_rental: 0,
          revenue_fees: 0,
          cost_acquisition: 0,
          cost_service: 0,
          cost_fines: 0,
        },
      };
    });
  }, [vehicles, plData]);

  // Filter and sort vehicles
  const filteredVehicles = useMemo(() => {
    let filtered = enhancedVehicles;

    // Search filter
    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(vehicle =>
        vehicle.reg.toLowerCase().includes(search) ||
        vehicle.make?.toLowerCase().includes(search) ||
        vehicle.model?.toLowerCase().includes(search) ||
        vehicle.colour?.toLowerCase().includes(search)
      );
    }

    // Status filter
    if (filters.status !== 'all') {
      filtered = filtered.filter(vehicle =>
        vehicle.status.toLowerCase() === filters.status.toLowerCase()
      );
    }

    // Make filter
    if (filters.make !== 'all') {
      filtered = filtered.filter(vehicle => vehicle.make === filters.make);
    }

    // Year filter
    if (filters.year !== 'all') {
      filtered = filtered.filter(vehicle => vehicle.year?.toString() === filters.year);
    }

    // Performance filter
    if (filters.performance !== 'all') {
      filtered = filtered.filter(vehicle => {
        const net = vehicle.pl_data.net_profit;
        return filters.performance === 'profitable' ? net > 0 : net < 0;
      });
    }

    // Service Plan filter
    if (filters.servicePlan !== 'all') {
      filtered = filtered.filter(vehicle => {
        const hasServicePlan = vehicle.has_service_plan || false;
        return filters.servicePlan === 'yes' ? hasServicePlan : !hasServicePlan;
      });
    }

    // Spare Key filter
    if (filters.spareKey !== 'all') {
      filtered = filtered.filter(vehicle => {
        const hasSpareKey = vehicle.has_spare_key || false;
        if (filters.spareKey === 'none') return !hasSpareKey;
        if (filters.spareKey === 'company') return hasSpareKey && vehicle.spare_key_holder === 'Company';
        if (filters.spareKey === 'customer') return hasSpareKey && vehicle.spare_key_holder === 'Customer';
        return true;
      });
    }

    // Sort - only apply client-side sorting if user has explicitly selected a sort field
    // Otherwise, keep the database order (created_at DESC)
    if (sortField) {
      filtered.sort((a, b) => {
        let aVal: any = '';
        let bVal: any = '';

        switch (sortField) {
          case 'reg':
            aVal = a.reg;
            bVal = b.reg;
            break;
          case 'make_model':
            aVal = `${a.make} ${a.model}`;
            bVal = `${b.make} ${b.model}`;
            break;
          case 'year':
            aVal = a.year || 0;
            bVal = b.year || 0;
            break;
          case 'status':
            aVal = a.status;
            bVal = b.status;
            break;
          default:
            aVal = a.reg;
            bVal = b.reg;
        }

        if (typeof aVal === 'string') {
          return sortDirection === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        } else {
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
      });
    }

    console.log('Filtered and sorted vehicles:', filtered.map(v => ({ reg: v.reg, status: v.status, sortField, sortDirection })));
    return filtered;
  }, [enhancedVehicles, filters, sortField, sortDirection, searchParams]);

  // Pagination
  const totalPages = Math.ceil(filteredVehicles.length / pageSize);
  const paginatedVehicles = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const paginated = filteredVehicles.slice(startIndex, startIndex + pageSize);
    console.log(`Paginated vehicles (page ${currentPage}):`, paginated.map(v => ({ reg: v.reg, status: v.status })));
    return paginated;
  }, [filteredVehicles, currentPage, pageSize, searchParams]);

  // Get unique makes for filter
  const uniqueMakes = useMemo(() => {
    const makes = [...new Set(vehicles.map(v => v.make).filter(Boolean))];
    return makes.sort();
  }, [vehicles]);

  // Get unique years for filter
  const uniqueYears = useMemo(() => {
    const years = [...new Set(vehicles.map(v => v.year).filter(Boolean))] as number[];
    return years.sort((a, b) => b - a); // Sort descending (newest first)
  }, [vehicles]);

  const currencyCode = tenant?.currency_code || 'GBP';

  const handleRowClick = (vehicleId: string) => {
    router.push(`/vehicles/${vehicleId}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Fleet Management</h1>
          <p className="text-muted-foreground">
            Manage your vehicle fleet and track performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          {vehicles.length > 0 && (
            <Link href="/vehicles/analytics">
              <Button variant="outline" size="icon" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <BarChart3 className="h-4 w-4" />
              </Button>
            </Link>
          )}
          {canEdit('vehicles') && (
            <div data-add-vehicle-trigger>
              <AddVehicleDialog />
            </div>
          )}
        </div>
      </div>

      {/* Fleet Summary Cards */}
      <FleetSummaryCards vehicles={filteredVehicles} currencyCode={currencyCode} />

      {/* Filters */}
      {(() => {
        const statusOptions = [
          { value: 'all', label: 'All Status' },
          { value: 'available', label: 'Available' },
          { value: 'rented', label: 'Rented' },
          { value: 'disposed', label: 'Disposed' },
        ];
        const performanceOptions = [
          { value: 'all', label: 'All' },
          { value: 'profitable', label: 'Profitable' },
          { value: 'loss', label: 'Loss Making' },
        ];
        const activeStatusLabel = statusOptions.find(s => s.value === filters.status)?.label;
        const activeMakeLabel = filters.make !== 'all' ? filters.make : null;
        const activeYearLabel = filters.year !== 'all' ? filters.year : null;
        const activePerformanceLabel = performanceOptions.find(p => p.value === filters.performance)?.label;
        const hasAnyFilter = filters.search || filters.status !== 'all' || filters.make !== 'all' || filters.year !== 'all' || filters.performance !== 'all';

        return (
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search vehicles..."
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
                className="pl-10 h-8 text-sm"
              />
            </div>

            {/* Status + Make + Year + Performance grouped */}
            <div className="flex items-center">
              <VehicleFilterPopover
                label="Status"
                active={filters.status !== 'all'}
                activeLabel={filters.status !== 'all' ? activeStatusLabel : undefined}
                options={statusOptions}
                value={filters.status}
                onChange={(v) => updateFilters({ status: v })}
                className="rounded-r-none border-r-0"
              />
              <VehicleFilterPopover
                label="Make"
                active={filters.make !== 'all'}
                activeLabel={activeMakeLabel || undefined}
                options={[{ value: 'all', label: 'All Makes' }, ...uniqueMakes.map(m => ({ value: m, label: m }))]}
                value={filters.make}
                onChange={(v) => updateFilters({ make: v })}
                className="rounded-none border-r-0"
              />
              <VehicleFilterPopover
                label="Year"
                active={filters.year !== 'all'}
                activeLabel={activeYearLabel || undefined}
                options={[{ value: 'all', label: 'All Years' }, ...uniqueYears.map(y => ({ value: y.toString(), label: y.toString() }))]}
                value={filters.year}
                onChange={(v) => updateFilters({ year: v })}
                className="rounded-none border-r-0"
              />
              <VehicleFilterPopover
                label="P&L"
                active={filters.performance !== 'all'}
                activeLabel={filters.performance !== 'all' ? activePerformanceLabel : undefined}
                options={performanceOptions}
                value={filters.performance}
                onChange={(v) => updateFilters({ performance: v as PerformanceFilter })}
                className="rounded-l-none"
              />
            </div>

            {hasAnyFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateFilters({ search: '', status: 'all', make: 'all', year: 'all', performance: 'all' })}
                className="h-8 gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        );
      })()}

      {/* Table */}
      {filteredVehicles.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="No vehicles found"
          description="No vehicles match your current filters. Try adjusting your search criteria."
          actionLabel="Add Vehicle"
          onAction={() => {
            // Open add vehicle dialog programmatically
            const addButton = document.querySelector('[data-add-vehicle-trigger] button') as HTMLButtonElement;
            addButton?.click();
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative">
            <Table key={`${sortField || 'default'}-${sortDirection}`}>
               <TableHeader className="sticky top-0 z-10 bg-background">
                 <TableRow>
                   <TableHead>Photo</TableHead>
                   <TableHead>Registration</TableHead>
                  <TableHead>Make/Model</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedVehicles.map((vehicle, index) => {
                  console.log(`Rendering vehicle ${index}:`, vehicle.reg, vehicle.status);
                  return (
                    <TableRow
                      key={`${vehicle.id}-${sortField || 'default'}-${sortDirection}`}
                      className="cursor-pointer hover:bg-muted/50"
                       onClick={() => handleRowClick(vehicle.id)}
                     >
                     <TableCell>
                       <VehiclePhotoThumbnail
                         photoUrl={vehicle.vehicle_photos?.[0]?.photo_url || vehicle.photo_url}
                         vehicleReg={vehicle.reg}
                         size="sm"
                         onClick={() => router.push(`/vehicles/${vehicle.id}`)}
                       />
                     </TableCell>
                     <TableCell>
                      <Link
                        href={`/vehicles/${vehicle.id}`}
                        className="font-semibold text-foreground hover:text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {vehicle.reg}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{vehicle.make}</div>
                        <div className="text-sm text-muted-foreground truncate">
                          {vehicle.model}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{vehicle.year || '—'}</TableCell>
                    <TableCell>{vehicle.colour}</TableCell>
                    <TableCell className="text-center">
                      <VehicleStatusBadge status={vehicle.status} />
                    </TableCell>
                     <TableCell className="text-right">
                       <Button
                         variant="ghost"
                         size="sm"
                         onClick={(e) => {
                           e.stopPropagation();
                           router.push(`/vehicles/${vehicle.id}`);
                         }}
                       >
                         <Eye className="h-4 w-4" />
                       </Button>
                     </TableCell>
                   </TableRow>
                   );
                 })}
               </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="text-sm text-muted-foreground">
          Showing {paginatedVehicles.length} of {filteredVehicles.length} vehicles
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto flex-wrap justify-center sm:justify-end">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select value={pageSize.toString()} onValueChange={(value) => {
              setPageSize(parseInt(value));
              setCurrentPage(1);
              const params = new URLSearchParams(searchParams.toString());
              params.set('limit', value);
              params.delete('page');
              router.push(`?${params.toString()}`);
            }}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => {
                setCurrentPage(currentPage - 1);
                const params = new URLSearchParams(searchParams.toString());
                params.set('page', (currentPage - 1).toString());
                router.push(`?${params.toString()}`);
              }}
            >
              Previous
            </Button>

            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Page {currentPage} of {totalPages || 1}
            </span>

            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages || totalPages <= 1}
              onClick={() => {
                setCurrentPage(currentPage + 1);
                const params = new URLSearchParams(searchParams.toString());
                params.set('page', (currentPage + 1).toString());
                router.push(`?${params.toString()}`);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
