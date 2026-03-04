"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Plus,
  Download,
  CalendarPlus,
  XCircle,
  List,
  CalendarDays,
  ShieldAlert,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { startOfWeek, eachWeekOfInterval, subMonths, format } from "date-fns";
import { useEnhancedRentals, RentalFilters, EnhancedRental } from "@/hooks/use-enhanced-rentals";
import { RentalsFilters } from "@/components/rentals/rentals-filters";
import { ExtensionRequestDialog } from "@/components/rentals/ExtensionRequestDialog";
import { ReviewStatusBadge } from "@/components/reviews/review-status-badge";
import { RentalReviewDialog } from "@/components/reviews/rental-review-dialog";
import { CalendarView } from "@/components/rentals/calendar/calendar-view";
import { formatDuration, formatRentalDuration } from "@/lib/rental-utils";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

// Chart configs
const STATUS_COLORS: Record<string, string> = {
  Active: "#10b981",
  Completed: "#3b82f6",
  Pending: "#f59e0b",
  Cancelled: "#ef4444",
  Upcoming: "#8b5cf6",
  Rejected: "#9ca3af",
};

const statusChartConfig = {
  Active: { label: "Active", color: "#10b981" },
  Completed: { label: "Completed", color: "#3b82f6" },
  Pending: { label: "Pending", color: "#f59e0b" },
  Cancelled: { label: "Cancelled", color: "#ef4444" },
  Upcoming: { label: "Upcoming", color: "#8b5cf6" },
  Rejected: { label: "Rejected", color: "#9ca3af" },
} satisfies ChartConfig;

const DURATION_COLORS = ["#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81"];

const durationChartConfig = {
  count: { label: "Rentals", color: "#6366f1" },
} satisfies ChartConfig;

const revenueByStatusConfig = {
  revenue: { label: "Revenue", color: "#6366f1" },
} satisfies ChartConfig;

const areaChartConfig = {
  count: { label: "Rentals", color: "#6366f1" },
} satisfies ChartConfig;

const reviewChartConfig = {
  Reviewed: { label: "Reviewed", color: "#10b981" },
  "Pending Review": { label: "Pending Review", color: "#f59e0b" },
  Skipped: { label: "Skipped", color: "#9ca3af" },
} satisfies ChartConfig;

const REVIEW_COLORS: Record<string, string> = {
  Reviewed: "#10b981",
  "Pending Review": "#f59e0b",
  Skipped: "#9ca3af",
};

const RentalsList = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [selectedRental, setSelectedRental] = useState<EnhancedRental | null>(null);
  const [reviewRental, setReviewRental] = useState<EnhancedRental | null>(null);
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();

  const currentView = searchParams.get("view") || "list";

  // Parse filters from URL
  const filters: RentalFilters = useMemo(
    () => ({
      search: searchParams.get("search") || "",
      status: searchParams.get("status") || "all",
      customerType: searchParams.get("customerType") || "all",
      paymentMode: searchParams.get("paymentMode") || "all",
      duration: searchParams.get("duration") || "all",
      durationMin: searchParams.get("durationMin")
        ? parseInt(searchParams.get("durationMin")!)
        : undefined,
      durationMax: searchParams.get("durationMax")
        ? parseInt(searchParams.get("durationMax")!)
        : undefined,
      initialPayment: searchParams.get("initialPayment") || "all",
      startDateFrom: searchParams.get("startDateFrom")
        ? new Date(searchParams.get("startDateFrom")!)
        : undefined,
      startDateTo: searchParams.get("startDateTo")
        ? new Date(searchParams.get("startDateTo")!)
        : undefined,
      sortBy: searchParams.get("sortBy") || "created_at",
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
      page: parseInt(searchParams.get("page") || "1"),
      bonzahStatus: searchParams.get("bonzahStatus") || undefined,
    }),
    [searchParams]
  );

  const { data, isLoading } = useEnhancedRentals(filters);

  const { rentals, allRentals, stats, totalCount, totalPages } = data || {
    rentals: [],
    allRentals: [],
    stats: null,
    totalCount: 0,
    totalPages: 0,
  };

  const currencyCode = tenant?.currency_code || "GBP";

  // Chart 1: Status distribution donut
  const statusDonutData = useMemo(() => {
    if (!allRentals?.length) return [];
    const counts: Record<string, number> = {};
    allRentals.forEach((r) => {
      const s = r.computed_status;
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [allRentals]);

  // Chart 2: Duration distribution (vertical bar)
  const durationBarData = useMemo(() => {
    if (!allRentals?.length) return [];
    const buckets = [
      { label: "≤3mo", min: 0, max: 3 },
      { label: "3-6mo", min: 3, max: 6 },
      { label: "6-12mo", min: 6, max: 12 },
      { label: "12-18mo", min: 12, max: 18 },
      { label: "18-24mo", min: 18, max: 24 },
      { label: ">24mo", min: 24, max: Infinity },
    ];
    return buckets.map((b, i) => ({
      name: b.label,
      count: allRentals.filter(
        (r) => b.min === 0 ? r.duration_months <= b.max : (r.duration_months > b.min && r.duration_months <= b.max)
      ).length,
      fill: DURATION_COLORS[i],
    }));
  }, [allRentals]);

  // Chart 3: Revenue by status (horizontal bar)
  const revenueByStatusData = useMemo(() => {
    if (!allRentals?.length) return [];
    const sums: Record<string, number> = {};
    allRentals.forEach((r) => {
      const s = r.computed_status;
      sums[s] = (sums[s] || 0) + (r.monthly_amount || 0);
    });
    return Object.entries(sums)
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [allRentals]);

  // Chart 4: Rentals created over time (area — last 3 months by week)
  const rentalsOverTimeData = useMemo(() => {
    if (!allRentals?.length) return [];
    const now = new Date();
    const threeMonthsAgo = subMonths(now, 3);
    const weeks = eachWeekOfInterval({ start: threeMonthsAgo, end: now }, { weekStartsOn: 1 });
    const weekCounts = new Map<string, number>();
    weeks.forEach((w) => weekCounts.set(format(w, "MMM d"), 0));

    allRentals.forEach((r) => {
      if (!r.created_at) return;
      const created = new Date(r.created_at);
      if (created < threeMonthsAgo) return;
      const weekStart = startOfWeek(created, { weekStartsOn: 1 });
      const key = format(weekStart, "MMM d");
      if (weekCounts.has(key)) {
        weekCounts.set(key, (weekCounts.get(key) || 0) + 1);
      }
    });

    return Array.from(weekCounts.entries()).map(([week, count]) => ({
      week,
      count,
    }));
  }, [allRentals]);

  // Chart 5: Review status breakdown (donut — completed rentals only)
  const reviewDonutData = useMemo(() => {
    if (!allRentals?.length) return [];
    const completedRentals = allRentals.filter(
      (r) => r.computed_status === "Completed"
    );
    if (!completedRentals.length) return [];
    const counts: Record<string, number> = {
      Reviewed: 0,
      "Pending Review": 0,
      Skipped: 0,
    };
    completedRentals.forEach((r) => {
      if (r.review_status === "reviewed") counts["Reviewed"]++;
      else if (r.review_status === "skipped") counts["Skipped"]++;
      else counts["Pending Review"]++;
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [allRentals]);

  const handleFiltersChange = (newFilters: RentalFilters) => {
    const params = new URLSearchParams();
    Object.entries(newFilters).forEach(([key, value]) => {
      if (value && value !== "all" && value !== "" && value !== 1) {
        if (value instanceof Date) {
          params.set(key, value.toISOString().split("T")[0]);
        } else {
          params.set(key, value.toString());
        }
      }
    });
    router.push(`?${params.toString()}`);
  };

  const handleClearFilters = () => {
    const params = new URLSearchParams();
    if (currentView !== "list") params.set("view", currentView);
    router.push(params.toString() ? `?${params.toString()}` : "?");
  };

  const handleViewChange = (view: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "list") {
      params.delete("view");
    } else {
      params.set("view", view);
    }
    router.push(`?${params.toString()}`);
  };

  const handlePageChange = (page: number) => {
    handleFiltersChange({ ...filters, page });
  };

  const handleExportCSV = () => {
    if (!data?.rentals) return;

    const currencyCode = tenant?.currency_code || 'GBP';
    const currencySymbol = getCurrencySymbol(currencyCode);

    const csvContent = [
      [
        "Rental #",
        "Customer",
        "Vehicle",
        "Start Date",
        "End Date",
        "Duration",
        "Period Type",
        "Rental Amount",
        "Protection Cost",
        "Total Amount",
        "Initial Payment",
        "Status",
      ].join(","),
      ...data.rentals.map((rental) =>
        [
          rental.rental_number,
          rental.customer.name,
          `${rental.vehicle.reg} (${rental.vehicle.make} ${rental.vehicle.model})`,
          rental.start_date,
          rental.end_date || "",
          formatRentalDuration(rental.start_date, rental.end_date),
          rental.rental_period_type || "Monthly",
          `${currencySymbol}${rental.monthly_amount}`,
          rental.protection_cost > 0 ? `${currencySymbol}${rental.protection_cost}` : "—",
          `${currencySymbol}${rental.total_amount}`,
          rental.initial_payment ? `${currencySymbol}${rental.initial_payment}` : "—",
          rental.computed_status,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rentals-export.csv";
    link.click();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted animate-pulse rounded"></div>
        <div className="h-96 bg-muted animate-pulse rounded"></div>
      </div>
    );
  }

  return (
    <div className={currentView === "calendar" ? "p-4 md:p-6 space-y-6" : "container mx-auto p-4 md:p-6 space-y-6"}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Rentals</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Manage rental agreements and contracts
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* View Toggle */}
          <div className="flex rounded-md border overflow-hidden">
            <Button
              variant={currentView === "list" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-8 px-2.5"
              onClick={() => handleViewChange("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={currentView === "calendar" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-8 px-2.5 border-l"
              onClick={() => handleViewChange("calendar")}
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!rentals.length}
            className="border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
          >
            <Download className="h-4 w-4 mr-2" />
            <span className="hidden xs:inline">Export CSV</span>
            <span className="xs:hidden">Export</span>
          </Button>
          {canEdit('rentals') && (
            <Button
              onClick={() => router.push("/rentals/new")}
              className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              <Plus className="h-4 w-4 mr-2" />
              <span className="hidden xs:inline">New Rental</span>
              <span className="xs:hidden">New</span>
            </Button>
          )}
        </div>
      </div>

      {/* Quick Stats — list view only */}
      {currentView !== "calendar" && stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="bg-card hover:bg-accent/50 border transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-sm text-muted-foreground">Total Rentals</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40 transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-success">
                {stats.active}
              </div>
              <p className="text-sm text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card className="bg-card hover:bg-accent/50 border transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-muted-foreground">
                {stats.closed}
              </div>
              <p className="text-sm text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20 hover:border-amber-500/40 transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-amber-500">
                {stats.pending}
              </div>
              <p className="text-sm text-muted-foreground">Pending</p>
            </CardContent>
          </Card>
          <Card className="bg-card hover:bg-accent/50 border transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{stats.avgDuration}</div>
              <p className="text-sm text-muted-foreground">Avg Duration (mo)</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts — list view only */}
      {currentView !== "calendar" && allRentals.length > 0 && (
        <TooltipProvider>
          {/* Row 1: Three charts side by side */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Chart 1: Status Distribution Donut */}
            <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-sm font-medium">Status Distribution</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Breakdown of all rentals by their current status</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {statusDonutData.length > 0 ? (
                <ChartContainer config={statusChartConfig} className="h-[200px] w-full">
                  <PieChart>
                    <Pie
                      data={statusDonutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                    >
                      {statusDonutData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                      {stats?.total || 0}
                    </text>
                    <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">
                      Total
                    </text>
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </Card>

            {/* Chart 2: Duration Distribution (Vertical Bar) */}
            <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-sm font-medium">Duration Distribution</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Number of rentals grouped by duration range</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {durationBarData.some((d) => d.count > 0) ? (
                <ChartContainer config={durationChartConfig} className="h-[200px] w-full">
                  <BarChart data={durationBarData} margin={{ left: -10, right: 5 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {durationBarData.map((entry, i) => (
                        <Cell key={entry.name} fill={DURATION_COLORS[i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </Card>

            {/* Chart 3: Revenue by Status (Horizontal Bar) */}
            <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-sm font-medium">Revenue by Status</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Total monthly revenue summed per rental status</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {revenueByStatusData.length > 0 ? (
                <ChartContainer config={revenueByStatusConfig} className="h-[200px] w-full">
                  <BarChart data={revenueByStatusData} layout="vertical" margin={{ left: 5, right: 10 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                    <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={75} />
                    <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => formatCurrency(v, currencyCode)} />} />
                    <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                      {revenueByStatusData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </Card>
          </div>

          {/* Row 2: Area chart (2/3) + Review donut (1/3) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Chart 4: Rentals Created Over Time (Area) */}
            <Card className={`rounded-lg border border-border/60 bg-card/50 p-4 ${reviewDonutData.length > 0 ? "md:col-span-2" : "md:col-span-3"}`}>
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-sm font-medium">Rentals Over Time</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Number of rentals created per week over the last 3 months</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {rentalsOverTimeData.length > 0 ? (
                <ChartContainer config={areaChartConfig} className="h-[200px] w-full">
                  <AreaChart data={rentalsOverTimeData} margin={{ left: -10, right: 5, top: 5 }}>
                    <defs>
                      <linearGradient id="rentalsAreaFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#rentalsAreaFill)"
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </Card>

            {/* Chart 5: Review Status Breakdown (Donut) — only if review data exists */}
            {reviewDonutData.length > 0 && (
              <Card className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <h3 className="text-sm font-medium">Review Status</h3>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Review status of completed rentals</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <ChartContainer config={reviewChartConfig} className="h-[200px] w-full">
                  <PieChart>
                    <Pie
                      data={reviewDonutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                    >
                      {reviewDonutData.map((entry) => (
                        <Cell key={entry.name} fill={REVIEW_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                      {reviewDonutData.reduce((s, d) => s + d.value, 0)}
                    </text>
                    <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">
                      Completed
                    </text>
                  </PieChart>
                </ChartContainer>
              </Card>
            )}
          </div>
        </TooltipProvider>
      )}

      {/* Filters — list view only */}
      {currentView !== "calendar" && (
        <RentalsFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onClearFilters={handleClearFilters}
        />
      )}

      {/* Calendar View */}
      {currentView === "calendar" ? (
        <CalendarView filters={filters} />
      ) : /* Rentals Table */
      rentals.length > 0 ? (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rental #</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rentals.map((rental) => (
                      <TableRow
                        key={rental.id}
                        className={`hover:bg-muted/50 cursor-pointer ${rental.is_extended ? 'bg-amber-500/10 border-l-4 border-l-amber-500' : rental.cancellation_requested ? 'bg-red-500/10 border-l-4 border-l-red-500' : (!filters.bonzahStatus && rental.bonzah_status === 'insufficient_balance') ? 'bg-[#CC004A]/5 border-l-4 border-l-[#CC004A]' : (!filters.bonzahStatus && rental.bonzah_status === 'quoted') ? 'bg-[#CC004A]/5 border-l-4 border-l-[#CC004A]' : ''}`}
                        onClick={() => router.push(`/rentals/${rental.id}`)}
                      >
                        <TableCell className="font-medium">
                          {rental.is_extended ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <button
                                className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 mt-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRental(rental);
                                  setShowExtensionDialog(true);
                                }}
                              >
                                <CalendarPlus className="h-3 w-3" />
                                Extension Requested
                              </button>
                            </div>
                          ) : rental.cancellation_requested ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <span className="text-xs text-red-600 font-medium flex items-center gap-1 mt-0.5">
                                <XCircle className="h-3 w-3" />
                                Cancellation Requested
                              </span>
                            </div>
                          ) : (!filters.bonzahStatus && rental.bonzah_status === 'insufficient_balance') ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <span className="text-xs text-[#CC004A] font-medium flex items-center gap-1 mt-0.5">
                                <ShieldAlert className="h-3 w-3" />
                                Balance Required
                              </span>
                            </div>
                          ) : (!filters.bonzahStatus && rental.bonzah_status === 'quoted') ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <span className="text-xs text-[#CC004A] font-medium flex items-center gap-1 mt-0.5">
                                <img src="/bonzah-logo.svg" alt="" className="h-3 w-auto dark:hidden" />
                                <img src="/bonzah-logo-dark.svg" alt="" className="h-3 w-auto hidden dark:block" />
                                Ins. Quoted
                              </span>
                            </div>
                          ) : (
                            rental.rental_number
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {rental.created_at
                            ? new Date(rental.created_at).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {rental.customer.name.split(' ')[0]}
                        </TableCell>
                        <TableCell>
                          {new Date(rental.start_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {rental.end_date
                            ? new Date(rental.end_date).toLocaleDateString()
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {formatRentalDuration(rental.start_date, rental.end_date)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              rental.computed_status === "Completed"
                                ? "secondary"
                                : rental.computed_status === "Cancelled" || rental.computed_status === "Rejected"
                                ? "destructive"
                                : "outline"
                            }
                            className={
                              rental.computed_status === "Active"
                                ? "bg-green-600 text-white"
                                : rental.computed_status === "Pending"
                                ? "bg-amber-500/20 text-amber-600 border-amber-500"
                                : ""
                            }
                          >
                            {rental.computed_status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <ReviewStatusBadge
                            reviewStatus={rental.review_status}
                            reviewRating={rental.review_rating}
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewRental(rental);
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Showing {rentals.length} of {totalCount} rentals
            </div>
            <div className="flex items-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() =>
                        handlePageChange(Math.max(1, filters.page! - 1))
                      }
                      className={
                        filters.page === 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>

                  {totalPages > 1 ? (
                    Array.from(
                      { length: Math.min(5, totalPages) },
                      (_, i) => {
                        const pageNum =
                          Math.max(
                            1,
                            Math.min(totalPages - 4, filters.page! - 2)
                          ) + i;
                        return (
                          <PaginationItem key={pageNum}>
                            <PaginationLink
                              onClick={() => handlePageChange(pageNum)}
                              isActive={pageNum === filters.page}
                              className="cursor-pointer"
                            >
                              {pageNum}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      }
                    )
                  ) : (
                    <PaginationItem>
                      <PaginationLink isActive className="cursor-default">
                        1
                      </PaginationLink>
                    </PaginationItem>
                  )}

                  <PaginationItem>
                    <PaginationNext
                      onClick={() =>
                        handlePageChange(
                          Math.min(totalPages, filters.page! + 1)
                        )
                      }
                      className={
                        filters.page === totalPages || totalPages <= 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-8">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No rentals found</h3>
          <p className="text-muted-foreground mb-4">
            No rentals match your current filters
          </p>
          <Button onClick={handleClearFilters}>Clear Filters</Button>
        </div>
      )}

      {/* Rental Review Dialog */}
      {reviewRental && (
        <RentalReviewDialog
          open={!!reviewRental}
          onOpenChange={(open) => { if (!open) setReviewRental(null); }}
          rentalId={reviewRental.id}
          customerId={reviewRental.customer.id}
          customerName={reviewRental.customer.name}
          rentalNumber={reviewRental.rental_number}
        />
      )}

      {/* Extension Request Dialog */}
      {selectedRental && (
        <ExtensionRequestDialog
          open={showExtensionDialog}
          onOpenChange={(open) => {
            setShowExtensionDialog(open);
            if (!open) setSelectedRental(null);
          }}
          rental={{
            id: selectedRental.id,
            end_date: selectedRental.end_date || '',
            previous_end_date: selectedRental.previous_end_date || null,
            customers: {
              id: selectedRental.customer.id,
              name: selectedRental.customer.name,
            },
            vehicles: {
              id: selectedRental.vehicle.id,
              reg: selectedRental.vehicle.reg,
              make: selectedRental.vehicle.make,
              model: selectedRental.vehicle.model,
            },
          }}
        />
      )}
    </div>
  );
};

export default RentalsList;
