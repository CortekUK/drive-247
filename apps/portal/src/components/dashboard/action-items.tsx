"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTenant } from "@/contexts/TenantContext";
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
<<<<<<< HEAD
      {/* Current Month Billing - Featured */}
      <Card className="shadow-lg rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background overflow-hidden">
        <CardHeader className="pb-4 bg-gradient-to-r from-primary/10 to-transparent">
=======
      {/* Current Month Billing - Featured */}
      <Card className="shadow-lg rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background overflow-hidden">
        <CardHeader className="pb-4 bg-gradient-to-r from-primary/10 to-transparent">
>>>>>>> b7fb88f (UI for mobile mode fixed for booking and portal)
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
<<<<<<< HEAD
        <CardContent className="p-4 sm:p-6">
          <div>
            {/* Progress Graph - Responsive */}
            <div className="relative">
              <h4 className="text-xs sm:text-sm font-semibold text-foreground mb-3 sm:mb-4">
                Revenue, Costs & Net Profit
              </h4>
              <div className="relative rounded-xl bg-gradient-to-br from-muted/30 to-background p-3 sm:p-4 border border-border/50 backdrop-blur-sm">
                {(() => {
                  const hasRealData = currentMonthBilling?.dailyEarnings && currentMonthBilling.dailyEarnings.length > 0;
                  const chartData = hasRealData ? currentMonthBilling.dailyEarnings : [
                    { date: '2025-12-01', revenue: 1200, cost: 400, profit: 800 },
                    { date: '2025-12-05', revenue: 2800, cost: 950, profit: 1850 },
                    { date: '2025-12-10', revenue: 4500, cost: 1500, profit: 3000 },
                    { date: '2025-12-15', revenue: 6200, cost: 2100, profit: 4100 },
                    { date: '2025-12-20', revenue: 8500, cost: 2800, profit: 5700 },
                  ];
                  // ...existing code...
=======
        <CardContent className="p-4 sm:p-6">
          <div>
            {/* Progress Graph - Responsive */}
            <div className="relative">
              <h4 className="text-xs sm:text-sm font-semibold text-foreground mb-3 sm:mb-4">
                Revenue, Costs & Net Profit
              </h4>
              <div className="relative rounded-xl bg-gradient-to-br from-muted/30 to-background p-3 sm:p-4 border border-border/50 backdrop-blur-sm">
                {(() => {
                  const hasRealData = currentMonthBilling?.dailyEarnings && currentMonthBilling.dailyEarnings.length > 0;
                  const chartData = hasRealData ? currentMonthBilling.dailyEarnings : [
                    { date: '2025-12-01', revenue: 1200, cost: 400, profit: 800 },
                    { date: '2025-12-05', revenue: 2800, cost: 950, profit: 1850 },
                    { date: '2025-12-10', revenue: 4500, cost: 1500, profit: 3000 },
                    { date: '2025-12-15', revenue: 6200, cost: 2100, profit: 4100 },
                    { date: '2025-12-20', revenue: 8500, cost: 2800, profit: 5700 },
                  ];
                  return (
                  <>
                    <ResponsiveContainer width="100%" height={280} className="sm:h-[320px]">
                      <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                          </linearGradient>
                          <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05}/>
                          </linearGradient>
                          <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.15} vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: '#9ca3af', fontSize: 11 }}
                          stroke="#4b5563"
                          strokeOpacity={0.3}
                          tickFormatter={(value) => format(new Date(value), 'MMM d')}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fill: '#9ca3af', fontSize: 11 }}
                          stroke="#4b5563"
                          strokeOpacity={0.3}
                          tickFormatter={(value) => `$${value}`}
                          axisLine={false}
                        />
                        <Tooltip
                          cursor={{ stroke: '#4b5563', strokeWidth: 1, strokeDasharray: '5 5' }}
                          contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '12px',
                            color: 'hsl(var(--popover-foreground))',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                            padding: '12px'
                          }}
                          labelStyle={{ color: 'hsl(var(--muted-foreground))', fontWeight: '600', marginBottom: '8px', fontSize: '12px' }}
                          itemStyle={{ color: 'hsl(var(--foreground))', fontSize: '12px', padding: '4px 0' }}
                          labelFormatter={(value) => format(new Date(value), 'MMM d, yyyy')}
                          formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                        />
                        <Line
                          type="monotone"
                          dataKey="revenue"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          name="Revenue"
                          dot={{ fill: '#10b981', strokeWidth: 2, r: 4, stroke: 'hsl(var(--background))' }}
                          activeDot={{ r: 6, fill: '#10b981', stroke: 'hsl(var(--background))', strokeWidth: 3 }}
                          fill="url(#colorRevenue)"
                        />
                        <Line
                          type="monotone"
                          dataKey="cost"
                          stroke="#ef4444"
                          strokeWidth={2.5}
                          name="Costs"
                          dot={{ fill: '#ef4444', strokeWidth: 2, r: 4, stroke: 'hsl(var(--background))' }}
                          activeDot={{ r: 6, fill: '#ef4444', stroke: 'hsl(var(--background))', strokeWidth: 3 }}
                          fill="url(#colorCost)"
                        />
                        <Line
                          type="monotone"
                          dataKey="profit"
                          stroke="#3b82f6"
                          strokeWidth={2.5}
                          name="Net Profit"
                          dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4, stroke: 'hsl(var(--background))' }}
                          activeDot={{ r: 6, fill: '#3b82f6', stroke: 'hsl(var(--background))', strokeWidth: 3 }}
                          fill="url(#colorProfit)"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    {/* Legend - Responsive */}
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-success shadow-sm"></div>
                        <span className="text-muted-foreground font-medium">Revenue</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-destructive shadow-sm"></div>
                        <span className="text-muted-foreground font-medium">Costs</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm"></div>
                        <span className="text-muted-foreground font-medium">Net Profit</span>
                      </div>
                    </div>
                  </>
                  );
                })()}
>>>>>>> b7fb88f (UI for mobile mode fixed for booking and portal)
              </div>
              <p className="text-2xl font-bold text-green-500">
                ${(performanceData?.totalRevenue || 0).toLocaleString()}
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
                ${(performanceData?.totalExpenses || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Net Profit</span>
                <DollarSign className="h-4 w-4 text-blue-500" />
              </div>
              <p className={`text-2xl font-bold ${(performanceData?.netProfit || 0) >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
                ${(performanceData?.netProfit || 0).toLocaleString()}
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
                        tickFormatter={(value) => `$${value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}`}
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
                        formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
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

      {/* Action Items Row */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
<<<<<<< HEAD
=======

      {/* Action Items Row */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Bookings Section with Tabs */}
        <Card className="shadow-card rounded-lg">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold">Bookings</CardTitle>
            <CardDescription>Manage new and pending bookings</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="new" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4 h-auto">
                <TabsTrigger value="new" className="flex items-center gap-1 justify-center py-2.5 px-2 whitespace-nowrap overflow-hidden">
                  <Clock className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden md:inline text-sm">New Bookings</span>
                  <span className="md:hidden text-sm">New</span>
                  <Badge variant="secondary" className="ml-1 flex-shrink-0 text-xs">{newBookings.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="pending" className="flex items-center gap-1 justify-center py-2.5 px-2 whitespace-nowrap overflow-hidden">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden md:inline text-sm">Pending Approval</span>
                  <span className="md:hidden text-sm">Pending</span>
                  <Badge variant="destructive" className="ml-1 flex-shrink-0 text-xs">{pendingBookings.length}</Badge>
                </TabsTrigger>
              </TabsList>

              {/* New Bookings Tab */}
              <TabsContent value="new" className="mt-0">
                <div className="h-[400px] overflow-y-auto pr-2 space-y-3">
                  {newBookings.length === 0 ? (
                    <div className="text-center py-12 text-sm text-muted-foreground">
                      No new bookings in the last 3 days
                    </div>
                  ) : (
                    newBookings.map((booking: any) => (
                      <div
                        key={booking.id}
                        className="p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/rentals/${booking.id}`)}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-sm font-medium truncate">{booking.customer_name}</p>
                          <Badge variant={
                            booking.status === 'active' ? 'default' :
                            booking.status === 'pending_approval' ? 'destructive' :
                            'secondary'
                          } className="text-xs">
                            {booking.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                          <span>{booking.vehicle_reg}</span>
                          <span className="font-semibold text-primary">
                            ${booking.total_amount.toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Created {format(new Date(booking.created_at), 'MMM d, h:mm a')}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Pending Approval Tab */}
              <TabsContent value="pending" className="mt-0">
                <div className="h-[400px] overflow-y-auto pr-2 space-y-3">
                  {pendingBookings.length === 0 ? (
                    <div className="text-center py-12 text-sm text-muted-foreground">
                      No pending approvals
                    </div>
                  ) : (
                    pendingBookings.map((booking) => (
                      <div
                        key={booking.id}
                        className="p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/pending-bookings`)}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <p className="text-sm font-medium truncate">{booking.customer_name}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                            {format(new Date(booking.created_at), 'MMM d')}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <span>{booking.vehicle_reg}</span>
                          <span className="font-semibold text-primary">
                            ${booking.total_amount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {pendingBookings.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-3"
                    onClick={() => router.push('/pending-bookings')}
                  >
                    View All Pending
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Reminders Section */}
        <Card className="shadow-card rounded-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Bell className="h-5 w-5 text-warning" />
                  Urgent Reminders
                </CardTitle>
                <CardDescription>Very urgent or near</CardDescription>
              </div>
              <Badge variant="outline" className="h-6 border-warning text-warning">
                {urgentReminders.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[400px] overflow-y-auto pr-2 space-y-3">
              {urgentReminders.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  No urgent reminders
                </div>
              ) : (
                urgentReminders.map((reminder) => (
                  <div
                    key={reminder.id}
                    className="p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/reminders`)}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <p className="text-sm font-medium truncate flex-1">{reminder.title}</p>
                      <AlertCircle className={`h-4 w-4 ml-2 shrink-0 ${
                        reminder.severity === 'critical' ? 'text-destructive' :
                        reminder.severity === 'warning' ? 'text-warning' :
                        'text-muted-foreground'
                      }`} />
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{reminder.vehicle_reg || 'General'}</span>
                      <span className="font-medium">
                        Due {format(new Date(reminder.due_on), 'MMM d')}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            {urgentReminders.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-3"
                onClick={() => router.push('/reminders')}
              >
                View All Reminders
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
>>>>>>> b7fb88f (UI for mobile mode fixed for booking and portal)
    </div>
  );
};
