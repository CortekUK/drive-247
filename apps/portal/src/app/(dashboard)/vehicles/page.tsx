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
import { Eye, Plus, Search, ArrowUpDown, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { AddVehicleDialog } from "@/components/vehicles/add-vehicle-dialog";
import { FleetSummaryCards } from "@/components/vehicles/fleet-summary-cards";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import { AcquisitionBadge } from "@/components/vehicles/acquisition-badge";
import { MOTTaxStatusChip } from "@/components/vehicles/mot-tax-status-chip";
import { WarrantyStatusChip } from "@/components/vehicles/warranty-status-chip";
import { ServicePlanChip } from "@/components/vehicles/service-plan-chip";
import { SpareKeyChip } from "@/components/vehicles/spare-key-chip";
import { NetPLChip } from "@/components/vehicles/net-pl-chip";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import { VehicleStatus, VehiclePLData, formatCurrency } from "@/lib/vehicle-utils";
import { useToast } from "@/hooks/use-toast";

interface VehiclePhoto {
  photo_url: string;
}

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  colour: string;
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

type SortField = 'reg' | 'make_model' | 'acquisition_type' | 'status' | 'mot_due_date' | 'tax_due_date' | 'warranty_end_date' | 'net_profit';
type SortDirection = 'asc' | 'desc';
type PerformanceFilter = 'all' | 'profitable' | 'loss';

interface FiltersState {
  search: string;
  status: string;
  make: string;
  performance: PerformanceFilter;
  servicePlan: string;
  spareKey: string;
}

export default function VehiclesListEnhanced() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // State from URL params
  const [filters, setFilters] = useState<FiltersState>({
    search: searchParams.get('search') || '',
    status: searchParams.get('status') || 'all',
    make: searchParams.get('make') || 'all',
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
    queryKey: ["vehicles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select(`
          *,
          vehicle_photos (
            photo_url
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Transform to get only the first photo for each vehicle
      const transformedData = data?.map(vehicle => ({
        ...vehicle,
        vehicle_photos: vehicle.vehicle_photos?.slice(0, 1) || []
      })) || [];

      return transformedData as Vehicle[];
    },
  });

  const { data: plData = [], isLoading: plLoading } = useQuery({
    queryKey: ["vehicles-pl"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("view_pl_by_vehicle")
        .select("*");

      if (error) throw error;
      return data as VehiclePLData[];
    },
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
          case 'acquisition_type':
            aVal = a.acquisition_type;
            bVal = b.acquisition_type;
            break;
          case 'status':
            aVal = a.status;
            bVal = b.status;
            break;
          case 'mot_due_date':
            aVal = a.mot_due_date || '9999-12-31';
            bVal = b.mot_due_date || '9999-12-31';
            break;
          case 'tax_due_date':
            aVal = a.tax_due_date || '9999-12-31';
            bVal = b.tax_due_date || '9999-12-31';
            break;
          case 'net_profit':
            aVal = a.pl_data.net_profit;
            bVal = b.pl_data.net_profit;
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

  const handleSort = (field: SortField) => {
    const newDirection = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc';

    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', field);
    params.set('dir', newDirection);

    // Reset to page 1 when sorting
    params.delete('page');
    setCurrentPage(1);

    router.push(`?${params.toString()}`);

    // Debug logging
    console.log(`Sorting by ${field} in ${newDirection} direction`);
  };

  const handleRowClick = (vehicleId: string) => {
    router.push(`/vehicles/${vehicleId}`);
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      status: 'all',
      make: 'all',
      performance: 'all',
      servicePlan: 'all',
      spareKey: 'all',
    });
    setCurrentPage(1);
    router.push('/vehicles');
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4" />;
    return sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />;
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
            Manage your vehicle fleet, track P&L performance, and monitor compliance
          </p>
        </div>
        <div data-add-vehicle-trigger>
          <AddVehicleDialog />
        </div>
      </div>

      {/* Fleet Summary Cards */}
      <FleetSummaryCards vehicles={filteredVehicles} />

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vehicles..."
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className="pl-9"
          />
        </div>

        <Select value={filters.status} onValueChange={(value) => updateFilters({ status: value })}>
          <SelectTrigger>
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="rented">Rented</SelectItem>
            <SelectItem value="disposed">Disposed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.make} onValueChange={(value) => updateFilters({ make: value })}>
          <SelectTrigger>
            <SelectValue placeholder="All Makes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Makes</SelectItem>
            {uniqueMakes.map(make => (
              <SelectItem key={make} value={make}>{make}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.performance} onValueChange={(value) => updateFilters({ performance: value as PerformanceFilter })}>
          <SelectTrigger>
            <SelectValue placeholder="All Performance" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Performance</SelectItem>
            <SelectItem value="profitable">Profitable</SelectItem>
            <SelectItem value="loss">Loss Making</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={clearFilters}
          className="flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Clear
        </Button>
      </div>

      {/* Results Info */}
      <div className="text-sm text-muted-foreground">
        Showing {paginatedVehicles.length} of {filteredVehicles.length} vehicles
      </div>

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
            <Table key={`${sortField || 'default'}-${sortDirection}`}>
               <TableHeader>
                 <TableRow>
                   <TableHead>Photo</TableHead>
                   <TableHead className="cursor-pointer" onClick={() => handleSort('reg')}>
                     <div className="flex items-center gap-2">
                       Registration
                       {getSortIcon('reg')}
                     </div>
                   </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('make_model')}>
                    <div className="flex items-center gap-2">
                      Make/Model
                      {getSortIcon('make_model')}
                    </div>
                  </TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('acquisition_type')}>
                    <div className="flex items-center gap-2">
                      Acquisition
                      {getSortIcon('acquisition_type')}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('status')}>
                    <div className="flex items-center gap-2">
                      Status
                      {getSortIcon('status')}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('mot_due_date')}>
                    <div className="flex items-center gap-2">
                      Inspection Due
                      {getSortIcon('mot_due_date')}
                    </div>
                  </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort('tax_due_date')}>
                      <div className="flex items-center gap-2">
                        Registration Due
                        {getSortIcon('tax_due_date')}
                       </div>
                     </TableHead>
                    <TableHead className="cursor-pointer text-center" onClick={() => handleSort('net_profit')}>
                     <div className="flex items-center justify-center gap-2">
                       Net P&L
                       {getSortIcon('net_profit')}
                     </div>
                   </TableHead>
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
                        className="font-bold text-primary hover:underline"
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
                    <TableCell>{vehicle.colour}</TableCell>
                    <TableCell className="text-center">
                      <AcquisitionBadge acquisitionType={vehicle.acquisition_type} />
                    </TableCell>
                    <TableCell className="text-center">
                      <VehicleStatusBadge status={vehicle.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      <MOTTaxStatusChip
                        dueDate={vehicle.mot_due_date}
                        type="MOT"
                        compact
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <MOTTaxStatusChip
                        dueDate={vehicle.tax_due_date}
                        type="TAX"
                        compact
                      />
                    </TableCell>
                     <TableCell className="text-center">
                       <NetPLChip
                         revenue={vehicle.pl_data.total_revenue}
                         costs={vehicle.pl_data.total_costs}
                         net={vehicle.pl_data.net_profit}
                         compact
                       />
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
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center">
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

            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
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
      )}
    </div>
  );
}
