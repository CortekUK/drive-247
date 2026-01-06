"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { useTenant } from "@/contexts/TenantContext";

interface PendingBooking {
  id: string;
  customer_name: string;
  vehicle_reg: string;
  start_date: string;
  total_amount: number;
  created_at: string;
}

interface UrgentReminder {
  id: string;
  title: string;
  due_on: string;
  severity: string;
  vehicle_reg?: string;
}

interface CurrentMonthBilling {
  totalEarnings: number;
  fixedPlatformFee: number;
  netAmount: number;
  dailyEarnings: { date: string; amount: number }[];
  daysUntilBilling: number;
}

export const ActionItems = () => {
  const router = useRouter();
  const { tenant } = useTenant();

  // Fetch new bookings (recently created, all statuses)
  const { data: newBookings = [] } = useQuery({
    queryKey: ["new-bookings", tenant?.id],
    queryFn: async () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      let query = supabase
        .from("rentals")
        .select(`
          id,
          start_date,
          total_price,
          created_at,
          status,
          customers(name),
          vehicles(reg)
        `)
        .gte("created_at", threeDaysAgo.toISOString())
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((booking: any) => ({
        id: booking.id,
        customer_name: booking.customers?.name || "Unknown",
        vehicle_reg: booking.vehicles?.reg || "N/A",
        start_date: booking.start_date,
        total_amount: Number(booking.total_price || 0),
        created_at: booking.created_at,
        status: booking.status,
      }));
    },
    enabled: !!tenant,
  });

  // Fetch pending bookings (awaiting approval)
  const { data: pendingBookings = [] } = useQuery({
    queryKey: ["pending-bookings", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("rentals")
        .select(`
          id,
          start_date,
          total_price,
          created_at,
          customers(name),
          vehicles(reg)
        `)
        .eq("status", "Pending")
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((booking: any) => ({
        id: booking.id,
        customer_name: booking.customers?.name || "Unknown",
        vehicle_reg: booking.vehicles?.reg || "N/A",
        start_date: booking.start_date,
        total_amount: Number(booking.total_price || 0),
        created_at: booking.created_at,
      })) as PendingBooking[];
    },
    enabled: !!tenant,
  });

  // Fetch urgent reminders (very urgent or near)
  const { data: urgentReminders = [] } = useQuery({
    queryKey: ["urgent-reminders", tenant?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];

      let query = supabase
        .from("reminders")
        .select(`
          id,
          title,
          due_on,
          severity,
          object_id
        `)
        .in("status", ["pending", "sent", "snoozed"])
        .gte("due_on", today)
        .order("due_on", { ascending: true })
        .limit(10);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((reminder: any) => ({
        id: reminder.id,
        title: reminder.title,
        due_on: reminder.due_on,
        severity: reminder.severity || "info",
        vehicle_reg: undefined, // reminders don't directly link to vehicles
      })) as UrgentReminder[];
    },
    enabled: !!tenant,
  });

  // Fetch current month billing data
  const { data: currentMonthBilling } = useQuery({
    queryKey: ["current-month-billing", tenant?.id],
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      const todayStr = format(now, 'yyyy-MM-dd');

      let query = supabase
        .from("rentals")
        .select("total_price, start_date")
        .gte("start_date", monthStartStr)
        .lte("start_date", todayStr)
        .eq("status", "Active");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Calculate total earnings
      const totalEarnings = (data || []).reduce((sum, rental) => sum + Number(rental.total_price || 0), 0);

      // Fixed platform fee (TODO: fetch from super admin settings)
      const fixedPlatformFee = 500;

      // Net amount (positive = getting paid, negative = owing platform)
      const netAmount = totalEarnings - fixedPlatformFee;

      // Generate daily earnings breakdown with cumulative totals
      const dailyEarningsMap: Record<string, number> = {};
      (data || []).forEach((rental) => {
        const dateKey = rental.start_date;
        dailyEarningsMap[dateKey] = (dailyEarningsMap[dateKey] || 0) + Number(rental.total_price || 0);
      });

      const sortedDailyData = Object.entries(dailyEarningsMap)
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Calculate cumulative values
      let cumulativeRevenue = 0;
      const dailyEarnings = sortedDailyData.map((day) => {
        cumulativeRevenue += day.amount;
        const cumulativeCost = (cumulativeRevenue / totalEarnings) * fixedPlatformFee;
        const cumulativeProfit = cumulativeRevenue - cumulativeCost;

        return {
          date: day.date,
          amount: day.amount,
          revenue: Math.round(cumulativeRevenue),
          cost: Math.round(cumulativeCost),
          profit: Math.round(cumulativeProfit),
        };
      });

      // Calculate days until next billing (1st of next month)
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const daysUntilBilling = Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return {
        totalEarnings: Math.round(totalEarnings),
        fixedPlatformFee,
        netAmount: Math.round(netAmount),
        dailyEarnings,
        daysUntilBilling,
      } as CurrentMonthBilling;
    },
    enabled: !!tenant,
  });

  const monthName = format(new Date(), 'MMMM yyyy');

  return (
    <div className="space-y-4">
      {/* Current Month Billing - Featured */}
      <Card className="shadow-lg rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background overflow-hidden">
        <CardHeader className="pb-4 bg-gradient-to-r from-primary/10 to-transparent">
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
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
    </div>
  );
};
