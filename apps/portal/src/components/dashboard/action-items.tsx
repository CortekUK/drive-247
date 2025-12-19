"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

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
  const [timeRemaining, setTimeRemaining] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  // Update countdown every second
  useMemo(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const diff = nextMonth.getTime() - now.getTime();

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeRemaining({ days, hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Fetch new bookings (recently created, all statuses)
  const { data: newBookings = [] } = useQuery({
    queryKey: ["new-bookings"],
    queryFn: async () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const { data, error } = await supabase
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
  });

  // Fetch pending bookings (awaiting approval)
  const { data: pendingBookings = [] } = useQuery({
    queryKey: ["pending-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          start_date,
          total_price,
          created_at,
          customers(name),
          vehicles(reg)
        `)
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false });

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
  });

  // Fetch urgent reminders (very urgent or near)
  const { data: urgentReminders = [] } = useQuery({
    queryKey: ["urgent-reminders"],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
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

      if (error) throw error;

      return (data || []).map((reminder: any) => ({
        id: reminder.id,
        title: reminder.title,
        due_on: reminder.due_on,
        severity: reminder.severity || "info",
        vehicle_reg: undefined, // reminders don't directly link to vehicles
      })) as UrgentReminder[];
    },
  });

  // Fetch current month billing data
  const { data: currentMonthBilling } = useQuery({
    queryKey: ["current-month-billing"],
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      const todayStr = format(now, 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from("rentals")
        .select("total_price, start_date")
        .gte("start_date", monthStartStr)
        .lte("start_date", todayStr)
        .eq("status", "active");

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
  });

  const monthName = format(new Date(), 'MMMM yyyy');

  return (
    <div className="space-y-4">
      {/* Current Month Billing - Featured */}
      <Card className="shadow-card rounded-lg border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div>
              <CardTitle className="text-2xl font-bold">Current Month Billing</CardTitle>
              <CardDescription className="text-base">
                {monthName} (1st - Today)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
            {/* Big Bold Number - Net Amount */}
            <div className="flex flex-col justify-center items-center p-8 rounded-lg bg-card border-2 border-border">
              <p className={`text-base font-semibold mb-4 ${
                (currentMonthBilling?.netAmount || 0) >= 0 ? 'text-success' : 'text-destructive'
              }`}>
                {(currentMonthBilling?.netAmount || 0) >= 0 ? 'You Will Receive' : 'You Owe Platform'}
              </p>
              <p className={`text-6xl font-bold mb-4 ${
                (currentMonthBilling?.netAmount || 0) >= 0 ? 'text-success' : 'text-destructive'
              }`}>
                {(currentMonthBilling?.netAmount || 0) >= 0 ? '+' : ''}${Math.abs(currentMonthBilling?.netAmount || 0).toLocaleString()}
              </p>
              <div className="space-y-2 text-center w-full">
                <div className="flex justify-between items-center px-4 py-2 rounded bg-muted/30">
                  <span className="text-sm text-muted-foreground">Total Earnings</span>
                  <span className="text-sm font-semibold text-foreground">
                    ${(currentMonthBilling?.totalEarnings || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center px-4 py-2 rounded bg-muted/30">
                  <span className="text-sm text-muted-foreground">Platform Fee</span>
                  <span className="text-sm font-semibold text-destructive">
                    -${(currentMonthBilling?.fixedPlatformFee || 0).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border w-full">
                <p className="text-xs text-muted-foreground text-center mb-3">Time Until Billing</p>
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center p-2 rounded bg-muted/50">
                    <p className="text-2xl font-bold text-primary">{timeRemaining.days}</p>
                    <p className="text-xs text-muted-foreground">Days</p>
                  </div>
                  <div className="text-center p-2 rounded bg-muted/50">
                    <p className="text-2xl font-bold text-primary">{timeRemaining.hours}</p>
                    <p className="text-xs text-muted-foreground">Hours</p>
                  </div>
                  <div className="text-center p-2 rounded bg-muted/50">
                    <p className="text-2xl font-bold text-primary">{timeRemaining.minutes}</p>
                    <p className="text-xs text-muted-foreground">Min</p>
                  </div>
                  <div className="text-center p-2 rounded bg-muted/50">
                    <p className="text-2xl font-bold text-primary">{timeRemaining.seconds}</p>
                    <p className="text-xs text-muted-foreground">Sec</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Progress Graph */}
            <div className="relative">
              <h4 className="text-sm font-semibold text-foreground mb-4">Overall Performance - Revenue, Costs & Profit</h4>
              <div className="relative rounded-lg bg-gradient-to-br from-primary/5 to-transparent p-4 border border-primary/10">
                {currentMonthBilling?.dailyEarnings && currentMonthBilling.dailyEarnings.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={currentMonthBilling.dailyEarnings}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                          stroke="#4b5563"
                          tickFormatter={(value) => format(new Date(value), 'MMM d')}
                        />
                        <YAxis
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                          stroke="#4b5563"
                          tickFormatter={(value) => `$${value}`}
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
                          formatter={(value: number) => `$${value.toLocaleString()}`}
                        />
                        <Line
                          type="monotone"
                          dataKey="revenue"
                          stroke="#10b981"
                          strokeWidth={3}
                          name="Revenue"
                          dot={{ fill: '#10b981', strokeWidth: 2, r: 3, stroke: '#1f2937' }}
                          activeDot={{ r: 6, fill: '#10b981', stroke: '#1f2937', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="cost"
                          stroke="#ef4444"
                          strokeWidth={3}
                          name="Costs"
                          dot={{ fill: '#ef4444', strokeWidth: 2, r: 3, stroke: '#1f2937' }}
                          activeDot={{ r: 6, fill: '#ef4444', stroke: '#1f2937', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="profit"
                          stroke="#3b82f6"
                          strokeWidth={3}
                          name="Net Profit"
                          dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3, stroke: '#1f2937' }}
                          activeDot={{ r: 6, fill: '#3b82f6', stroke: '#1f2937', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    {/* Legend */}
                    <div className="mt-4 flex items-center justify-center gap-6 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-success"></div>
                        <span className="text-muted-foreground">Revenue</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-destructive"></div>
                        <span className="text-muted-foreground">Costs</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-muted-foreground">Net Profit</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={[
                        { date: '2025-12-01', revenue: 100, cost: 50, profit: 50 },
                        { date: '2025-12-05', revenue: 250, cost: 125, profit: 125 },
                        { date: '2025-12-10', revenue: 450, cost: 225, profit: 225 },
                        { date: '2025-12-15', revenue: 700, cost: 350, profit: 350 },
                      ]}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                          stroke="#4b5563"
                          tickFormatter={(value) => format(new Date(value), 'MMM d')}
                        />
                        <YAxis
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                          stroke="#4b5563"
                          tickFormatter={(value) => `$${value}`}
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
                          formatter={(value: number) => `$${value.toLocaleString()}`}
                        />
                        <Line
                          type="monotone"
                          dataKey="revenue"
                          stroke="#10b981"
                          strokeWidth={3}
                          name="Revenue"
                          dot={{ fill: '#10b981', strokeWidth: 2, r: 3, stroke: '#1f2937' }}
                          activeDot={{ r: 6, fill: '#10b981', stroke: '#1f2937', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="cost"
                          stroke="#ef4444"
                          strokeWidth={3}
                          name="Costs"
                          dot={{ fill: '#ef4444', strokeWidth: 2, r: 3, stroke: '#1f2937' }}
                          activeDot={{ r: 6, fill: '#ef4444', stroke: '#1f2937', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="profit"
                          stroke="#3b82f6"
                          strokeWidth={3}
                          name="Net Profit"
                          dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3, stroke: '#1f2937' }}
                          activeDot={{ r: 6, fill: '#3b82f6', stroke: '#1f2937', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    {/* Legend */}
                    <div className="mt-4 flex items-center justify-center gap-6 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-success"></div>
                        <span className="text-muted-foreground">Revenue</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-destructive"></div>
                        <span className="text-muted-foreground">Costs</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-muted-foreground">Net Profit</span>
                      </div>
                    </div>
                    {/* Sample Data Badge */}
                    <div className="absolute top-2 right-2 px-2 py-1 bg-warning/20 border border-warning/40 rounded text-xs text-warning">
                      Sample Data
                    </div>
                  </>
                )}
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
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="new" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  New Bookings
                  <Badge variant="secondary" className="ml-1">{newBookings.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="pending" className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Pending Approval
                  <Badge variant="destructive" className="ml-1">{pendingBookings.length}</Badge>
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
