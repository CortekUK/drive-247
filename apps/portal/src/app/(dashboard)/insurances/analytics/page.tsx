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
import { format, subMonths, startOfMonth } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";

const SOURCE_COLORS: Record<string, string> = {
  "Bonzah": "#CC004A",
  "Uploaded": "#6366f1",
};

const sourceChartConfig: ChartConfig = {
  Bonzah: { label: "Bonzah", color: SOURCE_COLORS.Bonzah },
  Uploaded: { label: "Uploaded", color: SOURCE_COLORS.Uploaded },
};

const statusRadialConfig: ChartConfig = {
  value: { label: "Active", color: "#22c55e" },
};

const monthlyConfig: ChartConfig = {
  count: { label: "Insurances", color: "#6366f1" },
};

const customerBarConfig: ChartConfig = {
  count: { label: "Insurances", color: "#8b5cf6" },
};

export default function InsurancesAnalyticsPage() {
  const { tenant } = useTenant();

  const { data: insuranceDocuments = [], isLoading: l1 } = useQuery({
    queryKey: ["insurance-documents", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_documents")
        .select("*, customers!customer_documents_customer_id_fkey(name)")
        .eq("tenant_id", tenant!.id)
        .or("document_type.eq.Insurance Certificate,insurance_provider.not.is.null")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant,
  });

  const { data: bonzahPolicies = [], isLoading: l2 } = useQuery({
    queryKey: ["bonzah-policies-insurances", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonzah_insurance_policies")
        .select("id, status, created_at, customer_id, customers!bonzah_insurance_policies_customer_id_fkey(name)")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant,
  });

  const isLoading = l1 || l2;

  const allInsurances = useMemo(() => [
    ...insuranceDocuments.map((doc: any) => ({
      created_at: doc.created_at,
      customer: doc.customers?.name,
      isBonzah: doc.insurance_provider?.toLowerCase().includes("bonzah") || false,
      status: doc.status,
    })),
    ...bonzahPolicies.map((p: any) => ({
      created_at: p.created_at,
      customer: p.customers?.name,
      isBonzah: true,
      status: p.status,
    })),
  ], [insuranceDocuments, bonzahPolicies]);

  const sourceDonutData = useMemo(() => {
    if (!allInsurances.length) return [];
    const bonzah = allInsurances.filter(d => d.isBonzah).length;
    const uploaded = allInsurances.filter(d => !d.isBonzah).length;
    return [
      { name: "Bonzah", value: bonzah },
      { name: "Uploaded", value: uploaded },
    ].filter(d => d.value > 0);
  }, [allInsurances]);

  const statusRadialData = useMemo(() => {
    const active = allInsurances.filter(d => d.status === "active" || d.status === "confirmed").length;
    const total = allInsurances.length;
    const rate = total > 0 ? Math.round((active / total) * 100) : 0;
    return { rate, active, total, inactive: total - active };
  }, [allInsurances]);

  const monthlyData = useMemo(() => {
    if (!allInsurances.length) return [];
    const now = new Date();
    const months: { label: string; start: Date }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      months.push({ label: format(startOfMonth(d), "MMM yyyy"), start: startOfMonth(d) });
    }
    return months.map((m, i) => {
      const nextStart = i < months.length - 1 ? months[i + 1].start : new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const count = allInsurances.filter(a => {
        const d = new Date(a.created_at);
        return d >= m.start && d < nextStart;
      }).length;
      return { name: format(m.start, "MMM"), count };
    });
  }, [allInsurances]);

  const topCustomersData = useMemo(() => {
    if (!allInsurances.length) return [];
    const counts = new Map<string, number>();
    allInsurances.forEach(a => {
      const name = a.customer || "Unknown";
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name: name.length > 12 ? name.slice(0, 12) + "\u2026" : name, count, fullName: name }));
  }, [allInsurances]);

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
        <Link href="/insurances">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Insurances Analytics</h1>
          <p className="text-sm text-muted-foreground">Charts and insights for insurance management</p>
        </div>
      </div>

      {allInsurances.length > 0 ? (
        <TooltipProvider>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Insurance Sources */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Insurance Sources</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Bonzah vs uploaded insurance documents</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={sourceChartConfig} className="h-[180px] w-full">
                <PieChart>
                  <Pie data={sourceDonutData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" nameKey="name" strokeWidth={2} stroke="hsl(var(--background))">
                    {sourceDonutData.map((entry) => (<Cell key={entry.name} fill={SOURCE_COLORS[entry.name] || "#94a3b8"} />))}
                  </Pie>
                  <ChartTooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[d.name] || "#94a3b8" }} /><span className="text-sm font-medium">{d.name}</span></div><p className="text-xs text-muted-foreground mt-0.5">{d.value} polic{d.value !== 1 ? "ies" : "y"}</p></div>);
                  }} />
                  <text x="50%" y="46%" textAnchor="middle" className="fill-foreground text-xl font-bold">{allInsurances.length}</text>
                  <text x="50%" y="58%" textAnchor="middle" className="fill-muted-foreground text-[11px]">Total</text>
                </PieChart>
              </ChartContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                {sourceDonutData.map((d) => (<div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: SOURCE_COLORS[d.name] || "#94a3b8" }} />{d.name} ({d.value})</div>))}
              </div>
            </div>

            {/* Active Policy Rate */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Policy Status</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Percentage of policies that are currently active</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={statusRadialConfig} className="h-[180px] w-full">
                <RadialBarChart cx="50%" cy="50%" innerRadius={55} outerRadius={75} startAngle={90} endAngle={-270} data={[{ name: "Active", value: statusRadialData.rate }]} barSize={14}>
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar dataKey="value" cornerRadius={8} fill="#22c55e" background={{ fill: "hsl(var(--muted))" }} angleAxisId={0} />
                  <text x="50%" y="44%" textAnchor="middle" className="fill-foreground text-2xl font-bold">{statusRadialData.rate}%</text>
                  <text x="50%" y="56%" textAnchor="middle" className="fill-muted-foreground text-[11px]">Active</text>
                </RadialBarChart>
              </ChartContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-green-500" />Active ({statusRadialData.active})</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-muted-foreground/30" />Inactive ({statusRadialData.inactive})</div>
              </div>
            </div>

            {/* Monthly Trend */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Monthly Trend</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Number of insurance records per month (last 6 months)</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
                <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground mb-0.5">{d.name}</p><p className="text-sm font-semibold">{d.count} insurance{d.count !== 1 ? "s" : ""}</p></div>);
                  }} />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Top Customers */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Top Customers</h3>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                <TooltipContent>Customers with the most insurance records</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={customerBarConfig} className="h-[180px] w-full">
                <BarChart data={topCustomersData} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={75} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground mb-0.5">{d.fullName}</p><p className="text-sm font-semibold">{d.count} insurance{d.count !== 1 ? "s" : ""}</p></div>);
                  }} />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        </TooltipProvider>
      ) : (
        <div className="text-center py-12"><p className="text-muted-foreground">No insurance data available for analytics</p></div>
      )}
    </div>
  );
}
