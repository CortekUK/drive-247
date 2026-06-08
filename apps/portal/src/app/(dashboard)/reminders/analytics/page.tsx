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
import { ArrowLeft, Info, BarChart3 } from "lucide-react";
import { format, subMonths, startOfMonth } from "date-fns";
import { useReminders } from "@/hooks/use-reminders";
import { Tile, Eyebrow, EmptyState, Shimmer } from "@/components/bento";

const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

// Multi-category chart palettes — recharts requires concrete fill values per slice.
const SEVERITY_CHART_COLORS: Record<string, string> = {
  critical: '#dc2626',
  warning: '#f59e0b',
  info: '#6366f1',
};

const severityChartConfig = Object.fromEntries(
  Object.entries(SEVERITY_CHART_COLORS).map(([k, v]) => [k, { label: capitalize(k), color: v }])
) as ChartConfig;

const OBJECT_TYPE_COLORS: Record<string, string> = {
  Vehicle: '#6366f1',
  Rental: '#22c55e',
  Customer: '#f59e0b',
  Fine: '#dc2626',
  Document: '#06b6d4',
  Integration: '#8b5cf6',
};

const objectTypeConfig = Object.fromEntries(
  Object.entries(OBJECT_TYPE_COLORS).map(([k, v]) => [k, { label: k, color: v }])
) as ChartConfig;

const criticalRadialConfig: ChartConfig = {
  rate: { label: 'Critical Rate', color: '#dc2626' },
};

const monthlyConfig: ChartConfig = {
  count: { label: 'Reminders', color: '#6366f1' },
};

export default function RemindersAnalyticsPage() {
  const { data: reminders = [], isLoading } = useReminders({});

  const severityDonutData = useMemo(() => {
    const counts: Record<string, number> = {};
    reminders.forEach((r) => { counts[r.severity] = (counts[r.severity] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: capitalize(name), value, fill: SEVERITY_CHART_COLORS[name] || '#94a3b8' })).sort((a, b) => b.value - a.value);
  }, [reminders]);

  const objectTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    reminders.forEach((r) => { counts[r.object_type] = (counts[r.object_type] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count, fill: OBJECT_TYPE_COLORS[name] || '#94a3b8' })).sort((a, b) => b.count - a.count);
  }, [reminders]);

  const criticalRadialData = useMemo(() => {
    const total = reminders.length;
    const critical = reminders.filter((r) => r.severity === 'critical').length;
    const rate = total > 0 ? Math.round((critical / total) * 100) : 0;
    return { rate, critical, total, nonCritical: total - critical };
  }, [reminders]);

  const monthlyTrendData = useMemo(() => {
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const key = format(startOfMonth(d), 'yyyy-MM');
      const label = format(d, 'MMM');
      const count = reminders.filter((r) => r.created_at?.startsWith(key)).length;
      months.push({ month: label, count });
    }
    return months;
  }, [reminders]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 sm:py-8 space-y-6">
        <Shimmer className="h-9 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Shimmer className="h-[240px]" />
          <Shimmer className="h-[240px]" />
          <Shimmer className="h-[240px]" />
          <Shimmer className="h-[240px]" />
        </div>
      </div>
    );
  }

  const hasData = reminders.length > 0;

  return (
    <div className="container mx-auto p-4 sm:p-6 sm:py-8 space-y-6">
      <div className="flex items-center gap-2 sm:gap-4">
        <Link href="/reminders" className="shrink-0"><Button variant="outline" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div className="min-w-0">
          <Eyebrow>Compliance</Eyebrow>
          <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-tight">Reminders Analytics</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Charts and insights for reminders</p>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No reminder data"
          description="No reminders available for analytics yet."
        />
      ) : (
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Severity Breakdown Donut */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>Severity Breakdown</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Distribution by severity level</TooltipContent></Tooltip>
              </div>
              {severityDonutData.length > 0 ? (
                <ChartContainer config={severityChartConfig} className="h-[180px] w-full">
                  <PieChart>
                    <Pie data={severityDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {severityDonutData.map((entry) => (<Cell key={entry.name} fill={entry.fill} />))}
                    </Pie>
                    <ChartTooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} /><span className="text-sm font-medium">{d.name}</span></div><p className="text-sm text-muted-foreground mt-0.5">{d.value} reminder{d.value !== 1 ? 's' : ''}</p></div>);
                    }} />
                  </PieChart>
                </ChartContainer>
              ) : (<p className="text-sm text-muted-foreground text-center py-10">No data</p>)}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {severityDonutData.map((d) => (<div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />{d.name}</div>))}
              </div>
            </Tile>

            {/* Object Type Bar */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>By Category</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Reminders by object type</TooltipContent></Tooltip>
              </div>
              {objectTypeData.length > 0 ? (
                <ChartContainer config={objectTypeConfig} className="h-[180px] w-full">
                  <BarChart data={objectTypeData} layout="vertical" margin={{ left: 0, right: 8 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={75} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {objectTypeData.map((entry) => (<Cell key={entry.name} fill={entry.fill} />))}
                    </Bar>
                    <ChartTooltip cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.08 }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} /><span className="text-sm font-medium">{d.name}</span></div><p className="text-sm text-muted-foreground mt-0.5">{d.count} reminder{d.count !== 1 ? 's' : ''}</p></div>);
                    }} />
                  </BarChart>
                </ChartContainer>
              ) : (<p className="text-sm text-muted-foreground text-center py-10">No data</p>)}
            </Tile>

            {/* Critical Rate Radial */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>Critical Rate</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Percentage of critical reminders</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={criticalRadialConfig} className="h-[180px] w-full">
                <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ rate: criticalRadialData.rate }]} startAngle={180} endAngle={0} cx="50%" cy="65%">
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar background={{ fill: "hsl(var(--muted))" }} dataKey="rate" cornerRadius={6} fill="var(--bento-danger-fg)" />
                  <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{criticalRadialData.rate}%</text>
                  <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-xs">{criticalRadialData.critical}/{criticalRadialData.total} critical</text>
                </RadialBarChart>
              </ChartContainer>
            </Tile>

            {/* Monthly Trend */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>Monthly Trend</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Reminders created over last 6 months</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
                <BarChart data={monthlyTrendData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={28} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <ChartTooltip cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground">{d.month}</p><p className="text-sm font-semibold">{d.count} reminder{d.count !== 1 ? 's' : ''}</p></div>);
                  }} />
                </BarChart>
              </ChartContainer>
            </Tile>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
