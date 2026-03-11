"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { ArrowLeft, Info } from "lucide-react";
import { eachDayOfInterval, format, startOfMonth, endOfMonth } from "date-fns";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";

const METHOD_COLORS: Record<string, string> = {
  Cash: "#6366f1",
  Card: "#8b5cf6",
  "Bank Transfer": "#06b6d4",
  Stripe: "#f59e0b",
  Other: "#94a3b8",
};

const methodChartConfig: ChartConfig = {
  Cash: { label: "Cash", color: METHOD_COLORS.Cash },
  Card: { label: "Card", color: METHOD_COLORS.Card },
  "Bank Transfer": { label: "Bank Transfer", color: METHOD_COLORS["Bank Transfer"] },
  Stripe: { label: "Stripe", color: METHOD_COLORS.Stripe },
  Other: { label: "Other", color: METHOD_COLORS.Other },
};

const verificationChartConfig: ChartConfig = {
  auto_approved: { label: "Auto Approved", color: "#22c55e" },
  approved: { label: "Approved", color: "#16a34a" },
  pending: { label: "Pending", color: "#f59e0b" },
  rejected: { label: "Rejected", color: "#ef4444" },
};

const amountDistConfig: ChartConfig = {
  count: { label: "Payments", color: "#6366f1" },
};

const areaChartConfig: ChartConfig = {
  amount: { label: "Amount", color: "#6366f1" },
};

export default function PaymentsAnalyticsPage() {
  const { tenant } = useTenant();

  const { data: chartPayments, isLoading } = useQuery({
    queryKey: ["payments-chart-data", tenant?.id],
    queryFn: async () => {
      const firstOfMonth = startOfMonth(new Date()).toISOString().split('T')[0];
      const { data } = await supabase
        .from("payments")
        .select("amount, payment_date, method, payment_type, verification_status")
        .eq("tenant_id", tenant!.id)
        .gte("payment_date", firstOfMonth);
      return data || [];
    },
    enabled: !!tenant,
    staleTime: 60000,
  });

  const dailyTrendData = useMemo(() => {
    if (!chartPayments?.length) return [];
    const now = new Date();
    const days = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) });
    const dayMap = new Map<string, number>();
    chartPayments.forEach((p: any) => {
      const key = p.payment_date?.split('T')[0] || '';
      dayMap.set(key, (dayMap.get(key) || 0) + (p.amount || 0));
    });
    return days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      return { date: format(d, 'dd MMM'), amount: dayMap.get(key) || 0 };
    });
  }, [chartPayments]);

  const methodDonutData = useMemo(() => {
    if (!chartPayments?.length) return [];
    const counts = new Map<string, number>();
    chartPayments.forEach((p: any) => {
      const method = p.method || 'Other';
      counts.set(method, (counts.get(method) || 0) + 1);
    });
    return Array.from(counts, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [chartPayments]);

  const amountDistData = useMemo(() => {
    if (!chartPayments?.length) return [];
    const buckets = [
      { label: "< 100", min: 0, max: 100 },
      { label: "100–500", min: 100, max: 500 },
      { label: "500–1k", min: 500, max: 1000 },
      { label: "1k–2.5k", min: 1000, max: 2500 },
      { label: "2.5k–5k", min: 2500, max: 5000 },
      { label: "5k+", min: 5000, max: Infinity },
    ];
    const counts = new Array(buckets.length).fill(0);
    chartPayments.forEach((p: any) => {
      const amt = p.amount || 0;
      for (let i = 0; i < buckets.length; i++) {
        if (amt >= buckets[i].min && amt < buckets[i].max) { counts[i]++; break; }
      }
    });
    return buckets.map((b, i) => ({ name: b.label, count: counts[i] }));
  }, [chartPayments]);

  const approvalRadialData = useMemo(() => {
    if (!chartPayments?.length) return { rate: 0, approved: 0, total: 0, pending: 0, rejected: 0 };
    let approved = 0, pending = 0, rejected = 0;
    chartPayments.forEach((p: any) => {
      const s = p.verification_status || 'auto_approved';
      if (s === 'auto_approved' || s === 'approved') approved++;
      else if (s === 'pending') pending++;
      else if (s === 'rejected') rejected++;
    });
    const total = chartPayments.length;
    return { rate: Math.round((approved / total) * 100), approved, total, pending, rejected };
  }, [chartPayments]);

  if (isLoading) {
    return (<div className="container mx-auto p-6 space-y-6"><div className="h-8 bg-muted animate-pulse rounded"></div><div className="h-96 bg-muted animate-pulse rounded"></div></div>);
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/payments"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Payments Analytics</h1>
          <p className="text-sm text-muted-foreground">Charts and insights for payment data</p>
        </div>
      </div>

      {chartPayments && chartPayments.length > 0 ? (
        <TooltipProvider>
          <div className="space-y-4">
            {/* Daily Payment Collection */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Daily Payment Collection</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Total payment amounts collected per day this month</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={areaChartConfig} className="h-[220px] w-full">
                <BarChart data={dailyTrendData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval={Math.max(0, Math.floor(dailyTrendData.length / 10))} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(v, tenant?.currency_code || 'USD')} width={70} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground mb-0.5">{d.date}</p><p className="text-sm font-semibold">{formatCurrency(d.amount, tenant?.currency_code || 'USD')}</p></div>);
                  }} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Row: 3 supporting charts */}
            <div className="grid gap-4 md:grid-cols-3">
              {/* Payment Methods Donut */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Payment Methods</h3>
                  <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                  <TooltipContent>Distribution of payment methods this month</TooltipContent></Tooltip>
                </div>
                <ChartContainer config={methodChartConfig} className="h-[200px] w-full">
                  <PieChart>
                    <Pie data={methodDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" nameKey="name" strokeWidth={2} stroke="hsl(var(--background))">
                      {methodDonutData.map((entry) => (<Cell key={entry.name} fill={METHOD_COLORS[entry.name] || METHOD_COLORS.Other} />))}
                    </Pie>
                    <ChartTooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: METHOD_COLORS[d.name] || METHOD_COLORS.Other }} /><span className="text-sm font-medium">{d.name}</span></div><p className="text-xs text-muted-foreground mt-0.5">{d.value} payment{d.value !== 1 ? 's' : ''}</p></div>);
                    }} />
                    <text x="50%" y="46%" textAnchor="middle" className="fill-foreground text-xl font-bold">{chartPayments.length}</text>
                    <text x="50%" y="58%" textAnchor="middle" className="fill-muted-foreground text-[11px]">Total</text>
                  </PieChart>
                </ChartContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                  {methodDonutData.map((d) => (<div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: METHOD_COLORS[d.name] || METHOD_COLORS.Other }} />{d.name} ({d.value})</div>))}
                </div>
              </div>

              {/* Amount Distribution */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Amount Distribution</h3>
                  <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                  <TooltipContent>Number of payments by amount range this month</TooltipContent></Tooltip>
                </div>
                <ChartContainer config={amountDistConfig} className="h-[200px] w-full">
                  <BarChart data={amountDistData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground mb-0.5">{d.name}</p><p className="text-sm font-semibold">{d.count} payment{d.count !== 1 ? 's' : ''}</p></div>);
                    }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} />
                  </BarChart>
                </ChartContainer>
              </div>

              {/* Approval Rate Radial */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Approval Rate</h3>
                  <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                  <TooltipContent>Percentage of payments approved this month</TooltipContent></Tooltip>
                </div>
                <ChartContainer config={verificationChartConfig} className="h-[200px] w-full">
                  <RadialBarChart cx="50%" cy="50%" innerRadius={65} outerRadius={85} startAngle={90} endAngle={-270} data={[{ name: "Approved", value: approvalRadialData.rate }]} barSize={14}>
                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                    <RadialBar dataKey="value" cornerRadius={8} fill="#22c55e" background={{ fill: "hsl(var(--muted))" }} angleAxisId={0} />
                    <text x="50%" y="44%" textAnchor="middle" className="fill-foreground text-2xl font-bold">{approvalRadialData.rate}%</text>
                    <text x="50%" y="56%" textAnchor="middle" className="fill-muted-foreground text-[11px]">Approved</text>
                  </RadialBarChart>
                </ChartContainer>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-green-500" />Approved ({approvalRadialData.approved})</div>
                  {approvalRadialData.pending > 0 && (<div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-amber-500" />Pending ({approvalRadialData.pending})</div>)}
                  {approvalRadialData.rejected > 0 && (<div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-red-500" />Rejected ({approvalRadialData.rejected})</div>)}
                </div>
              </div>
            </div>
          </div>
        </TooltipProvider>
      ) : (
        <div className="text-center py-12"><p className="text-muted-foreground">No payment data available for analytics</p></div>
      )}
    </div>
  );
}
