"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { ArrowLeft, Info } from "lucide-react";
import { format, subMonths, startOfMonth } from "date-fns";
import { useFinesData } from "@/hooks/use-fines-data";

const STATUS_COLORS: Record<string, string> = {
  Open: "#f59e0b",
  Charged: "#6366f1",
  Waived: "#94a3b8",
  Appealed: "#06b6d4",
  Paid: "#22c55e",
};

const statusChartConfig: ChartConfig = {
  Open: { label: "Open", color: STATUS_COLORS.Open },
  Charged: { label: "Charged", color: STATUS_COLORS.Charged },
  Waived: { label: "Waived", color: STATUS_COLORS.Waived },
  Appealed: { label: "Appealed", color: STATUS_COLORS.Appealed },
  Paid: { label: "Paid", color: STATUS_COLORS.Paid },
};

const overdueRadialConfig: ChartConfig = {
  value: { label: "Overdue", color: "#ef4444" },
};

const monthlyConfig: ChartConfig = {
  count: { label: "Fines", color: "#6366f1" },
};

const vehicleBarConfig: ChartConfig = {
  count: { label: "Fines", color: "#f59e0b" },
};

export default function FinesAnalyticsPage() {
  const { data: finesData, isLoading } = useFinesData({
    filters: { status: [], vehicleSearch: '', customerSearch: '', search: '' },
    sortBy: 'created_at',
    sortOrder: 'desc',
  });

  const allFines = finesData?.fines || [];

  const statusDonutData = useMemo(() => {
    if (!allFines.length) return [];
    const counts = new Map<string, number>();
    allFines.forEach(f => counts.set(f.status, (counts.get(f.status) || 0) + 1));
    return Array.from(counts, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [allFines]);

  const overdueRadialData = useMemo(() => {
    if (!allFines.length) return { rate: 0, overdue: 0, openTotal: 0 };
    const openFines = allFines.filter(f => f.status === 'Open' || f.status === 'Charged');
    const overdue = openFines.filter(f => f.isOverdue).length;
    const rate = openFines.length > 0 ? Math.round((overdue / openFines.length) * 100) : 0;
    return { rate, overdue, openTotal: openFines.length };
  }, [allFines]);

  const monthlyFinesData = useMemo(() => {
    if (!allFines.length) return [];
    const now = new Date();
    const months: { label: string; start: Date }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      months.push({ label: format(startOfMonth(d), 'MMM yyyy'), start: startOfMonth(d) });
    }
    return months.map((m, i) => {
      const nextStart = i < months.length - 1 ? months[i + 1].start : new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const count = allFines.filter(f => {
        const d = new Date(f.issue_date);
        return d >= m.start && d < nextStart;
      }).length;
      return { name: format(m.start, 'MMM'), count };
    });
  }, [allFines]);

  const topVehiclesData = useMemo(() => {
    if (!allFines.length) return [];
    const counts = new Map<string, { count: number; label: string }>();
    allFines.forEach(f => {
      const key = f.vehicles.reg;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { count: 1, label: `${f.vehicles.reg}` });
    });
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(v => ({ name: v.label, count: v.count }));
  }, [allFines]);

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
      <div className="flex items-center gap-4">
        <Link href="/fines">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Fines Analytics</h1>
          <p className="text-sm text-muted-foreground">Charts and insights for fines management</p>
        </div>
      </div>

      {allFines.length > 0 ? (
        <TooltipProvider>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Fine Status Distribution */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Status Breakdown</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Distribution of fines by current status</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={statusChartConfig} className="h-[180px] w-full">
                <PieChart>
                  <Pie data={statusDonutData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" nameKey="name" strokeWidth={2} stroke="hsl(var(--background))">
                    {statusDonutData.map((entry) => (<Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#94a3b8"} />))}
                  </Pie>
                  <ChartTooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.name] || "#94a3b8" }} /><span className="text-sm font-medium">{d.name}</span></div><p className="text-xs text-muted-foreground mt-0.5">{d.value} fine{d.value !== 1 ? 's' : ''}</p></div>);
                  }} />
                  <text x="50%" y="46%" textAnchor="middle" className="fill-foreground text-xl font-bold">{allFines.length}</text>
                  <text x="50%" y="58%" textAnchor="middle" className="fill-muted-foreground text-[11px]">Total</text>
                </PieChart>
              </ChartContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                {statusDonutData.map((d) => (<div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.name] || "#94a3b8" }} />{d.name} ({d.value})</div>))}
              </div>
            </div>

            {/* Overdue Rate Radial */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Overdue Rate</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Percentage of active fines (Open/Charged) that are past due</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={overdueRadialConfig} className="h-[180px] w-full">
                <RadialBarChart cx="50%" cy="50%" innerRadius={55} outerRadius={75} startAngle={90} endAngle={-270} data={[{ name: "Overdue", value: overdueRadialData.rate }]} barSize={14}>
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar dataKey="value" cornerRadius={8} fill="#ef4444" background={{ fill: "hsl(var(--muted))" }} angleAxisId={0} />
                  <text x="50%" y="44%" textAnchor="middle" className="fill-foreground text-2xl font-bold">{overdueRadialData.rate}%</text>
                  <text x="50%" y="56%" textAnchor="middle" className="fill-muted-foreground text-[11px]">Overdue</text>
                </RadialBarChart>
              </ChartContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-red-500" />Overdue ({overdueRadialData.overdue})</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-muted-foreground/30" />On Time ({overdueRadialData.openTotal - overdueRadialData.overdue})</div>
              </div>
            </div>

            {/* Monthly Fines Trend */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Monthly Trend</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Number of fines issued per month (last 6 months)</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
                <BarChart data={monthlyFinesData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground mb-0.5">{d.name}</p><p className="text-sm font-semibold">{d.count} fine{d.count !== 1 ? 's' : ''}</p></div>);
                  }} />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Top Fined Vehicles */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Top Fined Vehicles</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Vehicles with the most fines</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={vehicleBarConfig} className="h-[180px] w-full">
                <BarChart data={topVehiclesData} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={75} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground mb-0.5">{d.name}</p><p className="text-sm font-semibold">{d.count} fine{d.count !== 1 ? 's' : ''}</p></div>);
                  }} />
                  <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        </TooltipProvider>
      ) : (
        <div className="text-center py-12"><p className="text-muted-foreground">No fines data available for analytics</p></div>
      )}
    </div>
  );
}
