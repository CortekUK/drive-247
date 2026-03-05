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
import { Eye, Plus, Search, Info } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { AddVehicleDialog } from "@/components/vehicles/add-vehicle-dialog";
import { FleetSummaryCards } from "@/components/vehicles/fleet-summary-cards";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import { VehicleStatus, VehiclePLData } from "@/lib/vehicle-utils";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { formatCurrency } from "@/lib/format-utils";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Chart configs
const statusChartConfig = {
  Available: { label: "Available", color: "#22c55e" },
  Rented: { label: "Rented", color: "hsl(var(--primary))" },
  Disposed: { label: "Disposed", color: "#9ca3af" },
} satisfies ChartConfig;

const profitabilityChartConfig = {
  Profitable: { label: "Profitable", color: "#10b981" },
  "Break-even": { label: "Break-even", color: "#6b7280" },
  "Loss-making": { label: "Loss-making", color: "#ef4444" },
} satisfies ChartConfig;

const costChartConfig = {
  Service: { label: "Service", color: "#3b82f6" },
  Fines: { label: "Fines", color: "#ef4444" },
  Acquisition: { label: "Acquisition", color: "#f59e0b" },
} satisfies ChartConfig;

const revenueBarConfig = {
  total_revenue: { label: "Revenue", color: "#10b981" },
} satisfies ChartConfig;

const STATUS_COLORS: Record<string, string> = { Available: "#22c55e", Rented: "hsl(var(--primary))", Disposed: "#9ca3af" };
const PROFIT_COLORS: Record<string, string> = { Profitable: "#10b981", "Break-even": "#6b7280", "Loss-making": "#ef4444" };
const COST_COLORS: Record<string, string> = { Service: "#3b82f6", Fines: "#ef4444", Acquisition: "#f59e0b" };
const RADAR_VEHICLE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];

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

  // Chart data derivations
  const statusDonutData = useMemo(() => {
    const counts: Record<string, number> = { Available: 0, Rented: 0, Disposed: 0 };
    vehicles.forEach(v => {
      if (v.is_disposed || v.status === 'Disposed') counts.Disposed++;
      else if (v.status === 'Rented') counts.Rented++;
      else counts.Available++;
    });
    return Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [vehicles]);

  const profitabilityDonutData = useMemo(() => {
    const counts = { Profitable: 0, "Break-even": 0, "Loss-making": 0 };
    plData.forEach(pl => {
      if (pl.net_profit > 0) counts.Profitable++;
      else if (pl.net_profit < 0) counts["Loss-making"]++;
      else counts["Break-even"]++;
    });
    return Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [plData]);

  const costDonutData = useMemo(() => {
    const totals = { Service: 0, Fines: 0, Acquisition: 0 };
    plData.forEach(pl => {
      totals.Service += pl.cost_service || 0;
      totals.Fines += pl.cost_fines || 0;
      totals.Acquisition += pl.cost_acquisition || 0;
    });
    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [plData]);

  const topVehiclesByRevenue = useMemo(() => {
    return [...plData]
      .filter(pl => pl.total_revenue > 0)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 10);
  }, [plData]);

  // Radar chart: top 5 vehicles compared across P&L dimensions (normalized 0-100)
  const { radarData, radarVehicles, radarChartConfig } = useMemo(() => {
    const top5 = [...plData]
      .filter(pl => pl.total_revenue > 0)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 5);

    if (top5.length < 2) return { radarData: [], radarVehicles: [] as VehiclePLData[], radarChartConfig: {} as ChartConfig };

    const dimensions = [
      { key: "revenue_rental", label: "Rental Revenue" },
      { key: "revenue_fees", label: "Fees" },
      { key: "cost_service", label: "Service Costs" },
      { key: "cost_fines", label: "Fines" },
      { key: "cost_acquisition", label: "Acquisition" },
    ];

    // Find max for each dimension for normalization
    const maxes: Record<string, number> = {};
    dimensions.forEach(d => {
      maxes[d.key] = Math.max(...top5.map(v => Math.abs((v as any)[d.key] || 0)), 1);
    });

    const data = dimensions.map(d => {
      const point: Record<string, any> = { dimension: d.label };
      top5.forEach((v, i) => {
        point[v.vehicle_reg] = Math.round((Math.abs((v as any)[d.key] || 0) / maxes[d.key]) * 100);
      });
      return point;
    });

    const config: ChartConfig = {};
    top5.forEach((v, i) => {
      config[v.vehicle_reg] = { label: v.vehicle_reg, color: RADAR_VEHICLE_COLORS[i] };
    });

    return { radarData: data, radarVehicles: top5, radarChartConfig: config };
  }, [plData]);

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
            Manage your vehicle fleet, track P&L performance, and monitor compliance
          </p>
        </div>
        {canEdit('vehicles') && (
          <div data-add-vehicle-trigger>
            <AddVehicleDialog />
          </div>
        )}
      </div>

      {/* Fleet Summary Cards */}
      <FleetSummaryCards vehicles={filteredVehicles} currencyCode={currencyCode} />

      {/* Fleet Charts */}
      {vehicles.length > 0 && (
        <TooltipProvider>
        <div className="space-y-4">
          {/* 3 Donut Charts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Fleet Status Distribution */}
            {statusDonutData.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                  Fleet Status
                  <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p>Distribution of vehicles by current status</p></TooltipContent></Tooltip>
                </h3>
                <ChartContainer config={statusChartConfig} className="mx-auto aspect-square max-h-[220px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v} vehicles`} />} />
                    <Pie data={statusDonutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} strokeWidth={2}>
                      {statusDonutData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Pie>
                    <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                      {vehicles.length}
                    </text>
                    <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">
                      Total
                    </text>
                  </PieChart>
                </ChartContainer>
              </div>
            )}

            {/* Profitability Distribution */}
            {profitabilityDonutData.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                  Profitability
                  <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p>How many vehicles are profitable vs loss-making</p></TooltipContent></Tooltip>
                </h3>
                <ChartContainer config={profitabilityChartConfig} className="mx-auto aspect-square max-h-[220px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v} vehicles`} />} />
                    <Pie data={profitabilityDonutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} strokeWidth={2}>
                      {profitabilityDonutData.map((entry) => (
                        <Cell key={entry.name} fill={PROFIT_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Pie>
                    <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                      {plData.length}
                    </text>
                    <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">
                      Tracked
                    </text>
                  </PieChart>
                </ChartContainer>
              </div>
            )}

            {/* Cost Breakdown */}
            {costDonutData.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                  Cost Breakdown
                  <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                  <TooltipContent><p>Total fleet costs split by category</p></TooltipContent></Tooltip>
                </h3>
                <ChartContainer config={costChartConfig} className="h-[180px] w-full">
                  <BarChart data={costDonutData} layout="vertical" margin={{ left: 5, right: 10 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                    <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={75} />
                    <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => formatCurrency(v, currencyCode)} />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {costDonutData.map((entry) => (
                        <Cell key={entry.name} fill={COST_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </div>

          {/* Vehicle P&L Profile Radar */}
          {radarData.length > 0 && radarVehicles.length >= 2 && (
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                Vehicle P&L Profile
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                <TooltipContent><p>Financial profile comparison of top revenue vehicles (normalized 0-100)</p></TooltipContent></Tooltip>
              </h3>
              <ChartContainer config={radarChartConfig} className="h-[320px] w-full">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {radarVehicles.map((v, i) => (
                    <Radar
                      key={v.vehicle_reg}
                      dataKey={v.vehicle_reg}
                      fill={RADAR_VEHICLE_COLORS[i]}
                      fillOpacity={0.15}
                      stroke={RADAR_VEHICLE_COLORS[i]}
                      strokeWidth={2}
                    />
                  ))}
                </RadarChart>
              </ChartContainer>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-xs">
                {radarVehicles.map((v, i) => (
                  <div key={v.vehicle_reg} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RADAR_VEHICLE_COLORS[i] }} />
                    <span className="text-muted-foreground">{v.vehicle_reg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top 10 Vehicles by Revenue */}
          {topVehiclesByRevenue.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                Top Vehicles by Revenue
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                <TooltipContent><p>Highest revenue-generating vehicles in your fleet</p></TooltipContent></Tooltip>
              </h3>
              <ChartContainer config={revenueBarConfig} className="h-[300px] w-full">
                <BarChart data={topVehiclesByRevenue} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <YAxis
                    dataKey="vehicle_reg"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    width={80}
                  />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_: any, payload: any) => {
                          const v = payload?.[0]?.payload;
                          return v ? `${v.vehicle_reg} — ${v.make_model}` : '';
                        }}
                        valueFormatter={(value) => formatCurrency(value, currencyCode)}
                      />
                    }
                  />
                  <Bar dataKey="total_revenue" radius={[0, 4, 4, 0]} fill="#10b981" />
                </BarChart>
              </ChartContainer>
            </div>
          )}
        </div>
        </TooltipProvider>
      )}

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

        <Select value={filters.year} onValueChange={(value) => updateFilters({ year: value })}>
          <SelectTrigger>
            <SelectValue placeholder="All Years" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {uniqueYears.map(year => (
              <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
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
