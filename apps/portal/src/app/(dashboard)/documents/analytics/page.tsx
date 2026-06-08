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
import { ArrowLeft, Info, BarChart3 } from "lucide-react";
import { format, subMonths, startOfMonth } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { Tile, Eyebrow, EmptyState, Shimmer } from "@/components/bento";

// Multi-category chart palette — recharts requires concrete fill values per slice.
const TYPE_COLORS: Record<string, string> = {
  "Insurance Certificate": "#6366f1",
  "Driving Licence": "#22c55e",
  "National Insurance": "#f59e0b",
  "Address Proof": "#06b6d4",
  "ID Card/Passport": "#8b5cf6",
  "Agreement": "#ec4899",
  "Other": "#94a3b8",
};

const typeChartConfig = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([k, v]) => [k, { label: k, color: v }])
) as ChartConfig;

const monthlyConfig: ChartConfig = {
  count: { label: "Documents", color: "#6366f1" },
};

const verifiedRadialConfig: ChartConfig = {
  rate: { label: "Verified", color: "#22c55e" },
};

interface Document {
  id: string;
  document_name: string;
  created_at: string;
  document_type?: string;
  verified?: boolean;
  customers?: { name: string };
  isBonzah?: boolean;
}

export default function DocumentsAnalyticsPage() {
  const { tenant } = useTenant();

  const { data: completedDocuments = [], isLoading: isLoadingCompleted } = useQuery({
    queryKey: ["completed-documents", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_documents")
        .select(`*, customers!customer_documents_customer_id_fkey(name)`)
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: rentalAgreements = [], isLoading: isLoadingRentals } = useQuery({
    queryKey: ["rental-agreements", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`id, created_at, document_status, signed_document_id, customers!rentals_customer_id_fkey(name), vehicles!rentals_vehicle_id_fkey(reg, make, model)`)
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: bonzahPolicies = [], isLoading: isLoadingBonzah } = useQuery({
    queryKey: ["bonzah-policies-docs", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonzah_insurance_policies")
        .select(`id, policy_no, quote_no, status, created_at, customer_id, customers!bonzah_insurance_policies_customer_id_fkey(name)`)
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = isLoadingCompleted || isLoadingRentals || isLoadingBonzah;

  const allDocuments: Document[] = [
    ...completedDocuments.map((doc: any) => ({ ...doc, isBonzah: doc.insurance_provider?.toLowerCase().includes('bonzah') || false })),
    ...rentalAgreements.filter((r: any) => !r.signed_document_id).map((r: any) => ({
      id: r.id, document_name: `Rental Agreement - ${r.vehicles?.reg || 'Vehicle'}`, created_at: r.created_at,
      document_type: 'Agreement', customers: r.customers, isRentalAgreement: true,
    })),
    ...bonzahPolicies.map((p: any) => ({
      id: `bonzah-${p.id}`, document_name: `Bonzah Insurance${p.policy_no ? ` - Policy #${p.policy_no}` : ''}`,
      created_at: p.created_at, document_type: 'Insurance', customers: p.customers, isBonzah: true,
    })),
  ];

  const typeDonutData = useMemo(() => {
    const counts: Record<string, number> = {};
    allDocuments.forEach((doc) => { const type = doc.document_type || "Other"; counts[type] = (counts[type] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value, fill: TYPE_COLORS[name] || TYPE_COLORS["Other"] })).sort((a, b) => b.value - a.value);
  }, [allDocuments]);

  const monthlyUploadData = useMemo(() => {
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const key = format(startOfMonth(d), "yyyy-MM");
      const label = format(d, "MMM");
      const count = allDocuments.filter((doc) => doc.created_at?.startsWith(key)).length;
      months.push({ month: label, count });
    }
    return months;
  }, [allDocuments]);

  const verifiedRadialData = useMemo(() => {
    const verifiable = completedDocuments.filter((d: any) => d.verified !== undefined);
    const verified = verifiable.filter((d: any) => d.verified === true).length;
    const total = verifiable.length;
    const rate = total > 0 ? Math.round((verified / total) * 100) : 0;
    return { rate, verified, total, unverified: total - verified };
  }, [completedDocuments]);

  const topCustomersData = useMemo(() => {
    const counts: Record<string, number> = {};
    allDocuments.forEach((doc) => { const name = doc.customers?.name || "Unknown"; counts[name] = (counts[name] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name: name.length > 12 ? name.slice(0, 12) + "…" : name, count, fullName: name }));
  }, [allDocuments]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 space-y-6">
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

  const hasData = allDocuments.length > 0;

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-2 sm:gap-4">
        <Link href="/documents" className="shrink-0"><Button variant="outline" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div className="min-w-0">
          <Eyebrow>Documents</Eyebrow>
          <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-tight">Documents Analytics</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Charts and insights for document management</p>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No document data"
          description="No documents available for analytics yet."
        />
      ) : (
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Document Types Donut */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>Document Types</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Breakdown by document category</TooltipContent></Tooltip>
              </div>
              {typeDonutData.length > 0 ? (
                <ChartContainer config={typeChartConfig} className="h-[180px] w-full">
                  <PieChart>
                    <Pie data={typeDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {typeDonutData.map((entry) => (<Cell key={entry.name} fill={entry.fill} />))}
                    </Pie>
                    <ChartTooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} /><span className="text-sm font-medium">{d.name}</span></div><p className="text-sm text-muted-foreground mt-0.5">{d.value} document{d.value !== 1 ? "s" : ""}</p></div>);
                    }} />
                  </PieChart>
                </ChartContainer>
              ) : (<p className="text-sm text-muted-foreground text-center py-10">No data</p>)}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {typeDonutData.slice(0, 4).map((d) => (<div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />{d.name.length > 16 ? d.name.slice(0, 16) + "…" : d.name}</div>))}
              </div>
            </Tile>

            {/* Monthly Upload Trend */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>Monthly Uploads</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Document uploads over last 6 months</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
                <BarChart data={monthlyUploadData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={28} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground">{d.month}</p><p className="text-sm font-semibold">{d.count} document{d.count !== 1 ? "s" : ""}</p></div>);
                  }} />
                </BarChart>
              </ChartContainer>
            </Tile>

            {/* Verification Rate Radial */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>Verification Rate</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Percentage of documents verified</TooltipContent></Tooltip>
              </div>
              <ChartContainer config={verifiedRadialConfig} className="h-[180px] w-full">
                <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ rate: verifiedRadialData.rate }]} startAngle={180} endAngle={0} cx="50%" cy="65%">
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar background={{ fill: "hsl(var(--muted))" }} dataKey="rate" cornerRadius={6} fill="var(--bento-success)" />
                  <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{verifiedRadialData.rate}%</text>
                  <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-xs">{verifiedRadialData.verified}/{verifiedRadialData.total} verified</text>
                </RadialBarChart>
              </ChartContainer>
            </Tile>

            {/* Top Customers by Docs */}
            <Tile pad="none" className="p-3 sm:p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <Eyebrow>Top Customers</Eyebrow>
                <Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger><TooltipContent>Customers with most documents</TooltipContent></Tooltip>
              </div>
              {topCustomersData.length > 0 ? (
                <ChartContainer config={{ count: { label: "Documents", color: "#6366f1" } }} className="h-[180px] w-full">
                  <BarChart data={topCustomersData} layout="vertical" margin={{ left: 0, right: 8 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={80} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-sm font-medium">{d.fullName}</p><p className="text-sm text-muted-foreground">{d.count} document{d.count !== 1 ? "s" : ""}</p></div>);
                    }} />
                  </BarChart>
                </ChartContainer>
              ) : (<p className="text-sm text-muted-foreground text-center py-10">No data</p>)}
            </Tile>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
