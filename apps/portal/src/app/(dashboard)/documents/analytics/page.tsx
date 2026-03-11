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
    queryFn: async () => {
      let query = supabase
        .from("customer_documents")
        .select(`*, customers!customer_documents_customer_id_fkey(name)`)
        .order("created_at", { ascending: false });
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    },
    enabled: !!tenant,
  });

  const { data: rentalAgreements = [], isLoading: isLoadingRentals } = useQuery({
    queryKey: ["rental-agreements", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("rentals")
        .select(`id, created_at, document_status, signed_document_id, customers!rentals_customer_id_fkey(name), vehicles!rentals_vehicle_id_fkey(reg, make, model)`)
        .order("created_at", { ascending: false });
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant,
  });

  const { data: bonzahPolicies = [], isLoading: isLoadingBonzah } = useQuery({
    queryKey: ["bonzah-policies-docs", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("bonzah_insurance_policies")
        .select(`id, policy_no, quote_no, status, created_at, customer_id, customers!bonzah_insurance_policies_customer_id_fkey(name)`)
        .order("created_at", { ascending: false });
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant,
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
    return (<div className="container mx-auto p-6 space-y-6"><div className="h-8 bg-muted animate-pulse rounded"></div><div className="h-96 bg-muted animate-pulse rounded"></div></div>);
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/documents"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Documents Analytics</h1>
          <p className="text-sm text-muted-foreground">Charts and insights for document management</p>
        </div>
      </div>

      <TooltipProvider>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Document Types Donut */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Document Types</h3>
              <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Breakdown by document category</TooltipContent></Tooltip>
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
          </div>

          {/* Monthly Upload Trend */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Monthly Uploads</h3>
              <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Document uploads over last 6 months</TooltipContent></Tooltip>
            </div>
            <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
              <BarChart data={monthlyUploadData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={28} />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-xs text-muted-foreground">{d.month}</p><p className="text-sm font-semibold">{d.count} document{d.count !== 1 ? "s" : ""}</p></div>);
                }} />
              </BarChart>
            </ChartContainer>
          </div>

          {/* Verification Rate Radial */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Verification Rate</h3>
              <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Percentage of documents verified</TooltipContent></Tooltip>
            </div>
            <ChartContainer config={verifiedRadialConfig} className="h-[180px] w-full">
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ rate: verifiedRadialData.rate, fill: "#22c55e" }]} startAngle={180} endAngle={0} cx="50%" cy="65%">
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background dataKey="rate" cornerRadius={6} />
                <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{verifiedRadialData.rate}%</text>
                <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-xs">{verifiedRadialData.verified}/{verifiedRadialData.total} verified</text>
              </RadialBarChart>
            </ChartContainer>
          </div>

          {/* Top Customers by Docs */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Top Customers</h3>
              <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Customers with most documents</TooltipContent></Tooltip>
            </div>
            {topCustomersData.length > 0 ? (
              <ChartContainer config={{ count: { label: "Documents", color: "#6366f1" } }} className="h-[180px] w-full">
                <BarChart data={topCustomersData} layout="vertical" margin={{ left: 0, right: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={80} />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div className="rounded-lg border bg-background px-3 py-2 shadow-md"><p className="text-sm font-medium">{d.fullName}</p><p className="text-sm text-muted-foreground">{d.count} document{d.count !== 1 ? "s" : ""}</p></div>);
                  }} />
                </BarChart>
              </ChartContainer>
            ) : (<p className="text-sm text-muted-foreground text-center py-10">No data</p>)}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
