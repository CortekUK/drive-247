"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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
import { Eye, Plus, Search, BarChart3, ChevronDown, X, ShieldCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { AddVehicleDialog } from "@/components/vehicles/add-vehicle-dialog";
import { FleetSummaryCards } from "@/components/vehicles/fleet-summary-cards";
import { VehicleStatusBadge, resolveVehicleStatus } from "@/components/vehicles/vehicle-status-badge";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import type { InshurEligibilityState } from "@/components/vehicles/inshur-eligibility-badge";
import {
  INSHUR_VEHICLE_FILTERS,
  InshurEligibilityBadge,
  deriveInshurEligibilityState,
  useInshurEligibilityConfig,
  useInshurEligibilityMap,
  useInshurRecheck,
} from "@/components/vehicles/inshur-eligibility-badge";
import { VehicleStatus, VehiclePLData } from "@/lib/vehicle-utils";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { isAreaHidden, isLeanTenant } from "@/lib/lean-areas";
import { VehiclesTeachingEmptyState } from "@/components/empty-states/lean-empty-states";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { usePickupLocations } from "@/hooks/use-pickup-locations";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useVehicleOwners } from "@/hooks/use-vehicle-owners";
import { useFleetHealth, useFleetHealthEnabled } from "@/hooks/use-fleet-health";
import { HealthStatusChip } from "@/components/fleet-health/health-status-chip";
import type { VehicleHealthStatus } from "@/types/fleet-health";

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
  owner_id?: string | null;
  vehicle_owners?: { full_name: string } | null;
  pickup_location_id?: string | null;
  vin?: string | null;
  garaging_state?: string | null;
}

type SortField = 'reg' | 'make_model' | 'year' | 'status';
type SortDirection = 'asc' | 'desc';
type PerformanceFilter = 'all' | 'profitable' | 'loss';
/** `needs_attention` is the roll-up (not_road_legal + overdue + attention); the rest are exact statuses. */
type HealthFilter = 'all' | 'needs_attention' | 'not_road_legal' | 'overdue' | 'unknown';

interface FiltersState {
  search: string;
  status: string;
  make: string;
  year: string;
  performance: PerformanceFilter;
  servicePlan: string;
  spareKey: string;
  ownership: string; // 'all' | 'own' | 'managed' | <owner_id>
  health: HealthFilter;
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
  const { tenant, tenantSlug } = useTenant();
  // The Owner column and the Ownership filter are behind no feature flag --
  // every tenant gets them today, whatever `vehicle_owners_enabled` says. The
  // column also renders a live `/vehicle-owners/{id}` link, which would walk
  // straight into the area the routes above now 404 for the canary. Hidden for
  // the canary only; the query, the filter logic and vehicles.owner_id stay.
  const ownersHidden = isAreaHidden("owners", tenantSlug);
  const { canEdit } = useManagerPermissions();
  const { data: vehicleOwnersList = [] } = useVehicleOwners({ includeInactive: false });
  const { locations: pickupLocationsList } = usePickupLocations();
  const locationNameById = useMemo(
    () => new Map((pickupLocationsList || []).map((l) => [l.id, l.name])),
    [pickupLocationsList]
  );
  const hasPickupLocations = (pickupLocationsList || []).length > 0;

  // Fleet Health — one cached read for the whole list, keyed by vehicle for O(1) row lookup.
  // Gated on the tenant flag: the column defaults to off, and without this every
  // tenant would see an "Unknown" chip on every row for a feature they never enabled.
  const fleetHealthEnabled = useFleetHealthEnabled();
  const { data: fleetHealth = [] } = useFleetHealth();
  const healthByVehicle = useMemo(
    () => new Map(fleetHealth.map((h) => [h.vehicle_id, h])),
    [fleetHealth]
  );
  /**
   * A vehicle with no cache row has never been evaluated — that is `unknown`, not `ok`.
   * Defaulting to `ok` here would quietly assert a car is fine because we never looked.
   */
  const healthStatusFor = (vehicleId: string): VehicleHealthStatus =>
    healthByVehicle.get(vehicleId)?.status ?? 'unknown';

  // INSHUR Period Z — cached eligibility only. The list never fires N checks.
  const inshurConfig = useInshurEligibilityConfig();
  // Hidden from the lean canary and that tenant alone. Folded into one derived
  // flag rather than gating each of the four render sites separately, so the
  // column header, the badge cell, the derived state map and the deep-link
  // filter below can never disagree about whether INSHUR is on.
  const inshurHidden = isAreaHidden("inshur", tenantSlug);
  const inshurEnabled = inshurConfig.enabled && !inshurHidden;
  const { byVehicleId: inshurEligibilityByVehicle } = useInshurEligibilityMap(inshurEnabled);
  const { recheck: recheckInshur, pendingVehicleId: inshurPendingVehicleId, failedVehicleIds: inshurFailedVehicleIds } = useInshurRecheck();

  // Deep-linked from the dashboard metric and Settings' fleet-readiness counters.
  // `?inshur=` must not resurrect the filter bar for a gated tenant either.
  const inshurFilter = inshurHidden ? null : searchParams.get('inshur');
  const inshurFilterSpec = inshurFilter ? INSHUR_VEHICLE_FILTERS[inshurFilter] : undefined;

  // State from URL params
  const [filters, setFilters] = useState<FiltersState>({
    search: searchParams.get('search') || '',
    status: searchParams.get('status') || 'all',
    make: searchParams.get('make') || 'all',
    year: searchParams.get('year') || 'all',
    performance: (searchParams.get('performance') as PerformanceFilter) || 'all',
    servicePlan: searchParams.get('servicePlan') || 'all',
    spareKey: searchParams.get('spareKey') || 'all',
    ownership: searchParams.get('ownership') || 'all',
    health: (searchParams.get('health') as HealthFilter) || 'all',
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
    // Not part of FiltersState, so it would otherwise be dropped by any filter change.
    if (inshurFilter) params.set('inshur', inshurFilter);
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
          ),
          vehicle_owners ( full_name )
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

      return transformedData as unknown as Vehicle[];
    },
    enabled: !!tenant,
  });

  // Which cars have a rental RUNNING right now, as opposed to merely booked.
  // vehicles.status is flipped to 'Rented' the moment a rental row is created --
  // the New Rental handler does it explicitly "even for pending rentals" -- so
  // the column alone cannot tell "someone is driving it" from "someone has
  // booked it for next week". Only the badge consumes this; no count, KPI or
  // utilisation figure reads it, so nothing on this page moves except the label.
  const { data: activeRentalVehicleIds } = useQuery({
    queryKey: ["vehicles-active-rental-ids", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select("vehicle_id")
        .eq("tenant_id", tenant!.id)
        .eq("status", "Active")
        .not("vehicle_id", "is", null);
      if (error) throw error;
      return new Set((data ?? []).map((r: { vehicle_id: string }) => r.vehicle_id));
    },
    enabled: !!tenant,
  });

  // Undefined while that query is in flight. Returning undefined (not false)
  // matters: `has_active_rental === false` is what triggers the 'Reserved'
  // split, so before the data lands every car keeps its existing label and the
  // badge never flickers Rented -> Reserved -> Rented.
  const withRentalSignal = useCallback(
    (v: Vehicle) => ({
      ...v,
      has_active_rental: activeRentalVehicleIds
        ? activeRentalVehicleIds.has((v as { id: string }).id)
        : undefined,
    }),
    [activeRentalVehicleIds]
  );

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

  // Derived once for the whole page so the filter and the badges can never disagree.
  const inshurStateByVehicle = useMemo(() => {
    const map = new Map<string, InshurEligibilityState>();
    if (!inshurEnabled) return map;
    vehicles.forEach(vehicle => {
      map.set(vehicle.id, deriveInshurEligibilityState({
        vin: vehicle.vin,
        garagingState: vehicle.garaging_state,
        row: inshurEligibilityByVehicle.get(vehicle.id),
        statesAllowed: inshurConfig.statesAllowed,
        lastCheckFailed: inshurFailedVehicleIds.has(vehicle.id),
      }));
    });
    return map;
  }, [vehicles, inshurEnabled, inshurConfig.statesAllowed, inshurEligibilityByVehicle, inshurFailedVehicleIds]);

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

    // Status filter. `paused` is a separate boolean column rather than a
    // `status` value, because status is machine-owned — closing a rental
    // unconditionally resets it to 'Available' and would silently un-pause.
    if (filters.status !== 'all') {
      // Match on the RESOLVED status so the filter agrees with the badge the
      // operator can see. Filtering on the raw column made 'Unavailable'
      // unselectable and hid paused cars under 'Available'.
      filtered = filtered.filter(
        vehicle => resolveVehicleStatus(withRentalSignal(vehicle)).toLowerCase() === filters.status.toLowerCase()
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

    // Ownership filter
    if (filters.ownership !== 'all') {
      filtered = filtered.filter(vehicle => {
        if (filters.ownership === 'own') return !vehicle.owner_id;
        if (filters.ownership === 'managed') return !!vehicle.owner_id;
        // specific owner_id
        return vehicle.owner_id === filters.ownership;
      });
    }

    // Health filter. "Needs attention" is the same roll-up useFleetHealthStats reports
    // (not_road_legal + overdue + attention) — the "what do I act on today?" question.
    // The exact-status options sit underneath it as narrower cuts.
    if (filters.health !== 'all') {
      filtered = filtered.filter(vehicle => {
        const status = healthStatusFor(vehicle.id);
        if (filters.health === 'needs_attention') {
          return status === 'not_road_legal' || status === 'overdue' || status === 'attention';
        }
        return status === filters.health;
      });
    }

    // INSHUR eligibility filter — deep-linked, not part of the filter bar
    if (inshurFilterSpec) {
      filtered = filtered.filter(vehicle => {
        const state = inshurStateByVehicle.get(vehicle.id);
        return !!state && inshurFilterSpec.states.includes(state);
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
  }, [enhancedVehicles, filters, sortField, sortDirection, searchParams, inshurFilterSpec, inshurStateByVehicle, healthByVehicle]);

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

  const currencyCode = tenant?.currency_code || 'USD';

  const handleRowClick = (vehicleId: string) => {
    router.push(`/vehicles/${vehicleId}`);
  };

  // Teach only when the fleet is genuinely empty, never when a filter simply
  // matched nothing — hence `vehicles`, the raw query result, and not
  // `filteredVehicles`. Lean canary only; every other tenant keeps the
  // "no vehicles match your filters" state unchanged.
  //
  // `devForceEmpty` is the /dev preview switch (lib/dev-overrides.ts): inert
  // outside development, and INSIDE the slug gate so it reaches nobody else.
  const devForceEmpty = useForcedEmptyState("vehicles");
  const teachEmptyFleet = isLeanTenant(tenantSlug) && (vehicles.length === 0 || devForceEmpty);

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
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">Fleet Management</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Manage your vehicle fleet and track performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          {vehicles.length > 0 && (
            <Link href="/vehicles/analytics" className="shrink-0">
              <Button variant="outline" size="icon" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <BarChart3 className="h-4 w-4" />
              </Button>
            </Link>
          )}
          {canEdit('vehicles') && (
            <div data-add-vehicle-trigger data-tour="add-vehicle" className="flex-1 sm:flex-none [&>button]:w-full sm:[&>button]:w-auto">
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
          { value: 'paused', label: 'Paused' },
          { value: 'unavailable', label: 'Unavailable' },
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
        const healthOptions = [
          { value: 'all', label: 'All health' },
          { value: 'needs_attention', label: 'Needs attention' },
          { value: 'not_road_legal', label: 'Not road legal' },
          { value: 'overdue', label: 'Overdue' },
          { value: 'unknown', label: 'Unknown' },
        ];
        const activePerformanceLabel = performanceOptions.find(p => p.value === filters.performance)?.label;
        const activeHealthLabel = healthOptions.find(h => h.value === filters.health)?.label;
        const hasAnyFilter = filters.search || filters.status !== 'all' || filters.make !== 'all' || filters.year !== 'all' || filters.performance !== 'all';

        return (
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
            <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search vehicles..."
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
                className="pl-10 h-8 text-sm"
              />
            </div>

            {/* Status + Make + Year + Performance grouped */}
            <div className="grid grid-cols-4 w-full sm:w-auto sm:flex sm:items-center">
              <VehicleFilterPopover
                label="Status"
                active={filters.status !== 'all'}
                activeLabel={filters.status !== 'all' ? activeStatusLabel : undefined}
                options={statusOptions}
                value={filters.status}
                onChange={(v) => updateFilters({ status: v })}
                className="rounded-r-none border-r-0 w-full sm:w-auto"
              />
              <VehicleFilterPopover
                label="Make"
                active={filters.make !== 'all'}
                activeLabel={activeMakeLabel || undefined}
                options={[{ value: 'all', label: 'All Makes' }, ...uniqueMakes.map(m => ({ value: m, label: m }))]}
                value={filters.make}
                onChange={(v) => updateFilters({ make: v })}
                className="rounded-none border-r-0 w-full sm:w-auto"
              />
              <VehicleFilterPopover
                label="Year"
                active={filters.year !== 'all'}
                activeLabel={activeYearLabel || undefined}
                options={[{ value: 'all', label: 'All Years' }, ...uniqueYears.map(y => ({ value: y.toString(), label: y.toString() }))]}
                value={filters.year}
                onChange={(v) => updateFilters({ year: v })}
                className="rounded-none border-r-0 w-full sm:w-auto"
              />
              <VehicleFilterPopover
                label="P&L"
                active={filters.performance !== 'all'}
                activeLabel={filters.performance !== 'all' ? activePerformanceLabel : undefined}
                options={performanceOptions}
                value={filters.performance}
                onChange={(v) => updateFilters({ performance: v as PerformanceFilter })}
                className="rounded-l-none w-full sm:w-auto"
              />
            </div>

            {!ownersHidden && (() => {
              const ownershipOptions = [
                { value: 'all', label: 'All vehicles' },
                { value: 'own', label: 'Own fleet' },
                { value: 'managed', label: 'All managed' },
                ...vehicleOwnersList.map(o => ({ value: o.id, label: o.full_name })),
              ];
              const activeOwnershipLabel = ownershipOptions.find(o => o.value === filters.ownership)?.label;
              return (
                <VehicleFilterPopover
                  label="Ownership"
                  active={filters.ownership !== 'all'}
                  activeLabel={filters.ownership !== 'all' ? activeOwnershipLabel : undefined}
                  options={ownershipOptions}
                  value={filters.ownership}
                  onChange={(v) => updateFilters({ ownership: v })}
                  className="w-full sm:w-auto"
                />
              );
            })()}

            {fleetHealthEnabled && (
              <VehicleFilterPopover
                label="Health"
                active={filters.health !== 'all'}
                activeLabel={filters.health !== 'all' ? activeHealthLabel : undefined}
                options={healthOptions}
                value={filters.health}
                onChange={(v) => updateFilters({ health: v as HealthFilter })}
                className="w-full sm:w-auto"
              />
            )}

            {(hasAnyFilter || filters.ownership !== 'all' || filters.health !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateFilters({ search: '', status: 'all', make: 'all', year: 'all', performance: 'all', ownership: 'all', health: 'all' })}
                className="h-8 gap-1 text-muted-foreground hover:text-foreground self-start"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        );
      })()}

      {/* INSHUR deep-link filter — set by the dashboard metric and Settings' readiness counters */}
      {inshurFilterSpec && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#f1f5f9] bg-[#f8fafc] px-3 py-2 dark:border-gray-800 dark:bg-gray-900/40">
          <ShieldCheck className="h-4 w-4 text-[#6366f1]" />
          <span className="text-sm text-[#404040] dark:text-gray-300">
            Showing {filteredVehicles.length} vehicle{filteredVehicles.length === 1 ? '' : 's'} that {inshurFilterSpec.predicate}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.delete('inshur');
              router.push(`?${params.toString()}`);
            }}
          >
            <X className="h-3.5 w-3.5" />
            Clear filter
          </Button>
        </div>
      )}

      {/* Table */}
      {filteredVehicles.length === 0 || teachEmptyFleet ? (
        teachEmptyFleet ? (
          <VehiclesTeachingEmptyState
            onAddVehicle={() => {
              // Same programmatic open as the button below — the dialog's
              // trigger owns its own state, so there is nothing to lift.
              const addButton = document.querySelector('[data-add-vehicle-trigger] button') as HTMLButtonElement;
              addButton?.click();
            }}
          />
        ) : (
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
        )
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
                  {!ownersHidden && <TableHead>Owner</TableHead>}
                  {hasPickupLocations && <TableHead>Location</TableHead>}
                  {inshurEnabled && <TableHead>INSHUR</TableHead>}
                  <TableHead>Status</TableHead>
                  {fleetHealthEnabled && <TableHead>Health</TableHead>}
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
                    {!ownersHidden && (
                    <TableCell>
                      {vehicle.owner_id ? (
                        <Link
                          href={`/vehicle-owners/${vehicle.owner_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm text-[#6366f1] hover:underline"
                        >
                          {vehicle.vehicle_owners?.full_name ?? "Owner"}
                        </Link>
                      ) : (
                        <Badge variant="outline" className="text-xs border-gray-300 text-[#737373]">Own fleet</Badge>
                      )}
                    </TableCell>
                    )}
                    {hasPickupLocations && (
                      <TableCell>
                        {vehicle.pickup_location_id ? (
                          <span className="text-sm text-foreground">{locationNameById.get(vehicle.pickup_location_id) ?? "—"}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Any</span>
                        )}
                      </TableCell>
                    )}
                    {inshurEnabled && (
                      /* The whole row navigates; the badge's re-check button must not. */
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <InshurEligibilityBadge
                          compact
                          state={inshurStateByVehicle.get(vehicle.id) ?? 'not_checked'}
                          sourceMode={inshurEligibilityByVehicle.get(vehicle.id)?.source_mode ?? inshurConfig.mode}
                          checkedAt={inshurEligibilityByVehicle.get(vehicle.id)?.checked_at}
                          vin={vehicle.vin}
                          vehicleState={vehicle.garaging_state}
                          statesAllowed={inshurConfig.statesAllowed}
                          isRechecking={inshurPendingVehicleId === vehicle.id}
                          onRecheck={vehicle.vin ? () => recheckInshur(vehicle.id) : undefined}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <VehicleStatusBadge status={resolveVehicleStatus(withRentalSignal(vehicle))} />
                    </TableCell>
                    {fleetHealthEnabled && (
                      <TableCell>
                        <HealthStatusChip status={healthStatusFor(vehicle.id)} compact />
                      </TableCell>
                    )}
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
