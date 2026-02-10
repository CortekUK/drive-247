"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";
import { TrendingUp, TrendingDown, DollarSign, Loader2 } from "lucide-react";

interface PerformanceData {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  chartData: { date: string; revenue: number; expenses: number; profit: number }[];
  revenueChange: number;
  expenseChange: number;
}

export const ActionItems = () => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';
  const currencySymbol = getCurrencySymbol(currencyCode);

  // Fetch performance data from payments and expenses
  const { data: performanceData, isLoading } = useQuery({
    queryKey: ["dashboard-performance", tenant?.id],
    queryFn: async () => {
      const now = new Date();
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);
      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

      // Previous month for comparison
      const prevMonthStart = startOfMonth(subMonths(now, 1));
      const prevMonthEnd = endOfMonth(subMonths(now, 1));
      const prevMonthStartStr = format(prevMonthStart, 'yyyy-MM-dd');
      const prevMonthEndStr = format(prevMonthEnd, 'yyyy-MM-dd');

      // Fetch current month payments (revenue)
      // Include approved, auto_approved, and null (legacy payments without verification)
      let paymentsQuery = supabase
        .from("payments")
        .select("amount, payment_date, verification_status")
        .gte("payment_date", monthStartStr)
        .lte("payment_date", monthEndStr)
        .or("verification_status.eq.approved,verification_status.eq.auto_approved,verification_status.is.null");

      if (tenant?.id) {
        paymentsQuery = paymentsQuery.eq("tenant_id", tenant.id);
      }

      // Fetch current month vehicle expenses
      let expensesQuery = supabase
        .from("vehicle_expenses")
        .select("amount, expense_date")
        .gte("expense_date", monthStartStr)
        .lte("expense_date", monthEndStr);

      if (tenant?.id) {
        expensesQuery = expensesQuery.eq("tenant_id", tenant.id);
      }

      // Fetch current month service records (maintenance costs)
      let servicesQuery = supabase
        .from("service_records")
        .select("cost, service_date")
        .gte("service_date", monthStartStr)
        .lte("service_date", monthEndStr);

      if (tenant?.id) {
        servicesQuery = servicesQuery.eq("tenant_id", tenant.id);
      }

      // Fetch previous month payments for comparison
      let prevPaymentsQuery = supabase
        .from("payments")
        .select("amount")
        .gte("payment_date", prevMonthStartStr)
        .lte("payment_date", prevMonthEndStr)
        .or("verification_status.eq.approved,verification_status.eq.auto_approved,verification_status.is.null");

      if (tenant?.id) {
        prevPaymentsQuery = prevPaymentsQuery.eq("tenant_id", tenant.id);
      }

      // Fetch previous month expenses for comparison
      let prevExpensesQuery = supabase
        .from("vehicle_expenses")
        .select("amount")
        .gte("expense_date", prevMonthStartStr)
        .lte("expense_date", prevMonthEndStr);

      if (tenant?.id) {
        prevExpensesQuery = prevExpensesQuery.eq("tenant_id", tenant.id);
      }

      // Fetch previous month service records for comparison
      let prevServicesQuery = supabase
        .from("service_records")
        .select("cost")
        .gte("service_date", prevMonthStartStr)
        .lte("service_date", prevMonthEndStr);

      if (tenant?.id) {
        prevServicesQuery = prevServicesQuery.eq("tenant_id", tenant.id);
      }

      const [paymentsRes, expensesRes, servicesRes, prevPaymentsRes, prevExpensesRes, prevServicesRes] = await Promise.all([
        paymentsQuery,
        expensesQuery,
        servicesQuery,
        prevPaymentsQuery,
        prevExpensesQuery,
        prevServicesQuery,
      ]);

      const payments = paymentsRes.data || [];
      const expenses = expensesRes.data || [];
      const services = servicesRes.data || [];
      const prevPayments = prevPaymentsRes.data || [];
      const prevExpenses = prevExpensesRes.data || [];
      const prevServices = prevServicesRes.data || [];

      // Calculate totals (expenses = vehicle_expenses + service_records)
      const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const vehicleExpenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const serviceRecordTotal = services.reduce((sum, s) => sum + Number(s.cost || 0), 0);
      const totalExpenses = vehicleExpenseTotal + serviceRecordTotal;
      const netProfit = totalRevenue - totalExpenses;

      const prevTotalRevenue = prevPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const prevVehicleExpenseTotal = prevExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const prevServiceRecordTotal = prevServices.reduce((sum, s) => sum + Number(s.cost || 0), 0);
      const prevTotalExpenses = prevVehicleExpenseTotal + prevServiceRecordTotal;

      // Calculate percentage change
      const revenueChange = prevTotalRevenue > 0
        ? Math.round(((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100)
        : 0;
      const expenseChange = prevTotalExpenses > 0
        ? Math.round(((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100)
        : 0;

      // Build daily data map
      const dailyRevenue: Record<string, number> = {};
      const dailyExpenses: Record<string, number> = {};

      payments.forEach((p: any) => {
        const date = p.payment_date?.split('T')[0];
        if (date) {
          dailyRevenue[date] = (dailyRevenue[date] || 0) + Number(p.amount || 0);
        }
      });

      expenses.forEach((e: any) => {
        const date = e.expense_date?.split('T')[0];
        if (date) {
          dailyExpenses[date] = (dailyExpenses[date] || 0) + Number(e.amount || 0);
        }
      });

      // Add service records to daily expenses
      services.forEach((s: any) => {
        const date = s.service_date?.split('T')[0];
        if (date) {
          dailyExpenses[date] = (dailyExpenses[date] || 0) + Number(s.cost || 0);
        }
      });

      // Generate all dates in the month for a complete chart
      const allDates = eachDayOfInterval({ start: monthStart, end: now > monthEnd ? monthEnd : now });

      // Build cumulative chart data
      let cumulativeRevenue = 0;
      let cumulativeExpenses = 0;

      const chartData = allDates.map((date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        cumulativeRevenue += dailyRevenue[dateStr] || 0;
        cumulativeExpenses += dailyExpenses[dateStr] || 0;

        return {
          date: dateStr,
          revenue: Math.round(cumulativeRevenue),
          expenses: Math.round(cumulativeExpenses),
          profit: Math.round(cumulativeRevenue - cumulativeExpenses),
        };
      });

      return {
        totalRevenue: Math.round(totalRevenue),
        totalExpenses: Math.round(totalExpenses),
        netProfit: Math.round(netProfit),
        chartData,
        revenueChange,
        expenseChange,
      } as PerformanceData;
    },
    enabled: !!tenant,
  });

  const monthName = format(new Date(), 'MMMM yyyy');

  const hasData = performanceData && (performanceData.totalRevenue > 0 || performanceData.totalExpenses > 0);
  const chartData = performanceData?.chartData || [];

  return (
    <div className="space-y-4">
      {/* Performance Overview */}
      <Card className="shadow-card rounded-lg border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Performance Overview
              </CardTitle>
              <CardDescription className="text-sm sm:text-base">
                {monthName}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Revenue</span>
                {performanceData?.revenueChange !== 0 && (
                  <Badge variant="outline" className={performanceData?.revenueChange > 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}>
                    {performanceData?.revenueChange > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                    {Math.abs(performanceData?.revenueChange || 0)}%
                  </Badge>
                )}
              </div>
              <p className="text-2xl font-bold text-green-500">
                {formatCurrency(performanceData?.totalRevenue || 0, currencyCode)}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Expenses</span>
                {performanceData?.expenseChange !== 0 && (
                  <Badge variant="outline" className={performanceData?.expenseChange < 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}>
                    {performanceData?.expenseChange > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                    {Math.abs(performanceData?.expenseChange || 0)}%
                  </Badge>
                )}
              </div>
              <p className="text-2xl font-bold text-red-500">
                {formatCurrency(performanceData?.totalExpenses || 0, currencyCode)}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Net Profit</span>
                <DollarSign className="h-4 w-4 text-blue-500" />
              </div>
              <p className={`text-2xl font-bold ${(performanceData?.netProfit || 0) >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
                {formatCurrency(performanceData?.netProfit || 0, currencyCode)}
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="relative">
            <h4 className="text-sm font-semibold text-foreground mb-4">Cumulative Performance This Month</h4>
            <div className="relative rounded-lg bg-gradient-to-br from-primary/5 to-transparent p-4 border border-primary/10">
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
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        stroke="#4b5563"
                        tickFormatter={(value) => format(new Date(value), 'd')}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        stroke="#4b5563"
                        tickFormatter={(value) => `${currencySymbol}${value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}`}
                      />
                      <Tooltip
                        cursor={{ stroke: '#4b5563', strokeWidth: 1, strokeDasharray: '5 5' }}
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: '2px solid #4b5563',
                          borderRadius: '8px',
                          color: '#e5e7eb',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                        }}
                        labelStyle={{ color: '#9ca3af', fontWeight: 'bold', marginBottom: '8px' }}
                        itemStyle={{ color: '#e5e7eb' }}
                        labelFormatter={(value) => format(new Date(value), 'MMM d, yyyy')}
                        formatter={(value: number) => [formatCurrency(value, currencyCode), '']}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="#10b981"
                        strokeWidth={2}
                        name="Revenue"
                        dot={false}
                        activeDot={{ r: 5, fill: '#10b981', stroke: '#1f2937', strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="expenses"
                        stroke="#ef4444"
                        strokeWidth={2}
                        name="Expenses"
                        dot={false}
                        activeDot={{ r: 5, fill: '#ef4444', stroke: '#1f2937', strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="profit"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        name="Net Profit"
                        dot={false}
                        activeDot={{ r: 5, fill: '#3b82f6', stroke: '#1f2937', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div className="mt-4 flex items-center justify-center gap-6 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span className="text-muted-foreground">Revenue</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span className="text-muted-foreground">Expenses</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                      <span className="text-muted-foreground">Net Profit</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
