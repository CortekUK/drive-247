"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  BarChart3,
  Clock,
  ArrowRight,
  Search,
  SlidersHorizontal,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";

// Format a Postgres TIME value ("HH:MM" or "HH:MM:SS") into 12-hour clock
// notation ("10:30 AM"). Returns null when the value is missing so callers
// can skip rendering the line entirely.
const formatTimeOfDay = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minutes = match[2];
  if (Number.isNaN(hour24) || hour24 < 0 || hour24 > 23) return null;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${minutes} ${period}`;
};
import Link from "next/link";
import { formatLocalDate } from "@/lib/date-utils";
import { useEnhancedRentals, RentalFilters, EnhancedRental } from "@/hooks/use-enhanced-rentals";
import { RentalsFilterPanel } from "@/components/rentals/rentals-filter-panel";
import { ExtensionRequestDialog } from "@/components/rentals/ExtensionRequestDialog";
import { ReviewStatusBadge } from "@/components/reviews/review-status-badge";
import { RentalReviewDialog } from "@/components/reviews/rental-review-dialog";
import { CalendarView } from "@/components/rentals/calendar/calendar-view";
import { formatDuration, formatRentalDuration } from "@/lib/rental-utils";
import { getCurrencySymbol } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

// ── overview charts ──────────────────────────────────────────────────────────
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, Cell, Label as RLabel, Pie, PieChart } from "recharts";

const trendData = [
  { m: "Jan", rentals: 4 },
  { m: "Feb", rentals: 6 },
  { m: "Mar", rentals: 5 },
  { m: "Apr", rentals: 8 },
  { m: "May", rentals: 7 },
  { m: "Jun", rentals: 10 },
];
const trendConfig = { rentals: { label: "Rentals", color: "hsl(var(--chart-3))" } } satisfies ChartConfig;

const revenueData = [
  { m: "Jan", rev: 4200 },
  { m: "Feb", rev: 5100 },
  { m: "Mar", rev: 4800 },
  { m: "Apr", rev: 6400 },
  { m: "May", rev: 7200 },
  { m: "Jun", rev: 8300 },
];
const revenueConfig = { rev: { label: "Revenue", color: "hsl(var(--chart-1))" } } satisfies ChartConfig;

const statusConfig = {
  active: { label: "Active", color: "hsl(var(--chart-3))" },
  completed: { label: "Completed", color: "hsl(var(--chart-1))" },
  pending: { label: "Pending", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

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

  // Overview row toggles between charts and the comprehensive filter panel
  const [showFilters, setShowFilters] = useState(false);

  // Header search — debounced into the URL-driven filters
  const [searchInput, setSearchInput] = useState(filters.search || "");
  useEffect(() => {
    setSearchInput(filters.search || "");
  }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== (filters.search || "")) {
        handleFiltersChange({ ...filters, search: searchInput, page: 1 });
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Infinite scroll — render a growing slice of the full filtered set
  const PAGE_STEP = 25;
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filterKey = JSON.stringify({
    search: filters.search,
    status: filters.status,
    paymentType: filters.paymentType,
    bonzahStatus: filters.bonzahStatus,
    startDateFrom: filters.startDateFrom,
    startDateTo: filters.startDateTo,
    extensionRequested: filters.extensionRequested,
    cancellationRequested: filters.cancellationRequested,
  });
  // Reset the window whenever filters change
  useEffect(() => {
    setVisibleCount(PAGE_STEP);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filterKey]);

  const visibleRentals = useMemo(() => allRentals.slice(0, visibleCount), [allRentals, visibleCount]);
  const hasMore = visibleCount < allRentals.length;

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_STEP, allRentals.length));
        }
      },
      { root: scrollRef.current, rootMargin: "240px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, allRentals.length]);

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

    const currencyCode = tenant?.currency_code || 'USD';
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
    <div className={currentView === "calendar" ? "px-4 pb-4 md:px-6 md:pb-6 space-y-6" : "container mx-auto flex h-[calc(100svh-2rem)] flex-col gap-6 px-4 md:px-6"}>
      {/* Header */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0 flex items-start justify-between gap-3 sm:block">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold">Rentals</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Manage rental agreements and contracts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentView !== "calendar" && (
            <div className="group relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search rentals…"
                className="rounded-xl border-border/60 bg-card pl-9 pr-11 shadow-sm transition-all placeholder:text-muted-foreground/70 hover:border-primary/30 focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/20"
              />
              <button
                type="button"
                aria-label="Filters"
                aria-pressed={showFilters}
                onClick={() => setShowFilters((v) => !v)}
                className={`absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg transition-colors ${
                  showFilters ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20"
                }`}
              >
                <SlidersHorizontal className="size-4" />
              </button>
            </div>
          )}
          {canEdit('rentals') && (
            <Button
              onClick={() => router.push("/rentals/new")}
              className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg flex-1 sm:flex-none"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Rental
            </Button>
          )}
        </div>
      </div>

      {/* Overview — charts; the filter panel overlays the exact same box */}
      {currentView !== "calendar" && (
        <div className="relative shrink-0">
          {/* Charts define the box; fade/scale out when filters open */}
          <div
            className={`transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] ${
              showFilters ? "pointer-events-none scale-[0.985] opacity-0 blur-[1px]" : "scale-100 opacity-100 blur-0"
            }`}
          >
            {stats && (() => {
        const statusData = [
          { key: "active", label: "Active", value: stats.active, fill: "hsl(var(--chart-3))" },
          { key: "completed", label: "Completed", value: stats.closed, fill: "hsl(var(--chart-1))" },
          { key: "pending", label: "Pending", value: stats.pending, fill: "hsl(var(--chart-5))" },
        ];
        return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1 — Status donut */}
          <Card className="shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">By status</CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center pt-0">
              <ChartContainer config={statusConfig} className="aspect-square h-[112px]">
                <PieChart>
                  <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="label" hideLabel />} />
                  <Pie data={statusData} dataKey="value" nameKey="label" innerRadius={36} outerRadius={52} cornerRadius={4} strokeWidth={3} paddingAngle={4}>
                    {statusData.map((d) => (
                      <Cell key={d.key} fill={d.fill} className="stroke-card" />
                    ))}
                    <RLabel
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          return (
                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                              <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-xl font-bold">{stats.total}</tspan>
                              <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 15} className="fill-muted-foreground text-[10px]">rentals</tspan>
                            </text>
                          );
                        }
                        return null;
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* 2 — New rentals (area) */}
          <Card className="shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">New rentals</CardTitle>
              <p className="text-xl font-bold">{stats.total}</p>
            </CardHeader>
            <CardContent className="pt-0">
              <ChartContainer config={trendConfig} className="h-[78px] w-full">
                <AreaChart data={trendData} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-rentals)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--color-rentals)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Area dataKey="rentals" type="natural" stroke="var(--color-rentals)" strokeWidth={2.5} fill="url(#fillTrend)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* 3 — Revenue (bars) */}
          <Card className="shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Revenue</CardTitle>
              <p className="text-xl font-bold">${(revenueData.reduce((s, d) => s + d.rev, 0) / 1000).toFixed(0)}k</p>
            </CardHeader>
            <CardContent className="pt-0">
              <ChartContainer config={revenueConfig} className="h-[78px] w-full">
                <BarChart data={revenueData} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-rev)" stopOpacity={1} />
                      <stop offset="100%" stopColor="var(--color-rev)" stopOpacity={0.45} />
                    </linearGradient>
                  </defs>
                  <ChartTooltip cursor={{ fillOpacity: 0.1 }} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="rev" fill="url(#fillRev)" radius={6} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* 4 — Calendar view nav */}
          <button
            type="button"
            onClick={() => handleViewChange("calendar")}
            className="group relative flex cursor-pointer flex-col justify-end overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 text-left text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/15"
          >
            <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-primary/15 blur-2xl transition-all duration-300 group-hover:bg-primary/25" />
            <span className="pointer-events-none absolute -bottom-10 -left-6 size-24 rounded-full bg-primary/10 blur-2xl" />
            {/* Faint fleet-timeline preview — fills the body, echoes the Gantt view */}
            <div className="pointer-events-none absolute inset-x-5 top-[38%] -translate-y-1/2 opacity-80 transition-opacity duration-300 group-hover:opacity-100">
              {/* scanning "now" playhead */}
              <span
                className="absolute -top-2 bottom-[-0.5rem] w-px bg-primary/60 shadow-[0_0_8px_hsl(var(--primary)/0.5)]"
                style={{ animation: "playhead-scan 4s ease-in-out infinite" }}
              >
                <span className="absolute -left-[3px] -top-1 size-[7px] rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
              </span>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-7 rounded-full bg-primary/20" />
                  <span className="h-1.5 flex-[3] origin-left rounded-full bg-primary/60" style={{ animation: "timeline-grow 3.6s ease-in-out infinite" }} />
                  <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-12 rounded-full bg-primary/20" />
                  <span className="h-1.5 flex-1 origin-left rounded-full bg-primary/45" style={{ animation: "timeline-grow 3.6s ease-in-out infinite", animationDelay: "0.45s" }} />
                  <span className="h-1.5 flex-[2] rounded-full bg-primary/15" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 flex-[2] origin-left rounded-full bg-primary/50" style={{ animation: "timeline-grow 3.6s ease-in-out infinite", animationDelay: "0.9s" }} />
                  <span className="h-1.5 flex-[3] rounded-full bg-primary/15" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-5 rounded-full bg-primary/20" />
                  <span className="h-1.5 flex-[2] origin-left rounded-full bg-primary/40" style={{ animation: "timeline-grow 3.6s ease-in-out infinite", animationDelay: "1.35s" }} />
                  <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
                </div>
              </div>
            </div>
            <div className="relative">
              <div className="mt-3 text-lg font-bold tracking-tight">Calendar View</div>
              <div className="text-sm text-muted-foreground">See your fleet on a timeline</div>
            </div>
            <ArrowRight className="absolute right-4 top-4 size-5 text-primary" style={{ animation: "arrow-nudge 4s ease-in-out infinite" }} />
          </button>
        </div>
        );
      })()}
          </div>

          {/* Filter panel — fills the exact same box as the charts */}
          <div
            className={`absolute inset-0 transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] ${
              showFilters ? "scale-100 opacity-100 blur-0" : "pointer-events-none scale-[0.985] opacity-0 blur-[1px]"
            }`}
          >
            <RentalsFilterPanel
              filters={filters}
              onChange={handleFiltersChange}
              onClear={handleClearFilters}
              onClose={() => setShowFilters(false)}
            />
          </div>
        </div>
      )}

      {/* Calendar View */}
      {currentView === "calendar" ? (
        <CalendarView filters={filters} />
      ) : /* Rentals Table */
      allRentals.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-none">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-auto relative p-0">
              <Table className="min-w-[700px]">
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Rental #</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Pickup</TableHead>
                      <TableHead>Return</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRentals.map((rental) => (
                      <TableRow
                        key={rental.id}
                        className={`hover:bg-muted/50 cursor-pointer ${rental.is_extended ? 'bg-amber-500/10 border-l-4 border-l-amber-500' : rental.cancellation_requested ? 'bg-red-500/10 border-l-4 border-l-red-500' : (!filters.bonzahStatus && rental.bonzah_status === 'insufficient_balance') ? 'bg-[#CC004A]/5 border-l-4 border-l-[#CC004A]' : (!filters.bonzahStatus && rental.bonzah_status === 'quoted') ? 'bg-[#CC004A]/5 border-l-4 border-l-[#CC004A]' : ''}`}
                        onClick={() => router.push(`/rentals/${rental.id}`)}
                      >
                        <TableCell className="font-medium">
                          {rental.is_extended ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <Button
                                variant="ghost"
                                className="h-auto border-0 p-0 rounded-none justify-start hover:bg-transparent text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 mt-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRental(rental);
                                  setShowExtensionDialog(true);
                                }}
                              >
                                <CalendarPlus className="size-3" />
                                Extension Requested
                              </Button>
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
                          <div>{formatLocalDate(rental.start_date)}</div>
                          {formatTimeOfDay(rental.pickup_time) && (
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTimeOfDay(rental.pickup_time)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {rental.end_date
                            ? (
                              <>
                                <div>{formatLocalDate(rental.end_date)}</div>
                                {formatTimeOfDay(rental.return_time) && (
                                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatTimeOfDay(rental.return_time)}
                                  </div>
                                )}
                              </>
                            )
                            : rental.is_pay_as_you_go
                            ? <span className="text-indigo-500 text-xs font-medium">Ongoing</span>
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {rental.is_pay_as_you_go && !rental.end_date
                            ? <span className="text-xs text-muted-foreground">PAYG</span>
                            : formatRentalDuration(rental.start_date, rental.end_date)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
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
                            {rental.is_pay_as_you_go && (
                              <Badge variant="outline" className="text-indigo-600 border-indigo-300 bg-indigo-100 dark:text-indigo-400 dark:border-indigo-700 dark:bg-indigo-950/30 text-[10px]">
                                PAYG
                              </Badge>
                            )}
                            {(rental as any).auto_extend_enabled && (
                              <Badge variant="outline" className="text-violet-600 border-violet-300 bg-violet-100 dark:text-violet-400 dark:border-violet-700 dark:bg-violet-950/30 text-[10px]">
                                Auto-Extend
                              </Badge>
                            )}
                            {/* Added on main after this page's redesign was
                                written — an auto-extending rental that has been
                                paused otherwise looks identical to one still
                                renewing. */}
                            {(rental as any).auto_extend_status === 'paused' && (
                              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-100 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-950/30 text-[10px]">
                                Paused
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <ReviewStatusBadge
                            reviewStatus={rental.review_status}
                            reviewRating={rental.review_rating}
                            rentalStatus={rental.computed_status}
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

                {/* Infinite-scroll sentinel + loader */}
                {hasMore && (
                  <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading more…
                  </div>
                )}
          </div>
        </div>
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
            // The dialog divides by (end_date - start_date) to work out the
            // current rental length before pricing an extension. This was never
            // passed, so that subtraction ran against undefined and produced
            // NaN days on every extension quote.
            start_date: selectedRental.start_date || '',
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
