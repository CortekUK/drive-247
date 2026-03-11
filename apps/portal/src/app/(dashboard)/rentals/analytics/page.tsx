"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ArrowLeft, Info } from "lucide-react";
import { startOfWeek, eachWeekOfInterval, subMonths, format } from "date-fns";
import { useEnhancedRentals } from "@/hooks/use-enhanced-rentals";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";

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

export default function RentalsAnalyticsPage() {
  const { tenant } = useTenant();
  const { data, isLoading } = useEnhancedRentals({});

  const { allRentals, stats } = data || {
    allRentals: [],
    stats: null,
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

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <div className="h-8 bg-muted animate-pulse rounded"></div>
        <div className="h-96 bg-muted animate-pulse rounded"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/rentals">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Rentals Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Charts and insights for your rental data
          </p>
        </div>
      </div>

      {allRentals.length > 0 ? (
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

            {/* Chart 5: Review Status Breakdown (Donut) */}
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
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No rental data available for analytics</p>
        </div>
      )}
    </div>
  );
}
