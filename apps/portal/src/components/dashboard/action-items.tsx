"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, PieChart, Pie, Cell, CartesianGrid, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTenant } from "@/contexts/TenantContext";
import { useDashboardKPIs } from "@/hooks/use-dashboard-kpis";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";
import { TrendingUp, TrendingDown, DollarSign, Loader2, Info } from "lucide-react";

// --- Types ---

interface PerformanceData {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  revenueChange: number;
  expenseChange: number;
  dailyRevenueData: { date: string; day: string; revenue: number }[];
  dailyProfitData: { date: string; day: string; revenue: number; expenses: number; profit: number }[];
  expenseByCategory: { category: string; amount: number; fill: string }[];
}

// --- Chart configs ---

const revenueChartConfig = {
  revenue: { label: "Revenue", color: "#10b981" },
} satisfies ChartConfig;

const EXPENSE_COLORS: Record<string, string> = {
  Repair: "#ef4444",
  Service: "#3b82f6",
  Tyres: "#f59e0b",
  Valet: "#8b5cf6",
  Accessory: "#06b6d4",
  Fines: "#f43f5e",
  Acquisition: "#d97706",
  Finance: "#8b5cf6",
  Other: "#6b7280",
};

const profitChartConfig = {
  revenue: { label: "Revenue", color: "#10b981" },
  expenses: { label: "Expenses", color: "#ef4444" },
  profit: { label: "Profit", color: "#6366f1" },
} satisfies ChartConfig;

const fleetChartConfig = {
  rented: { label: "Rented", color: "hsl(var(--primary))" },
  available: { label: "Available", color: "#22c55e" },
  other: { label: "Other", color: "#9ca3af" },
} satisfies ChartConfig;

// --- Component ---

export const ActionItems = () => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || "GBP";
  const currencySymbol = getCurrencySymbol(currencyCode);

  // Fleet utilization from existing KPIs hook
  const { data: kpis } = useDashboardKPIs();

  // Fetch performance data
  const { data: performanceData, isLoading } = useQuery({
    queryKey: ["dashboard-performance", tenant?.id],
    queryFn: async (): Promise<PerformanceData> => {
      const now = new Date();
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);
      const monthStartStr = format(monthStart, "yyyy-MM-dd");
      const monthEndStr = format(monthEnd, "yyyy-MM-dd");

      const prevMonthStart = startOfMonth(subMonths(now, 1));
      const prevMonthEnd = endOfMonth(subMonths(now, 1));
      const prevMonthStartStr = format(prevMonthStart, "yyyy-MM-dd");
      const prevMonthEndStr = format(prevMonthEnd, "yyyy-MM-dd");

      // Current month payments
      let paymentsQuery = supabase
        .from("payments")
        .select("amount, payment_date, verification_status")
        .gte("payment_date", monthStartStr)
        .lte("payment_date", monthEndStr)
        .or("verification_status.eq.approved,verification_status.eq.auto_approved,verification_status.is.null");
      if (tenant?.id) paymentsQuery = paymentsQuery.eq("tenant_id", tenant.id);

      // Current month vehicle expenses WITH category
      let expensesQuery = supabase
        .from("vehicle_expenses")
        .select("amount, expense_date, category")
        .gte("expense_date", monthStartStr)
        .lte("expense_date", monthEndStr);
      if (tenant?.id) expensesQuery = expensesQuery.eq("tenant_id", tenant.id);

      // Current month service records
      let servicesQuery = supabase
        .from("service_records")
        .select("cost, service_date")
        .gte("service_date", monthStartStr)
        .lte("service_date", monthEndStr);
      if (tenant?.id) servicesQuery = servicesQuery.eq("tenant_id", tenant.id);

      // Previous month for comparison
      let prevPaymentsQuery = supabase
        .from("payments")
        .select("amount")
        .gte("payment_date", prevMonthStartStr)
        .lte("payment_date", prevMonthEndStr)
        .or("verification_status.eq.approved,verification_status.eq.auto_approved,verification_status.is.null");
      if (tenant?.id) prevPaymentsQuery = prevPaymentsQuery.eq("tenant_id", tenant.id);

      let prevExpensesQuery = supabase
        .from("vehicle_expenses")
        .select("amount")
        .gte("expense_date", prevMonthStartStr)
        .lte("expense_date", prevMonthEndStr);
      if (tenant?.id) prevExpensesQuery = prevExpensesQuery.eq("tenant_id", tenant.id);

      let prevServicesQuery = supabase
        .from("service_records")
        .select("cost")
        .gte("service_date", prevMonthStartStr)
        .lte("service_date", prevMonthEndStr);
      if (tenant?.id) prevServicesQuery = prevServicesQuery.eq("tenant_id", tenant.id);

      // P&L entries for richer cost breakdown (Service, Fines, Acquisition, etc.)
      let pnlCostQuery = supabase
        .from("pnl_entries")
        .select("amount, category")
        .eq("side", "Cost")
        .gte("entry_date", monthStartStr)
        .lte("entry_date", monthEndStr);
      if (tenant?.id) pnlCostQuery = pnlCostQuery.eq("tenant_id", tenant.id);

      const [paymentsRes, expensesRes, servicesRes, prevPaymentsRes, prevExpensesRes, prevServicesRes, pnlCostRes] =
        await Promise.all([
          paymentsQuery,
          expensesQuery,
          servicesQuery,
          prevPaymentsQuery,
          prevExpensesQuery,
          prevServicesQuery,
          pnlCostQuery,
        ]);

      const payments = paymentsRes.data || [];
      const expenses = expensesRes.data || [];
      const services = servicesRes.data || [];
      const prevPayments = prevPaymentsRes.data || [];
      const prevExpenses = prevExpensesRes.data || [];
      const prevServices = prevServicesRes.data || [];

      // Totals
      const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const vehicleExpenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const serviceRecordTotal = services.reduce((sum, s) => sum + Number(s.cost || 0), 0);
      const totalExpenses = vehicleExpenseTotal + serviceRecordTotal;
      const netProfit = totalRevenue - totalExpenses;

      const prevTotalRevenue = prevPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const prevTotalExpenses =
        prevExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0) +
        prevServices.reduce((sum, s) => sum + Number(s.cost || 0), 0);

      const revenueChange =
        prevTotalRevenue > 0 ? Math.round(((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100) : 0;
      const expenseChange =
        prevTotalExpenses > 0 ? Math.round(((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100) : 0;

      // --- Daily revenue data (non-cumulative) ---
      const dailyRevenue: Record<string, number> = {};
      payments.forEach((p: any) => {
        const date = p.payment_date?.split("T")[0];
        if (date) dailyRevenue[date] = (dailyRevenue[date] || 0) + Number(p.amount || 0);
      });

      const allDates = eachDayOfInterval({ start: monthStart, end: now > monthEnd ? monthEnd : now });
      const dailyRevenueData = allDates.map((date) => {
        const dateStr = format(date, "yyyy-MM-dd");
        return {
          date: dateStr,
          day: format(date, "d"),
          revenue: Math.round(dailyRevenue[dateStr] || 0),
        };
      });

      // --- Daily expense data for profit margin chart ---
      const dailyExpense: Record<string, number> = {};
      expenses.forEach((e: any) => {
        const date = e.expense_date?.split("T")[0];
        if (date) dailyExpense[date] = (dailyExpense[date] || 0) + Number(e.amount || 0);
      });
      services.forEach((s: any) => {
        const date = s.service_date?.split("T")[0];
        if (date) dailyExpense[date] = (dailyExpense[date] || 0) + Number(s.cost || 0);
      });

      const dailyProfitData = allDates.map((date) => {
        const dateStr = format(date, "yyyy-MM-dd");
        const rev = Math.round(dailyRevenue[dateStr] || 0);
        const exp = Math.round(dailyExpense[dateStr] || 0);
        return {
          date: dateStr,
          day: format(date, "d"),
          revenue: rev,
          expenses: exp,
          profit: rev - exp,
        };
      });

      // --- Expense breakdown by category ---
      // Use P&L entries for richer multi-category breakdown (Service, Fines, Acquisition, etc.)
      const pnlCosts = pnlCostRes.data || [];
      const categoryTotals: Record<string, number> = {};

      if (pnlCosts.length > 0) {
        // P&L entries have proper categories from pnl_entries table
        pnlCosts.forEach((entry: any) => {
          const cat = entry.category || "Other";
          categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(entry.amount || 0);
        });
      } else {
        // Fallback to vehicle_expenses + service_records
        expenses.forEach((e: any) => {
          const cat = e.category || "Other";
          categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(e.amount || 0);
        });
        if (serviceRecordTotal > 0) {
          categoryTotals["Service"] = (categoryTotals["Service"] || 0) + serviceRecordTotal;
        }
      }

      const expenseByCategory = Object.entries(categoryTotals)
        .filter(([, amount]) => amount > 0)
        .map(([category, amount]) => ({
          category,
          amount: Math.round(amount),
          fill: EXPENSE_COLORS[category] || EXPENSE_COLORS.Other,
        }))
        .sort((a, b) => b.amount - a.amount);

      return {
        totalRevenue: Math.round(totalRevenue),
        totalExpenses: Math.round(totalExpenses),
        netProfit: Math.round(netProfit),
        revenueChange,
        expenseChange,
        dailyRevenueData,
        dailyProfitData,
        expenseByCategory,
      };
    },
    enabled: !!tenant,
  });

  const monthName = format(new Date(), "MMMM yyyy");
  const hasData = performanceData && (performanceData.totalRevenue > 0 || performanceData.totalExpenses > 0);
  const revenueIsGood = (performanceData?.revenueChange ?? 0) >= 0;
  const expenseIsGood = (performanceData?.expenseChange ?? 0) <= 0;

  // Fleet utilization data for pie chart
  const fleet = kpis?.fleetUtilization;
  const fleetOther = fleet ? Math.max(0, fleet.total - fleet.rented - fleet.available) : 0;
  const fleetPieData = fleet
    ? [
        { name: "Rented", value: fleet.rented, fill: "hsl(var(--primary))" },
        { name: "Available", value: fleet.available, fill: "#22c55e" },
        ...(fleetOther > 0 ? [{ name: "Other", value: fleetOther, fill: "#9ca3af" }] : []),
      ].filter((d) => d.value > 0)
    : [];

  // Build expense donut config dynamically
  const expenseChartConfig: ChartConfig = Object.fromEntries(
    (performanceData?.expenseByCategory || []).map((item) => [
      item.category,
      { label: item.category, color: item.fill },
    ])
  );

  return (
    <div className="space-y-4">
      <Card className="shadow-card rounded-lg border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Performance Overview
              </CardTitle>
              <CardDescription className="text-sm sm:text-base">{monthName}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div
              className={`p-4 rounded-lg ${revenueIsGood ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Revenue</span>
                {performanceData?.revenueChange !== 0 && (
                  <Badge
                    variant="outline"
                    className={
                      (performanceData?.revenueChange ?? 0) > 0
                        ? "text-green-500 border-green-500/30"
                        : "text-red-500 border-red-500/30"
                    }
                  >
                    {(performanceData?.revenueChange ?? 0) > 0 ? (
                      <TrendingUp className="h-3 w-3 mr-1" />
                    ) : (
                      <TrendingDown className="h-3 w-3 mr-1" />
                    )}
                    {Math.abs(performanceData?.revenueChange || 0)}%
                  </Badge>
                )}
              </div>
              <p className={`text-2xl font-bold ${revenueIsGood ? "text-green-500" : "text-red-500"}`}>
                {formatCurrency(performanceData?.totalRevenue || 0, currencyCode)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${expenseIsGood ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Expenses</span>
                {performanceData?.expenseChange !== 0 && (
                  <Badge
                    variant="outline"
                    className={
                      (performanceData?.expenseChange ?? 0) < 0
                        ? "text-green-500 border-green-500/30"
                        : "text-red-500 border-red-500/30"
                    }
                  >
                    {(performanceData?.expenseChange ?? 0) > 0 ? (
                      <TrendingUp className="h-3 w-3 mr-1" />
                    ) : (
                      <TrendingDown className="h-3 w-3 mr-1" />
                    )}
                    {Math.abs(performanceData?.expenseChange || 0)}%
                  </Badge>
                )}
              </div>
              <p className={`text-2xl font-bold ${expenseIsGood ? "text-green-500" : "text-red-500"}`}>
                {formatCurrency(performanceData?.totalExpenses || 0, currencyCode)}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Net Profit</span>
                <DollarSign className="h-4 w-4 text-blue-500" />
              </div>
              <p
                className={`text-2xl font-bold ${(performanceData?.netProfit || 0) >= 0 ? "text-blue-500" : "text-red-500"}`}
              >
                {formatCurrency(performanceData?.netProfit || 0, currencyCode)}
              </p>
            </div>
          </div>

          {/* Charts */}
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !hasData ? (
            <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
              <DollarSign className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No Data Yet</p>
              <p className="text-sm">Revenue and expenses will appear here as transactions are recorded</p>
            </div>
          ) : (
            <TooltipProvider>
              {/* Chart 1: Daily Revenue Bar Chart */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                  Daily Revenue
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p>Daily revenue collected from payments this month</p></TooltipContent>
                  </Tooltip>
                </h4>
                <ChartContainer
                  config={revenueChartConfig}
                  className="aspect-[4/1] w-full"
                >
                  <BarChart
                    data={performanceData?.dailyRevenueData || []}
                    barSize={
                      performanceData?.dailyRevenueData && performanceData.dailyRevenueData.length > 20 ? 8 : 14
                    }
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(value) =>
                        value >= 1000
                          ? `${currencySymbol}${(value / 1000).toFixed(0)}k`
                          : `${currencySymbol}${value}`
                      }
                      width={50}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_: any, payload: any) => {
                            if (payload?.[0]?.payload?.date) {
                              return format(new Date(payload[0].payload.date), "MMM d, yyyy");
                            }
                            return "";
                          }}
                          valueFormatter={(value) => formatCurrency(value, currencyCode)}
                        />
                      }
                    />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>

              {/* Chart 2: Revenue vs Expenses Area Chart */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                  Revenue vs Expenses
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p>Comparison of daily revenue against expenses for the current month</p></TooltipContent>
                  </Tooltip>
                </h4>
                <ChartContainer
                  config={profitChartConfig}
                  className="aspect-[4/1] w-full"
                >
                  <AreaChart
                    data={performanceData?.dailyProfitData || []}
                  >
                    <defs>
                      <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="fillExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(value) =>
                        value >= 1000
                          ? `${currencySymbol}${(value / 1000).toFixed(0)}k`
                          : `${currencySymbol}${value}`
                      }
                      width={50}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_: any, payload: any) => {
                            if (payload?.[0]?.payload?.date) {
                              return format(new Date(payload[0].payload.date), "MMM d, yyyy");
                            }
                            return "";
                          }}
                          valueFormatter={(value) => formatCurrency(value, currencyCode)}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#fillRevenue)"
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      stroke="#ef4444"
                      strokeWidth={2}
                      fill="url(#fillExpenses)"
                    />
                  </AreaChart>
                </ChartContainer>
                <div className="flex items-center justify-center gap-4 mt-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#10b981" }} />
                    <span className="text-muted-foreground">Revenue</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#ef4444" }} />
                    <span className="text-muted-foreground">Expenses</span>
                  </div>
                </div>
              </div>

              {/* Chart 3 + 4: Expense Breakdown + Fleet Utilization */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Chart 3: Expense Breakdown Radar */}
                <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                    Expense Breakdown
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent><p>Distribution of expenses across maintenance categories</p></TooltipContent>
                    </Tooltip>
                  </h4>
                  {performanceData?.expenseByCategory && performanceData.expenseByCategory.length > 0 ? (
                    <ChartContainer config={expenseChartConfig} className="aspect-square max-h-[250px] mx-auto">
                      <PieChart>
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              valueFormatter={(value) => formatCurrency(value, currencyCode)}
                              nameKey="category"
                            />
                          }
                        />
                        <Pie
                          data={performanceData.expenseByCategory}
                          dataKey="amount"
                          nameKey="category"
                          innerRadius="55%"
                          outerRadius="85%"
                          strokeWidth={2}
                          stroke="hsl(var(--background))"
                        >
                          {performanceData.expenseByCategory.map((entry) => (
                            <Cell key={entry.category} fill={entry.fill} />
                          ))}
                        </Pie>
                        <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-xl font-bold">
                          {formatCurrency(performanceData.totalExpenses, currencyCode)}
                        </text>
                        <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">
                          Total
                        </text>
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <div className="aspect-square max-h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                      No expenses recorded
                    </div>
                  )}
                  {/* Donut legend */}
                  {performanceData?.expenseByCategory && performanceData.expenseByCategory.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-xs">
                      {performanceData.expenseByCategory.map((entry) => (
                        <div key={entry.category} className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                          <span className="text-muted-foreground">
                            {entry.category} ({formatCurrency(entry.amount, currencyCode)})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Chart 4: Fleet Utilization Pie */}
                <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                    Fleet Utilization
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                      <TooltipContent><p>Proportion of your fleet currently on rental vs available</p></TooltipContent>
                    </Tooltip>
                  </h4>
                  {fleet && fleetPieData.length > 0 ? (
                    <>
                      <ChartContainer config={fleetChartConfig} className="aspect-square max-h-[250px] mx-auto">
                        <PieChart>
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                valueFormatter={(value) => `${value} vehicles`}
                                nameKey="name"
                              />
                            }
                          />
                          <Pie
                            data={fleetPieData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="55%"
                            outerRadius="85%"
                            strokeWidth={2}
                            stroke="hsl(var(--background))"
                          >
                            {fleetPieData.map((entry) => (
                              <Cell key={entry.name} fill={entry.fill} />
                            ))}
                          </Pie>
                          {/* Center percentage */}
                          <text
                            x="50%"
                            y="44%"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="fill-foreground text-3xl font-bold"
                          >
                            {fleet.percentage}%
                          </text>
                          <text
                            x="50%"
                            y="56%"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="fill-muted-foreground text-xs"
                          >
                            Utilization
                          </text>
                        </PieChart>
                      </ChartContainer>
                      {/* Fleet stats below */}
                      <div className="flex items-center justify-center gap-4 mt-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "hsl(var(--primary))" }} />
                          <span className="text-muted-foreground">Rented ({fleet.rented})</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
                          <span className="text-muted-foreground">Available ({fleet.available})</span>
                        </div>
                        {fleetOther > 0 && (
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#9ca3af" }} />
                            <span className="text-muted-foreground">Other ({fleetOther})</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : fleet ? (
                    <div className="aspect-square max-h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                      No fleet data
                    </div>
                  ) : (
                    <div className="aspect-square max-h-[250px] flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
