"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Tile, Eyebrow, EmptyState, Shimmer } from "@/components/bento";

// Chart series colors. Recharts needs concrete values; we lean on the violet
// primary token and the muted Bento status hues so charts match the system.
const ACCENT = "hsl(var(--primary))";
const SUCCESS = "var(--bento-success)";
const NEUTRAL = "var(--bento-text-3)";
const DANGER = "var(--bento-danger-fg)";
const INFO = "var(--bento-info)";

const statusChartConfig = {
  Active: { label: "Active", color: SUCCESS },
  Inactive: { label: "Inactive", color: NEUTRAL },
  Rejected: { label: "Rejected", color: DANGER },
} satisfies ChartConfig;

const STATUS_COLORS: Record<string, string> = { Active: SUCCESS, Inactive: NEUTRAL, Rejected: DANGER };

const typeChartConfig = {
  Individual: { label: "Individual", color: ACCENT },
  Company: { label: "Company", color: INFO },
} satisfies ChartConfig;

const TYPE_COLORS: Record<string, string> = { Individual: ACCENT, Company: INFO };

const authChartConfig = { count: { label: "Customers", color: ACCENT } } satisfies ChartConfig;
const AUTH_COLORS: Record<string, string> = { Authenticated: SUCCESS, Guest: NEUTRAL };

const areaChartConfig = { count: { label: "Customers", color: ACCENT } } satisfies ChartConfig;

const balanceChartConfig = {
  "In Credit": { label: "In Credit", color: SUCCESS },
  Settled: { label: "Settled", color: NEUTRAL },
  "In Debt": { label: "In Debt", color: DANGER },
} satisfies ChartConfig;

const BALANCE_COLORS: Record<string, string> = { "In Credit": SUCCESS, Settled: NEUTRAL, "In Debt": DANGER };

function ChartCard({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tile className={className}>
      <div className="flex items-center gap-1.5 mb-3">
        <Eyebrow>{title}</Eyebrow>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-[color:var(--bento-text-3)] cursor-help" />
          </TooltipTrigger>
          <TooltipContent><p className="text-xs">{hint}</p></TooltipContent>
        </Tooltip>
      </div>
      {children}
    </Tile>
  );
}

export default function CustomersAnalyticsPage() {
  const { tenant } = useTenant();

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers-list", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("tenant_id", tenant!.id).order("created_at", { ascending: false });
      if (error) throw error;
      const customerIds = data?.map(c => c.id) || [];
      if (customerIds.length > 0) {
        // customer_id is already tenant-scoped via the customerIds list above
        const { data: customerUsers } = await supabase.from("customer_users").select("customer_id").in("customer_id", customerIds);
        const authSet = new Set(customerUsers?.map(cu => cu.customer_id) || []);
        return data?.map(c => ({ ...c, user_type: authSet.has(c.id) ? "Authenticated" : "Guest" })) || [];
      }
      return data?.map(c => ({ ...c, user_type: "Guest" })) || [];
    },
  });

  const { data: customerBalances = {} } = useQuery({
    queryKey: ["customer-balances-enhanced", tenant?.id, customers?.length ?? 0],
    enabled: !!tenant?.id && !!customers?.length,
    queryFn: async () => {
      if (!customers?.length) return {};
      const tenantId = tenant!.id;
      const customerIds = customers.map((c: any) => c.id);
      const { data: excludedRentals } = await supabase.from("rentals").select("id, customer_id").eq("tenant_id", tenantId).in("customer_id", customerIds).or("status.eq.Cancelled,approval_status.eq.rejected");
      const excludedRentalIds = new Set(excludedRentals?.map(r => r.id) || []);
      const { data: allEntries } = await supabase.from("ledger_entries").select("customer_id, type, amount, remaining_amount, due_date, category, rental_id").eq("tenant_id", tenantId).in("customer_id", customerIds);
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
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Shimmer className="h-10 w-10 rounded-tile" />
          <div className="space-y-2">
            <Shimmer className="h-8 w-56" />
            <Shimmer className="h-4 w-64" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Shimmer key={i} className="h-[248px] rounded-tile" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Shimmer className="h-[248px] rounded-tile md:col-span-2" />
          <Shimmer className="h-[248px] rounded-tile" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/customers"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Customers Analytics</h1>
          <p className="text-sm text-muted-foreground">Charts and insights for customer data</p>
        </div>
      </div>

      {nonBlockedCustomers.length > 0 ? (
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ChartCard title="Status Distribution" hint="Breakdown of customers by account status">
              {statusDonutData.length > 0 ? (
                <ChartContainer config={statusChartConfig} className="h-[200px] w-full">
                  <PieChart><Pie data={statusDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">{statusDonutData.map((entry) => (<Cell key={entry.name} fill={STATUS_COLORS[entry.name] || NEUTRAL} />))}</Pie><ChartTooltip content={<ChartTooltipContent />} /><text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{nonBlockedCustomers.length}</text><text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">Total</text></PieChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </ChartCard>

            <ChartCard title="Customer Types" hint="Individual vs company customers">
              {typeDonutData.length > 0 ? (
                <ChartContainer config={typeChartConfig} className="h-[200px] w-full">
                  <PieChart><Pie data={typeDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">{typeDonutData.map((entry) => (<Cell key={entry.name} fill={TYPE_COLORS[entry.name] || NEUTRAL} />))}</Pie><ChartTooltip content={<ChartTooltipContent />} /><text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{typeDonutData.reduce((s, d) => s + d.value, 0)}</text><text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">Total</text></PieChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </ChartCard>

            <ChartCard title="Authentication" hint="Authenticated (portal access) vs guest customers">
              {authBarData.length > 0 ? (
                <ChartContainer config={authChartConfig} className="h-[200px] w-full">
                  <BarChart data={authBarData} layout="vertical" margin={{ left: 10, right: 10 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} /><YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={95} /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} allowDecimals={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="count" radius={[0, 4, 4, 0]}>{authBarData.map((entry) => (<Cell key={entry.name} fill={AUTH_COLORS[entry.name] || NEUTRAL} />))}</Bar></BarChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ChartCard
              title="Customers Over Time"
              hint="New customers added per week over the last 3 months"
              className={balanceDonutData.length > 0 ? "md:col-span-2" : "md:col-span-3"}
            >
              {customersOverTimeData.length > 0 ? (
                <ChartContainer config={areaChartConfig} className="h-[200px] w-full">
                  <AreaChart data={customersOverTimeData} margin={{ left: -10, right: 5, top: 5 }}>
                    <defs><linearGradient id="customersAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ACCENT} stopOpacity={0.3} /><stop offset="95%" stopColor={ACCENT} stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} allowDecimals={false} /><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={2} fill="url(#customersAreaFill)" />
                  </AreaChart>
                </ChartContainer>
              ) : (<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>)}
            </ChartCard>

            {balanceDonutData.length > 0 && (
              <ChartCard title="Balance Status" hint="Customer balance distribution">
                <ChartContainer config={balanceChartConfig} className="h-[200px] w-full">
                  <PieChart><Pie data={balanceDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">{balanceDonutData.map((entry) => (<Cell key={entry.name} fill={BALANCE_COLORS[entry.name] || NEUTRAL} />))}</Pie><ChartTooltip content={<ChartTooltipContent />} /><text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">{balanceDonutData.reduce((s, d) => s + d.value, 0)}</text><text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">Total</text></PieChart>
                </ChartContainer>
              </ChartCard>
            )}
          </div>
        </TooltipProvider>
      ) : (
        <EmptyState
          title="No customer data available"
          description="Once you have customers, analytics charts will appear here."
          action={
            <Link href="/customers">
              <Button variant="outline">Go to Customers</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
