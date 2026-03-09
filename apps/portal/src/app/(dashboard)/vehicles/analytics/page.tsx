"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Info } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VehiclePLData } from "@/lib/vehicle-utils";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";

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

export default function VehiclesAnalyticsPage() {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';

  // Fetch vehicles
  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles-list", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model, year, status, is_disposed")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant,
  });

  // Fetch P&L data
  const { data: plData = [] } = useQuery({
    queryKey: ["vehicles-pl", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("view_pl_by_vehicle")
        .select("*")
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return (data || []) as VehiclePLData[];
    },
    enabled: !!tenant,
  });

  // Chart data derivations
  const statusDonutData = useMemo(() => {
    const counts: Record<string, number> = { Available: 0, Rented: 0, Disposed: 0 };
    vehicles.forEach((v: any) => {
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

    const maxes: Record<string, number> = {};
    dimensions.forEach(d => {
      maxes[d.key] = Math.max(...top5.map(v => Math.abs((v as any)[d.key] || 0)), 1);
    });

    const data = dimensions.map(d => {
      const point: Record<string, any> = { dimension: d.label };
      top5.forEach((v) => {
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

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="h-8 bg-muted animate-pulse rounded"></div>
        <div className="h-96 bg-muted animate-pulse rounded"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/vehicles">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Fleet Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Charts and insights for your vehicle fleet
          </p>
        </div>
      </div>

      {vehicles.length > 0 ? (
        <TooltipProvider>
          <div className="space-y-4">
            {/* 3 Donut/Bar Charts */}
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
                    <YAxis dataKey="vehicle_reg" type="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={80} />
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
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No vehicle data available for analytics</p>
        </div>
      )}
    </div>
  );
}
