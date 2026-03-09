"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Info } from "lucide-react";
import { startOfWeek, eachWeekOfInterval, subMonths, format } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";

const statusChartConfig = {
  Active: { label: "Active", color: "#10b981" },
  Inactive: { label: "Inactive", color: "#6b7280" },
  Rejected: { label: "Rejected", color: "#ef4444" },
} satisfies ChartConfig;

const STATUS_COLORS: Record<string, string> = { Active: "#10b981", Inactive: "#6b7280", Rejected: "#ef4444" };

const typeChartConfig = {
  Individual: { label: "Individual", color: "#6366f1" },
  Company: { label: "Company", color: "#3b82f6" },
} satisfies ChartConfig;

const TYPE_COLORS: Record<string, string> = { Individual: "#6366f1", Company: "#3b82f6" };

const authChartConfig = { count: { label: "Customers", color: "#6366f1" } } satisfies ChartConfig;
const AUTH_COLORS: Record<string, string> = { Authenticated: "#10b981", Guest: "#9ca3af" };

const areaChartConfig = { count: { label: "Customers", color: "#6366f1" } } satisfies ChartConfig;

const balanceChartConfig = {
  "In Credit": { label: "In Credit", color: "#10b981" },
  Settled: { label: "Settled", color: "#6b7280" },
  "In Debt": { label: "In Debt", color: "#ef4444" },
} satisfies ChartConfig;

const BALANCE_COLORS: Record<string, string> = { "In Credit": "#10b981", Settled: "#6b7280", "In Debt": "#ef4444" };

export default function CustomersAnalyticsPage() {
  const { tenant } = useTenant();

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers-list", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("tenant_id", tenant!.id).order("created_at", { ascending: false });
      if (error) throw error;
      const customerIds = data?.map(c => c.id) || [];
      if (customerIds.length > 0) {
        const { data: customerUsers } = await supabase.from("customer_users").select("customer_id").in("customer_id", customerIds);
        const authSet = new Set(customerUsers?.map(cu => cu.customer_id) || []);
        return data?.map(c => ({ ...c, user_type: authSet.has(c.id) ? "Authenticated" : "Guest" })) || [];
      }
      return data?.map(c => ({ ...c, user_type: "Guest" })) || [];
    },
    enabled: !!tenant,
  });

  const { data: customerBalances = {} } = useQuery({
    queryKey: ["customer-balances-enhanced", tenant?.id],
    queryFn: async () => {
      if (!customers?.length) return {};
      const customerIds = customers.map((c: any) => c.id);
      let excludedRentalsQuery = supabase.from("rentals").select("id, customer_id").in("customer_id", customerIds).or("status.eq.Cancelled,approval_status.eq.rejected");
      if (tenant?.id) excludedRentalsQuery = excludedRentalsQuery.eq("tenant_id", tenant.id);
      const { data: excludedRentals } = await excludedRentalsQuery;
      const excludedRentalIds = new Set(excludedRentals?.map(r => r.id) || []);
      let ledgerQuery = supabase.from("ledger_entries").select("customer_id, type, amount, remaining_amount, due_date, category, rental_id").in("customer_id", customerIds);
      if (tenant?.id) ledgerQuery = ledgerQuery.eq("tenant_id", tenant.id);
      const { data: allEntries } = await ledgerQuery;
      const entriesByCustomer: Record<string, any[]> = {};
      allEntries?.forEach(entry => { if (!entriesByCustomer[entry.customer_id]) entriesByCustomer[entry.customer_id] = []; entriesByCustomer[entry.customer_id].push(entry); });
      const balanceMap: Record<string, any> = {};
      for (const customer of customers) {
        const entries = entriesByCustomer[(customer as any).id] || [];
        let balance = 0;
        entries.forEach((entry: any) => {
          if (entry.type === 'Charge') {
            if (entry.rental_id && excludedRentalIds.has(entry.rental_id)) return;
            if (entry.category === 'Rental' && entry.due_date && new Date(entry.due_date) > new Date()) return;
            balance += (entry.remaining_amount || 0);
          }
        });
        let status: string;
        if (Math.abs(balance) < 0.01) status = 'Settled';
        else if (balance > 0) status = 'In Debt';
        else status = 'In Credit';
        balanceMap[(customer as any).id] = { balance: Math.abs(balance), status };
      }
      return balanceMap;
    },
    enabled: !!customers?.length,
  });

  const nonBlockedCustomers = useMemo(() => customers?.filter((c: any) => !c.is_blocked) || [], [customers]);

  const statusDonutData = useMemo(() => {
    if (!nonBlockedCustomers.length) return [];
    const counts: Record<string, number> = {};
    nonBlockedCustomers.forEach((c: any) => { const s = c.status || "Inactive"; counts[s] = (counts[s] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [nonBlockedCustomers]);

  const typeDonutData = useMemo(() => {
    if (!nonBlockedCustomers.length) return [];
    const counts: Record<string, number> = { Individual: 0, Company: 0 };
    nonBlockedCustomers.forEach((c: any) => { const t = c.customer_type || "Individual"; counts[t] = (counts[t] || 0) + 1; });
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [nonBlockedCustomers]);

  const authBarData = useMemo(() => {
    if (!nonBlockedCustomers.length) return [];
    const counts: Record<string, number> = { Authenticated: 0, Guest: 0 };
    nonBlockedCustomers.forEach((c: any) => { const t = c.user_type || "Guest"; counts[t] = (counts[t] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [nonBlockedCustomers]);

  const customersOverTimeData = useMemo(() => {
    if (!nonBlockedCustomers.length) return [];
    const now = new Date();
    const threeMonthsAgo = subMonths(now, 3);
    const weeks = eachWeekOfInterval({ start: threeMonthsAgo, end: now }, { weekStartsOn: 1 });
    const weekCounts = new Map<string, number>();
    weeks.forEach((w) => weekCounts.set(format(w, "MMM d"), 0));
    nonBlockedCustomers.forEach((c: any) => {
      if (!c.created_at) return;
      const created = new Date(c.created_at);
      if (created < threeMonthsAgo) return;
      const weekStart = startOfWeek(created, { weekStartsOn: 1 });
      const key = format(weekStart, "MMM d");
      if (weekCounts.has(key)) weekCounts.set(key, (weekCounts.get(key) || 0) + 1);
    });
    return Array.from(weekCounts.entries()).map(([week, count]) => ({ week, count }));
  }, [nonBlockedCustomers]);

  const balanceDonutData = useMemo(() => {
    if (!nonBlockedCustomers.length || !Object.keys(customerBalances).length) return [];
    const counts: Record<string, number> = { "In Credit": 0, Settled: 0, "In Debt": 0 };
    nonBlockedCustomers.forEach((c: any) => {
      const b = customerBalances[c.id];
      if (b) counts[b.status] = (counts[b.status] || 0) + 1;
      else counts["Settled"]++;
    });
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [nonBlockedCustomers, customerBalances]);

  if (isLoading) {
    return (<div className="container mx-auto p-6 space-y-6"><div className="h-8 bg-muted animate-pulse rounded"></div><div className="h-96 bg-muted animate-pulse rounded"></div></div>);
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/customers"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Customers Analytics</h1>
          <p className="text-sm text-muted-foreground">Charts and insights for customer data</p>
        </div>
      </div>

      {nonBlockedCustomers.length > 0 ? (
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-1.5 mb-3"><h3 className="text-sm font-medium">Status Distribution</h3><Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Breakdown of customers by account status</p></TooltipContent></Tooltip></div>
              {statusDonutData.length > 0 ? (
                <ChartContainer config={statusChartConfig} className="h-[200px] w-full">
                  <PieChart><Pie data={statusDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">{statusDonutData.map((entry) => (<Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#6b7280"} />))}</Pie><ChartTooltip content={<ChartTooltipContent />} /><text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{nonBlockedCustomers.length}</text><text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">Total</text></PieChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </Card>

            <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-1.5 mb-3"><h3 className="text-sm font-medium">Customer Types</h3><Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Individual vs company customers</p></TooltipContent></Tooltip></div>
              {typeDonutData.length > 0 ? (
                <ChartContainer config={typeChartConfig} className="h-[200px] w-full">
                  <PieChart><Pie data={typeDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">{typeDonutData.map((entry) => (<Cell key={entry.name} fill={TYPE_COLORS[entry.name] || "#6b7280"} />))}</Pie><ChartTooltip content={<ChartTooltipContent />} /><text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{typeDonutData.reduce((s, d) => s + d.value, 0)}</text><text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">Total</text></PieChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </Card>

            <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-1.5 mb-3"><h3 className="text-sm font-medium">Authentication</h3><Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Authenticated (portal access) vs guest customers</p></TooltipContent></Tooltip></div>
              {authBarData.length > 0 ? (
                <ChartContainer config={authChartConfig} className="h-[200px] w-full">
                  <BarChart data={authBarData} layout="vertical" margin={{ left: 10, right: 10 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} /><YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={95} /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} allowDecimals={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="count" radius={[0, 4, 4, 0]}>{authBarData.map((entry) => (<Cell key={entry.name} fill={AUTH_COLORS[entry.name] || "#6b7280"} />))}</Bar></BarChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className={`rounded-lg border border-border/60 bg-card/50 p-4 ${balanceDonutData.length > 0 ? "md:col-span-2" : "md:col-span-3"}`}>
              <div className="flex items-center gap-1.5 mb-3"><h3 className="text-sm font-medium">Customers Over Time</h3><Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">New customers added per week over the last 3 months</p></TooltipContent></Tooltip></div>
              {customersOverTimeData.length > 0 ? (
                <ChartContainer config={areaChartConfig} className="h-[200px] w-full">
                  <AreaChart data={customersOverTimeData} margin={{ left: -10, right: 5, top: 5 }}>
                    <defs><linearGradient id="customersAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} allowDecimals={false} /><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#customersAreaFill)" />
                  </AreaChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </Card>

            {balanceDonutData.length > 0 && (
              <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-1.5 mb-3"><h3 className="text-sm font-medium">Balance Status</h3><Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Customer balance distribution</p></TooltipContent></Tooltip></div>
                <ChartContainer config={balanceChartConfig} className="h-[200px] w-full">
                  <PieChart><Pie data={balanceDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">{balanceDonutData.map((entry) => (<Cell key={entry.name} fill={BALANCE_COLORS[entry.name] || "#6b7280"} />))}</Pie><ChartTooltip content={<ChartTooltipContent />} /><text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{balanceDonutData.reduce((s, d) => s + d.value, 0)}</text><text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">Total</text></PieChart>
                </ChartContainer>
              </Card>
            )}
          </div>
        </TooltipProvider>
      ) : (
        <div className="text-center py-12"><p className="text-muted-foreground">No customer data available for analytics</p></div>
      )}
    </div>
  );
}
