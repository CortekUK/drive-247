import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, Briefcase, Target, Users, Car } from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ReportsDataTable } from "@/components/admin/ReportsDataTable";
import { supabase } from "@/integrations/supabase/client";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { subDays, endOfDay, startOfDay } from "date-fns";

const AnalyticsDashboard = () => {
  const [dateRange, setDateRange] = useState("30");
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  // Date range pickers
  const [revenueDateRange, setRevenueDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [jobsDateRange, setJobsDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const [analyticsData, setAnalyticsData] = useState<any>({
    totalRevenue: 0,
    rentalsCompleted: 0,
    avgRentalValue: 0,
    repeatClients: 0,
    cancellationRate: 0,
    avgRating: 0,
    totalReviews: 0,
    onTimeReturnRate: 0,
    avgRentalDuration: 0,
    activePromotions: 0,
    revenueData: [],
    rentalsData: [],
    rentalTypeData: [],
    vehicleUtilisation: [],
    fleetData: [],
    topPerformingVehicles: [],
    fleetUtilisationSummary: {
      activeFleet: 0,
      idleFleet: 0,
      underMaintenance: 0,
    },
  });

  useEffect(() => {
    loadAnalyticsData();
  }, [dateRange, revenueDateRange, jobsDateRange]);

  const loadAnalyticsData = async () => {
    setLoading(true);
    try {
      const daysAgo = parseInt(dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      // Fetch ALL bookings (no time limit for KPIs)
      const { data: bookings } = await supabase
        .from("bookings")
        .select("*")
        .order("created_at", { ascending: false });

      // Calculate metrics
      const revenueBookings = bookings?.filter(b =>
        b.status === "completed" || b.status === "confirmed"
      ) || [];
      const totalRevenue = revenueBookings.reduce((sum, b) => {
        const price = parseFloat(String(b.total_price || 0));
        return sum + price;
      }, 0);

      const avgRentalValue = revenueBookings.length > 0
        ? totalRevenue / revenueBookings.length
        : 0;

      // Rentals completed
      const completedBookings = bookings?.filter(b =>
        b.status === "completed" || b.status === "confirmed"
      ) || [];

      // Calculate repeat clients
      const clientEmails = bookings?.map(b => b.customer_email) || [];
      const uniqueClients = new Set(clientEmails);
      const repeatClientsCount = clientEmails.length - uniqueClients.size;
      const repeatRate = clientEmails.length > 0
        ? (repeatClientsCount / clientEmails.length) * 100
        : 0;

      // Calculate cancellation rate
      const cancelledBookings = bookings?.filter(b => b.status === "cancelled") || [];
      const cancellationRate = bookings && bookings.length > 0
        ? (cancelledBookings.length / bookings.length) * 100
        : 0;

      // Calculate average rating from testimonials
      const { data: testimonials } = await supabase
        .from("testimonials")
        .select("rating")
        .not("rating", "is", null);

      const totalRating = testimonials?.reduce((sum, t) => sum + (t.rating || 0), 0) || 0;
      const avgRating = testimonials && testimonials.length > 0
        ? totalRating / testimonials.length
        : 0;

      // Calculate average rental duration
      const totalDays = completedBookings.reduce((sum, b) => sum + (b.rental_days || 0), 0);
      const avgRentalDuration = completedBookings.length > 0
        ? totalDays / completedBookings.length
        : 0;

      // Count active promotions
      const { count: promotionsCount } = await supabase
        .from("promotions")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true)
        .lte("start_date", new Date().toISOString())
        .gte("end_date", new Date().toISOString());

      // Group by week for revenue chart
      const revenueStartDate = startOfDay(revenueDateRange?.from || subDays(new Date(), 30));
      const revenueEndDate = endOfDay(revenueDateRange?.to || new Date());

      const { data: revenueChartBookings } = await supabase
        .from("bookings")
        .select("*")
        .gte("created_at", revenueStartDate.toISOString())
        .lte("created_at", revenueEndDate.toISOString());

      const revenueWeeklyData = new Map();
      revenueChartBookings?.forEach(booking => {
        const date = new Date(booking.created_at);
        const weekNum = Math.floor((revenueEndDate.getTime() - date.getTime()) / (7 * 24 * 60 * 60 * 1000));
        const daysDiff = Math.floor((revenueEndDate.getTime() - revenueStartDate.getTime()) / (24 * 60 * 60 * 1000));
        const weekKey = `Week ${Math.max(0, Math.floor(daysDiff / 7) - weekNum)}`;

        if (!revenueWeeklyData.has(weekKey)) {
          revenueWeeklyData.set(weekKey, { revenue: 0 });
        }

        const week = revenueWeeklyData.get(weekKey);
        // Count completed and confirmed bookings as revenue
        if (booking.status === "completed" || booking.status === "confirmed") {
          week.revenue += parseFloat(String(booking.total_price || 0));
        }
      });

      const revenueData = Array.from(revenueWeeklyData.entries())
        .map(([period, data]) => ({ period, revenue: data.revenue }))
        .sort((a, b) => parseInt(a.period.split(' ')[1]) - parseInt(b.period.split(' ')[1]));

      // Group by week for jobs chart
      const jobsStartDate = startOfDay(jobsDateRange?.from || subDays(new Date(), 30));
      const jobsEndDate = endOfDay(jobsDateRange?.to || new Date());

      const { data: jobsBookings } = await supabase
        .from("bookings")
        .select("*")
        .gte("created_at", jobsStartDate.toISOString())
        .lte("created_at", jobsEndDate.toISOString());

      const jobsWeeklyData = new Map();
      jobsBookings?.forEach(booking => {
        const date = new Date(booking.created_at);
        const weekNum = Math.floor((jobsEndDate.getTime() - date.getTime()) / (7 * 24 * 60 * 60 * 1000));
        const daysDiff = Math.floor((jobsEndDate.getTime() - jobsStartDate.getTime()) / (24 * 60 * 60 * 1000));
        const weekKey = `Week ${Math.max(0, Math.floor(daysDiff / 7) - weekNum)}`;

        if (!jobsWeeklyData.has(weekKey)) {
          jobsWeeklyData.set(weekKey, { jobs: 0 });
        }

        const week = jobsWeeklyData.get(weekKey);
        week.jobs++;
      });

      const rentalsData = Array.from(jobsWeeklyData.entries())
        .map(([period, data]) => ({ period, rentals: data.jobs }))
        .sort((a, b) => parseInt(a.period.split(' ')[1]) - parseInt(b.period.split(' ')[1]));

      // Rental type breakdown (by vehicle category)
      const { data: vehicleCategories } = await supabase
        .from("vehicles")
        .select("id, category");
      
      const categoryCount = bookings?.reduce((acc: any, b) => {
        const vehicle = vehicleCategories?.find(v => v.id === b.vehicle_id);
        const category = vehicle?.category || "Other";
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {});

      const totalRentals = bookings?.length || 1;
      const rentalTypeData = Object.entries(categoryCount || {}).map(([name, count]: any, index) => ({
        name,
        value: Math.round((count / totalRentals) * 100),
        color: `hsl(45, ${100 - index * 20}%, ${60 - index * 10}%)`
      }));

      // Fetch completed rentals with vehicle data
      const { data: completedRentalsWithVehicles } = await supabase
        .from("bookings")
        .select("*, vehicles(name)")
        .in("status", ["completed", "confirmed"]);

      // Group by vehicle and calculate rental days
      const vehicleUtilisationMap = new Map<string, { days: number; rentals: number }>();

      completedRentalsWithVehicles?.forEach((booking: any) => {
        const vehicleName = booking.vehicles?.name || "Unassigned";
        const rentalDays = booking.rental_days || 1;

        const current = vehicleUtilisationMap.get(vehicleName) || { days: 0, rentals: 0 };
        vehicleUtilisationMap.set(vehicleName, {
          days: current.days + rentalDays,
          rentals: current.rentals + 1
        });
      });

      const vehicleUtilisation = Array.from(vehicleUtilisationMap.entries())
        .map(([name, data]) => ({
          name,
          days: data.days,
          rentals: data.rentals,
          utilisation: 0
        }))
        .filter(v => v.days > 0)
        .sort((a, b) => b.days - a.days)
        .slice(0, 5);

      // Fetch vehicles with rental counts
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("*")
        .limit(5);

      // Calculate fleet data with revenue
      const fleetData = await Promise.all((vehicles || []).map(async (vehicle) => {
        const { data: vehicleRentals, count } = await supabase
          .from("bookings")
          .select("rental_days, total_price, status")
          .eq("vehicle_id", vehicle.id)
          .gte("created_at", startDate.toISOString());

        const totalDays = (vehicleRentals || []).reduce((sum, rental) => {
          return sum + (rental.rental_days || 0);
        }, 0);

        const revenue = (vehicleRentals || [])
          .filter(r => r.status === "completed" || r.status === "confirmed")
          .reduce((sum, rental) => sum + parseFloat(String(rental.total_price || 0)), 0);

        return {
          vehicle: vehicle.name,
          rentals: count || 0,
          mileage: totalDays > 0 ? `${totalDays * 150}` : "0", // Estimate: 150 miles per day
          revenue: revenue,
          status: vehicle.is_active ? "Active" : "Inactive"
        };
      }));

      // Top performing vehicles by revenue
      const topPerformingVehicles = [...fleetData]
        .filter(v => v.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
        .map(v => ({
          name: v.vehicle,
          revenue: v.revenue
        }));

      // Fleet utilisation summary
      const { data: allVehicles } = await supabase
        .from("vehicles")
        .select("id, is_active, service_status");

      const totalVehicles = allVehicles?.length || 1;
      const activeRentals = await supabase
        .from("bookings")
        .select("vehicle_id", { count: "exact", head: true })
        .in("status", ["confirmed", "in_progress"]);

      const underMaintenanceCount = allVehicles?.filter(v => 
        v.service_status !== "operational"
      ).length || 0;

      const activeFleetPercent = ((activeRentals.count || 0) / totalVehicles) * 100;
      const underMaintenancePercent = (underMaintenanceCount / totalVehicles) * 100;
      const idleFleetPercent = 100 - activeFleetPercent - underMaintenancePercent;

      setAnalyticsData({
        totalRevenue,
        rentalsCompleted: completedBookings.length,
        avgRentalValue,
        repeatClients: repeatRate,
        cancellationRate,
        avgRating,
        totalReviews: testimonials?.length || 0,
        avgRentalDuration,
        activePromotions: promotionsCount || 0,
        revenueData: revenueData.length > 0 ? revenueData : [{ period: "No data", revenue: 0 }],
        rentalsData: rentalsData.length > 0 ? rentalsData : [{ period: "No data", rentals: 0 }],
        rentalTypeData: rentalTypeData.length > 0 ? rentalTypeData : [{ name: "No data", value: 100, color: "hsl(45, 60%, 50%)" }],
        vehicleUtilisation: vehicleUtilisation.length > 0 ? vehicleUtilisation : [{ name: "No data", days: 0, rentals: 0, utilisation: 0 }],
        fleetData: fleetData.length > 0 ? fleetData : [{ vehicle: "No vehicles", rentals: 0, mileage: "0", revenue: 0, status: "N/A" }],
        topPerformingVehicles: topPerformingVehicles.length > 0 ? topPerformingVehicles : [{ name: "No data", revenue: 0 }],
        fleetUtilisationSummary: {
          activeFleet: Math.max(0, activeFleetPercent),
          idleFleet: Math.max(0, idleFleetPercent),
          underMaintenance: Math.max(0, underMaintenancePercent),
        },
      });

    } catch (error) {
      console.error("Error loading analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  // Real data for KPIs
  const kpis = [
    {
      label: "Total Revenue",
      value: `$${analyticsData.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      isPositive: true,
      icon: DollarSign,
    },
    {
      label: "Rentals Completed",
      value: analyticsData.rentalsCompleted.toString(),
      isPositive: true,
      icon: Briefcase,
    },
    {
      label: "Average Rental Value",
      value: `$${analyticsData.avgRentalValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      isPositive: true,
      icon: Target,
    },
    {
      label: "Repeat Clients",
      value: `${analyticsData.repeatClients.toFixed(1)}%`,
      isPositive: true,
      icon: Users,
    },
  ];


  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="text-sm font-medium text-foreground mb-1">{label}</p>
          <p className="text-sm text-accent font-semibold">
            {payload[0].name === "revenue" ? "$" : ""}{payload[0].value.toLocaleString()}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-fade-in">
            <div>
              <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">
                Analytics & Reports
              </h1>
              <p className="text-muted-foreground">
                Performance insights and detailed operational data
              </p>
            </div>
          </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 h-12">
            <TabsTrigger 
              value="overview"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-glow transition-all"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger 
              value="reports"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-glow transition-all"
            >
              Reports
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-12 mt-8">

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in animation-delay-200">
          {kpis.map((kpi, index) => {
            const Icon = kpi.icon;
            return (
              <Card
                key={index}
                className="relative overflow-hidden border-accent/20 hover:border-accent/40 transition-all hover-lift group"
              >
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-accent" />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-lg bg-accent/10 group-hover:bg-accent/20 transition-colors">
                      <Icon className="w-5 h-5 text-accent" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-foreground mb-1">{kpi.value}</div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                </CardContent>
              </Card>
            );
            })}
            </div>

            {/* Revenue & Jobs Trends */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in animation-delay-400">
          <Card className="border-accent/20">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-2xl">Revenue Over Time</CardTitle>
                  <CardDescription>Weekly revenue breakdown</CardDescription>
                </div>
                <DateRangePicker
                  date={revenueDateRange}
                  onDateChange={setRevenueDateRange}
                  placeholder="Select date range"
                />
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={analyticsData.revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                  <XAxis
                    dataKey="period"
                    stroke="hsl(0 0% 60%)"
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis
                    stroke="hsl(0 0% 60%)"
                    style={{ fontSize: '12px' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(45 100% 60%)"
                    strokeWidth={3}
                    dot={{ fill: "hsl(45 100% 60%)", r: 4 }}
                    activeDot={{ r: 6, fill: "hsl(45 100% 70%)" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-accent/20">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-2xl">Rentals Completed</CardTitle>
                  <CardDescription>Weekly breakdown</CardDescription>
                </div>
                <DateRangePicker
                  date={jobsDateRange}
                  onDateChange={setJobsDateRange}
                  placeholder="Select date range"
                />
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analyticsData.rentalsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                  <XAxis
                    dataKey="period"
                    stroke="hsl(0 0% 60%)"
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis
                    stroke="hsl(0 0% 60%)"
                    style={{ fontSize: '12px' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="rentals"
                    fill="hsl(45 100% 60%)"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
              </CardContent>
            </Card>
            </div>

            {/* Top Performing Vehicles & Fleet Utilisation */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in animation-delay-600">
          {/* Top Performing Vehicles */}
          <Card className="border-accent/20">
            <CardHeader>
              <CardTitle className="font-display text-xl">Top Performing Vehicles</CardTitle>
              <CardDescription>By total rental revenue</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analyticsData.topPerformingVehicles.map((vehicle: any, index: number) => {
                  const maxRevenue = Math.max(...analyticsData.topPerformingVehicles.map((v: any) => v.revenue), 1);
                  const barWidth = (vehicle.revenue / maxRevenue) * 100;

                  return (
                    <div key={index}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-foreground font-medium">{vehicle.name}</span>
                        <span className="text-sm font-semibold text-accent">
                          ${vehicle.revenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full gradient-accent transition-all duration-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Fleet Utilisation Summary */}
          <Card className="border-accent/20">
            <CardHeader>
              <CardTitle className="font-display text-xl">Fleet Utilisation Summary</CardTitle>
              <CardDescription>Current fleet status breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Active Fleet</span>
                    <span className="text-2xl font-bold text-accent">
                      {analyticsData.fleetUtilisationSummary.activeFleet.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="h-full gradient-accent transition-all duration-500"
                      style={{ width: `${analyticsData.fleetUtilisationSummary.activeFleet}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Vehicles currently on rent
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Idle Fleet</span>
                    <span className="text-2xl font-bold text-foreground">
                      {analyticsData.fleetUtilisationSummary.idleFleet.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="h-full bg-muted-foreground/40 transition-all duration-500"
                      style={{ width: `${analyticsData.fleetUtilisationSummary.idleFleet}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Available but not rented
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Under Maintenance</span>
                    <span className="text-2xl font-bold text-foreground">
                      {analyticsData.fleetUtilisationSummary.underMaintenance.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="h-full bg-destructive/60 transition-all duration-500"
                      style={{ width: `${analyticsData.fleetUtilisationSummary.underMaintenance}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Vehicles unavailable due to service
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
            </div>

            {/* Rental Type & Performance Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in animation-delay-700">
          {/* Rental Type Breakdown */}
          <Card className="border-accent/20">
            <CardHeader>
              <CardTitle className="font-display text-xl">Rental Type Breakdown</CardTitle>
              <CardDescription>Distribution by vehicle category</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={analyticsData.rentalTypeData || []}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {(analyticsData.rentalTypeData || []).map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {(analyticsData.rentalTypeData || []).map((item: any, index: number) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-muted-foreground">{item.name}</span>
                    </div>
                    <span className="font-semibold text-foreground">{item.value}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Performance Metrics */}
          <Card className="border-accent/20">
            <CardHeader>
              <CardTitle className="font-display text-xl">Performance Metrics</CardTitle>
              <CardDescription>Key operational indicators</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Cancellation Rate</span>
                    <span className="text-2xl font-bold text-foreground">{analyticsData.cancellationRate.toFixed(1)}%</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {analyticsData.cancellationRate <= 5 ? "Within acceptable range" : "Above acceptable range"}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Customer Satisfaction</span>
                    <span className="text-2xl font-bold text-accent">
                      {analyticsData.avgRating > 0 ? `${analyticsData.avgRating.toFixed(1)}/5.0` : "N/A"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Based on {analyticsData.totalReviews} review{analyticsData.totalReviews !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Additional Metrics */}
          <Card className="border-accent/20">
            <CardHeader>
              <CardTitle className="font-display text-xl">Additional Metrics</CardTitle>
              <CardDescription>Rental trends and promotions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Avg. Rental Duration</span>
                    <span className="text-2xl font-bold text-accent">
                      {analyticsData.avgRentalDuration > 0 ? `${analyticsData.avgRentalDuration.toFixed(1)}` : "0"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Days per booking
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Active Promotions</span>
                    <span className="text-2xl font-bold text-foreground">
                      {analyticsData.activePromotions}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Current live offers
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
            </div>

            {/* Fleet Insights */}
            <Card className="border-accent/20 animate-fade-in">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Fleet Insights</CardTitle>
            <CardDescription>Vehicle performance this month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Vehicle</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground cursor-pointer hover:text-accent">
                      Rentals
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Mileage (Est.)</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground cursor-pointer hover:text-accent">
                      Revenue
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.fleetData.map((vehicle: any, index: number) => (
                    <tr 
                      key={index} 
                      className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                    >
                      <td className="py-4 px-4 text-sm font-medium text-foreground">{vehicle.vehicle}</td>
                      <td className="py-4 px-4 text-sm text-foreground font-semibold">{vehicle.rentals}</td>
                      <td className="py-4 px-4 text-sm text-muted-foreground">{vehicle.mileage} mi</td>
                      <td className="py-4 px-4 text-sm font-semibold text-accent">
                        ${vehicle.revenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                          vehicle.status === "Active" 
                            ? "bg-accent/10 text-accent" 
                            : "bg-muted text-muted-foreground"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            vehicle.status === "Active" ? "bg-accent" : "bg-muted-foreground"
                          }`} />
                          {vehicle.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </CardContent>
            </Card>
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="mt-8">
            <ReportsDataTable />
          </TabsContent>
        </Tabs>
    </div>
  );
};

export default AnalyticsDashboard;
