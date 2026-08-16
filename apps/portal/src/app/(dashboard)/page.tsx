"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Plus, TrendingUp, TrendingDown, Pencil } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  addDays,
  eachDayOfInterval,
  endOfDay,
  format,
  parseISO,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";

import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useDashboardKPIs } from "@/hooks/use-dashboard-kpis";
import { buildAvailabilitySummary } from "@/hooks/use-working-hours-summary";
import { formatCurrency } from "@/lib/format-utils";
import { LowCreditsBanner } from "@/components/dashboard/low-credits-banner";
import { BonzahStatusBanner } from "@/components/dashboard/bonzah-status-banner";
import { BonzahPendingAlert } from "@/components/dashboard/bonzah-pending-alert";
import { SetupGuide } from "@/components/dashboard/setup-guide";
import { useSetupGuide } from "@/hooks/use-setup-guide";
import { AnnouncementStack } from "@/components/dashboard/announcement-stack";

// ─── Greeting ────────────────────────────────────────────────────────────────

function getGreeting(hour: number): { text: string; emoji: string } {
  if (hour < 5) return { text: "Working late", emoji: "🦉" };
  if (hour < 12) return { text: "Good morning", emoji: "☕" };
  if (hour < 17) return { text: "Good afternoon", emoji: "🌤️" };
  if (hour < 21) return { text: "Good evening", emoji: "🌇" };
  return { text: "Good night", emoji: "✨" };
}

// ─── Working hours ───────────────────────────────────────────────────────────

/** JS getDay() order — index 0 is Sunday. */
const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * The same column set and query key as `useWorkingHoursSummary` / WorkingHoursCard,
 * so all three share one React Query cache entry and this costs no extra fetch.
 */
const WORKING_HOURS_COLUMNS = `
  working_hours_always_open,
  timezone,
  monday_enabled, monday_open, monday_close,
  tuesday_enabled, tuesday_open, tuesday_close,
  wednesday_enabled, wednesday_open, wednesday_close,
  thursday_enabled, thursday_open, thursday_close,
  friday_enabled, friday_open, friday_close,
  saturday_enabled, saturday_open, saturday_close,
  sunday_enabled, sunday_open, sunday_close
`;

/** "HH:mm[:ss]" → minutes past midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** "HH:mm[:ss]" → "9:00 AM". Mirrors the formatter in use-working-hours-summary. */
function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m || 0).padStart(2, "0")} ${period}`;
}

/**
 * Which weekday is it, and what time, *in the tenant's timezone*?
 *
 * An operator in Denver checking the portal from a phone still on UK time must
 * see their own shop's state, not the browser's. Falls back to browser-local
 * when the tenant has no timezone set.
 */
function zonedNow(timezone: string | null | undefined, tick: Date) {
  if (!timezone) {
    return { day: tick.getDay(), minutes: tick.getHours() * 60 + tick.getMinutes() };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(tick);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday")
    );
    const hour = Number(get("hour"));
    return {
      day: weekdayIndex >= 0 ? weekdayIndex : tick.getDay(),
      // Intl gives "24" for midnight under hour12:false in some engines.
      minutes: (hour === 24 ? 0 : hour) * 60 + Number(get("minute")),
    };
  } catch {
    return { day: tick.getDay(), minutes: tick.getHours() * 60 + tick.getMinutes() };
  }
}

/**
 * Today's configured window, using the same defaults as the booking side
 * (Mon–Fri 09:00–17:00 open, Sat/Sun closed) so this agrees with what the
 * customer-facing widget actually enforces.
 */
function scheduleForDay(row: any, dayIndex: number) {
  const key = DAY_KEYS[dayIndex];
  const weekend = key === "saturday" || key === "sunday";
  return {
    enabled: (row?.[`${key}_enabled`] ?? !weekend) as boolean,
    open: (row?.[`${key}_open`] ?? (weekend ? "10:00" : "09:00")) as string,
    close: (row?.[`${key}_close`] ?? (weekend ? "14:00" : "17:00")) as string,
  };
}

// ─── Analytics ───────────────────────────────────────────────────────────────

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGE_DAYS;

/** Indigo ramp from the theme layer, so charts follow the tenant's brand colour. */
const PLAN_COLORS = [
  "hsl(var(--chart-3))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-4))",
];

const revenueConfig = {
  current: { label: "This period", color: "hsl(var(--chart-3))" },
  previous: { label: "Previous period", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const bookingsConfig = {
  bookings: { label: "Bookings", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

/**
 * chart-3, not chart-1. These are solid bars carrying the value on their own, and
 * chart-1 is the lightest step of the ramp — it washes out against the card.
 * chart-1 is right where it is the pale half of a pair (previous-vs-current,
 * returns-vs-pickups) or one slice among several; it is wrong as a solo series.
 */
const topVehiclesConfig = {
  revenue: { label: "Revenue", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

const opsConfig = {
  pickups: { label: "Pickups", color: "hsl(var(--chart-3))" },
  returns: { label: "Returns", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const utilisationConfig = { value: { label: "Utilisation" } } satisfies ChartConfig;

function EmptyChart({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
      style={{ height }}
    >
      {message}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const { canView, canEdit } = useManagerPermissions();
  const currencyCode = tenant?.currency_code || "USD";

  // The guide is a call to action, so it only goes to someone who can act on
  // it: `canEdit` is false for viewers and for managers without an editor
  // grant on Settings, and true for every other role.
  const { isVisible: setupGuideIsVisible } = useSetupGuide();
  const setupGuideVisible = setupGuideIsVisible && canEdit("settings.general");

  /** First name only — "Good morning, Michael" reads better than the full name. */
  const firstName = (appUser?.name || "").trim().split(/\s+/)[0];

  // `now` starts null so server and first client render agree, then ticks.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const greeting = getGreeting(now ? now.getHours() : 8);
  const dateStr = now
    ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "";
  const timeStr = now
    ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";

  // ── Booking availability (read-only) ──────────────────────────────────────
  const { data: hoursRow } = useQuery({
    queryKey: ["working-hours", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;
      const { data, error } = await supabase
        .from("tenants")
        .select(WORKING_HOURS_COLUMNS)
        .eq("id", tenant.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!tenant?.id,
  });

  const availability = useMemo(() => {
    if (!hoursRow || !now) return null;
    const tz = (hoursRow as any).timezone as string | null;
    const alwaysOpen = ((hoursRow as any).working_hours_always_open ?? true) as boolean;
    const { day, minutes } = zonedNow(tz, now);
    const today = scheduleForDay(hoursRow, day);
    const isOpen = alwaysOpen
      ? true
      : today.enabled &&
        minutes >= toMinutes(today.open) &&
        minutes < toMinutes(today.close);
    return {
      alwaysOpen,
      isOpen,
      today,
      timezone: tz,
      summary: buildAvailabilitySummary(hoursRow as any),
    };
  }, [hoursRow, now]);

  // ── Range + analytics ─────────────────────────────────────────────────────
  const [range, setRange] = useState<RangeKey>("7d");
  const spanDays = RANGE_DAYS[range];
  const granularity: "day" | "week" = spanDays > 31 ? "week" : "day";

  const bounds = useMemo(() => {
    const to = endOfDay(new Date());
    const from = startOfDay(subDays(to, spanDays - 1));
    return { from, to, prevFrom: startOfDay(subDays(from, spanDays)) };
  }, [spanDays]);

  const showRevenue = canView("payments") || canView("pl_dashboard");
  const showRentals = canView("rentals");
  const showFleet = canView("vehicles");

  const { data: kpis } = useDashboardKPIs();

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["dashboard-analytics", tenant?.id, range],
    queryFn: async () => {
      const fromDay = format(bounds.from, "yyyy-MM-dd");
      const toDay = format(bounds.to, "yyyy-MM-dd");

      const [created, starting, ending] = await Promise.all([
        // Both the current and the preceding window, so the chart can compare.
        supabase
          .from("rentals")
          .select(
            "created_at, monthly_amount, rental_period_type, vehicle_id, vehicle:vehicles(id, reg, make, model)"
          )
          .eq("tenant_id", tenant!.id)
          .gte("created_at", bounds.prevFrom.toISOString())
          .lte("created_at", bounds.to.toISOString()),
        supabase
          .from("rentals")
          .select("start_date")
          .eq("tenant_id", tenant!.id)
          .gte("start_date", fromDay)
          .lte("start_date", toDay),
        supabase
          .from("rentals")
          .select("end_date")
          .eq("tenant_id", tenant!.id)
          .gte("end_date", fromDay)
          .lte("end_date", toDay),
      ]);

      const bucketOf = (d: Date) =>
        format(granularity === "week" ? startOfWeek(d, { weekStartsOn: 1 }) : d, "yyyy-MM-dd");

      const orderedBuckets = (from: Date, to: Date) => {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const d of eachDayOfInterval({ start: from, end: to })) {
          const k = bucketOf(d);
          if (!seen.has(k)) {
            seen.add(k);
            out.push(k);
          }
        }
        return out;
      };

      const curBuckets = orderedBuckets(bounds.from, bounds.to);

      const labelFor = (key: string) =>
        granularity === "day" && spanDays <= 7
          ? format(parseISO(key), "EEE")
          : format(parseISO(key), "MMM d");

      const zero = () => new Map<string, number>();
      const curRevenue = zero();
      const prevRevenue = zero();
      const curBookings = zero();
      const planTotals = new Map<string, number>();
      const vehicleTotals = new Map<string, { label: string; revenue: number }>();
      let currentTotal = 0;
      let previousTotal = 0;

      for (const row of created.data ?? []) {
        if (!row.created_at) continue;
        const at = new Date(row.created_at);
        const amount = Number(row.monthly_amount) || 0;
        const isCurrent = at >= bounds.from;
        /**
         * A previous-period row is bucketed by its date shifted FORWARD one full
         * span, so it lands on the same key as the current-period bucket it is
         * being compared against.
         *
         * The obvious alternative — build a second bucket list for the previous
         * window and pair the two by index — is wrong once the buckets are
         * weeks. 90 mod 7 is 6, so the previous window starts on a different
         * weekday and can span 13 weeks where the current one spans 14; the
         * comparison series then silently slides by a week.
         */
        const key = bucketOf(isCurrent ? at : addDays(at, spanDays));

        if (isCurrent) {
          curRevenue.set(key, (curRevenue.get(key) || 0) + amount);
          curBookings.set(key, (curBookings.get(key) || 0) + 1);
          currentTotal += amount;

          const plan = (row.rental_period_type || "other").toLowerCase();
          planTotals.set(plan, (planTotals.get(plan) || 0) + amount);

          // Supabase returns the embed as an object for many-to-one, but an
          // array shape shows up depending on how the FK is resolved.
          const v: any = Array.isArray((row as any).vehicle)
            ? (row as any).vehicle[0]
            : (row as any).vehicle;
          if (v) {
            const label = [v.make, v.model].filter(Boolean).join(" ") || v.reg || "Unknown";
            const prev = vehicleTotals.get(v.id) || { label, revenue: 0 };
            vehicleTotals.set(v.id, { label, revenue: prev.revenue + amount });
          }
        } else {
          prevRevenue.set(key, (prevRevenue.get(key) || 0) + amount);
          previousTotal += amount;
        }
      }

      const revenueSeries = curBuckets.map((key) => ({
        label: labelFor(key),
        current: curRevenue.get(key) || 0,
        previous: prevRevenue.get(key) || 0,
      }));

      const bookingsSeries = curBuckets.map((key) => ({
        label: labelFor(key),
        bookings: curBookings.get(key) || 0,
      }));

      const planSeries = [...planTotals.entries()]
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([plan, value], i) => ({
          plan,
          label: plan.charAt(0).toUpperCase() + plan.slice(1),
          value,
          fill: PLAN_COLORS[i % PLAN_COLORS.length],
        }));

      const topVehicles = [...vehicleTotals.values()]
        .filter((v) => v.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
        .map((v) => ({ vehicle: v.label, revenue: v.revenue }));

      const pickups = zero();
      const returns = zero();
      for (const row of starting.data ?? []) {
        if (!row.start_date) continue;
        const k = bucketOf(new Date(row.start_date));
        pickups.set(k, (pickups.get(k) || 0) + 1);
      }
      for (const row of ending.data ?? []) {
        if (!row.end_date) continue;
        const k = bucketOf(new Date(row.end_date));
        returns.set(k, (returns.get(k) || 0) + 1);
      }
      const opsSeries = curBuckets.map((key) => ({
        label: labelFor(key),
        pickups: pickups.get(key) || 0,
        returns: returns.get(key) || 0,
      }));

      return {
        revenueSeries,
        bookingsSeries,
        planSeries,
        planTotal: planSeries.reduce((s, d) => s + d.value, 0),
        topVehicles,
        opsSeries,
        currentTotal,
        previousTotal,
      };
    },
    enabled: !!tenant?.id && (showRevenue || showRentals),
    staleTime: 5 * 60 * 1000,
  });

  const revenueDelta =
    analytics && analytics.previousTotal > 0
      ? ((analytics.currentTotal - analytics.previousTotal) / analytics.previousTotal) * 100
      : null;

  const money = (n: number) =>
    formatCurrency(n, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const utilisation = kpis?.fleetUtilization;
  const utilisationData = [
    { name: "used", value: utilisation?.percentage ?? 0, fill: "hsl(var(--chart-3))" },
  ];

  const showAnalyticsCard = showRevenue || showRentals || showFleet;

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-1 pb-1">
      {/*
        Operational alerts stay above the redesign. These are the banners that
        tell a tenant their credits are running out, or that Bonzah has made a
        decision on their onboarding — losing them to a visual refresh would be
        a functional regression, not a style change.
      */}
      <LowCreditsBanner />
      <BonzahStatusBanner />
      <BonzahPendingAlert />

      {/* Editorial hero */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            {greeting.text}
            {firstName ? `, ${firstName}` : ""}.{" "}
            <span className="align-middle">{greeting.emoji}</span>
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {dateStr}
              {timeStr && ` · ${timeStr}`}
            </span>
            {availability && (
              <HoverCard openDelay={100} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <span
                    className={`inline-flex cursor-default items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      availability.isOpen
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-border bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        availability.isOpen ? "bg-success" : "bg-muted-foreground/40"
                      }`}
                    />
                    {availability.isOpen ? "Open" : "Closed"}
                  </span>
                </HoverCardTrigger>
                <HoverCardContent align="start" className="w-72">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Booking availability</span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          availability.isOpen
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-border bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            availability.isOpen ? "bg-success" : "bg-muted-foreground/40"
                          }`}
                        />
                        {availability.isOpen ? "Open now" : "Closed"}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">Today</span>
                        <span className="text-right font-medium">
                          {availability.alwaysOpen
                            ? "Open 24 hours"
                            : availability.today.enabled
                              ? `${formatTime12(availability.today.open)} – ${formatTime12(
                                  availability.today.close
                                )}`
                              : "Closed"}
                        </span>
                      </div>
                      {availability.summary && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">Weekly</span>
                          <span className="text-right font-medium">{availability.summary}</span>
                        </div>
                      )}
                      {availability.timezone && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">Timezone</span>
                          <span className="text-right font-medium">{availability.timezone}</span>
                        </div>
                      )}
                    </div>

                    {canEdit("availability") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5"
                        onClick={() => router.push("/blocked-dates")}
                      >
                        <Pencil className="size-3.5" /> Edit availability
                      </Button>
                    )}
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* One slot, two states. While setup is unfinished the guide holds
              the primary position; the moment the operator finishes it the
              guide disappears and New Rental — the button they'll press every
              day from then on — takes the slot back. */}
          {setupGuideVisible ? (
            <SetupGuide />
          ) : (
            canEdit("rentals") && (
              <Button
                size="lg"
                className="gap-2 rounded-full"
                onClick={() => router.push("/rentals/new")}
              >
                <Plus className="size-4" /> New Rental
              </Button>
            )
          )}
        </div>
      </div>

      {/* What's new — sits below the hero rather than in it, because the hero's
          right slot already carries the day's primary action. Renders nothing at
          all when there is no live announcement, so the dashboard does not keep
          a hole open for it. */}
      <AnnouncementStack className="ml-auto w-fit" />

      {/* Analytics */}
      {showAnalyticsCard && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">
                {showRevenue ? "Revenue" : "Activity"}
              </CardTitle>
              {showRevenue && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  {analyticsLoading ? (
                    <Skeleton className="h-4 w-32" />
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">
                        {money(analytics?.currentTotal ?? 0)}
                      </span>
                      this period
                      {revenueDelta !== null && (
                        <span
                          className={`inline-flex items-center gap-0.5 ${
                            revenueDelta >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {revenueDelta >= 0 ? (
                            <TrendingUp className="size-3.5" />
                          ) : (
                            <TrendingDown className="size-3.5" />
                          )}
                          {Math.abs(Math.round(revenueDelta))}%
                        </span>
                      )}
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-full border bg-card p-0.5 text-xs">
              {(Object.keys(RANGE_DAYS) as RangeKey[]).map((key) => (
                <Button
                  key={key}
                  variant="ghost"
                  size="sm"
                  onClick={() => setRange(key)}
                  className={`h-auto rounded-full px-3 py-1 text-xs font-medium ${
                    range === key
                      ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {key}
                </Button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Revenue — this period vs the one before it */}
            {showRevenue &&
              (analyticsLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : analytics?.currentTotal || analytics?.previousTotal ? (
                <ChartContainer config={revenueConfig} className="h-[260px] w-full">
                  <AreaChart data={analytics.revenueSeries} margin={{ left: 4, right: 12, top: 8 }}>
                    <defs>
                      <linearGradient id="fillCurrent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-current)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="var(--color-current)" stopOpacity={0.04} />
                      </linearGradient>
                      <linearGradient id="fillPrevious" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-previous)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-previous)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={10}
                      minTickGap={24}
                      interval="preserveStartEnd"
                    />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                    <Area
                      dataKey="previous"
                      type="natural"
                      stroke="var(--color-previous)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      fill="url(#fillPrevious)"
                    />
                    <Area
                      dataKey="current"
                      type="natural"
                      stroke="var(--color-current)"
                      strokeWidth={2.5}
                      fill="url(#fillCurrent)"
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <EmptyChart height={260} message="No revenue recorded in this period yet." />
              ))}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Bookings */}
              {showRentals && (
                <div>
                  <div className="mb-3 text-sm font-medium">Bookings</div>
                  {analyticsLoading ? (
                    <Skeleton className="h-[220px] w-full" />
                  ) : analytics?.bookingsSeries?.some((d) => d.bookings > 0) ? (
                    <ChartContainer config={bookingsConfig} className="h-[220px] w-full">
                      <BarChart data={analytics.bookingsSeries} margin={{ top: 8 }}>
                        <defs>
                          <linearGradient id="fillBookings" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-bookings)" stopOpacity={1} />
                            <stop offset="100%" stopColor="var(--color-bookings)" stopOpacity={0.45} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={10}
                          minTickGap={16}
                          interval="preserveStartEnd"
                        />
                        <ChartTooltip cursor={{ fillOpacity: 0.1 }} content={<ChartTooltipContent />} />
                        <Bar
                          dataKey="bookings"
                          fill="url(#fillBookings)"
                          radius={[8, 8, 0, 0]}
                          maxBarSize={26}
                        />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <EmptyChart height={220} message="No bookings in this period yet." />
                  )}
                </div>
              )}

              {/* Revenue by plan */}
              {showRevenue && (
                <div>
                  <div className="mb-3 text-sm font-medium">Revenue by plan</div>
                  {analyticsLoading ? (
                    <Skeleton className="h-[200px] w-full" />
                  ) : analytics?.planSeries?.length ? (
                    <div className="flex items-center gap-2">
                      <ChartContainer
                        config={{ value: { label: "Revenue" } } satisfies ChartConfig}
                        className="mx-auto aspect-square h-[200px]"
                      >
                        <PieChart>
                          <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent nameKey="label" hideLabel />}
                          />
                          <Pie
                            data={analytics.planSeries}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={58}
                            outerRadius={84}
                            strokeWidth={4}
                            paddingAngle={3}
                          >
                            {analytics.planSeries.map((entry) => (
                              <Cell key={entry.plan} fill={entry.fill} className="stroke-card" />
                            ))}
                            <Label
                              content={({ viewBox }) => {
                                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                  return (
                                    <text
                                      x={viewBox.cx}
                                      y={viewBox.cy}
                                      textAnchor="middle"
                                      dominantBaseline="middle"
                                    >
                                      <tspan
                                        x={viewBox.cx}
                                        y={viewBox.cy}
                                        className="fill-foreground text-xl font-semibold"
                                      >
                                        {money(analytics.planTotal)}
                                      </tspan>
                                      <tspan
                                        x={viewBox.cx}
                                        y={(viewBox.cy || 0) + 20}
                                        className="fill-muted-foreground text-xs"
                                      >
                                        total
                                      </tspan>
                                    </text>
                                  );
                                }
                                return null;
                              }}
                            />
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                      <div className="space-y-2 pr-2">
                        {analytics.planSeries.map((entry) => (
                          <div key={entry.plan} className="flex items-center gap-2 text-sm">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ background: entry.fill }}
                            />
                            <span className="text-muted-foreground">{entry.label}</span>
                            <span className="ml-auto font-medium tabular-nums">
                              {money(entry.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyChart height={200} message="No revenue to break down yet." />
                  )}
                </div>
              )}

              {/* Fleet utilisation */}
              {showFleet && (
                <div>
                  <div className="mb-3 text-sm font-medium">Fleet utilisation</div>
                  {!utilisation ? (
                    <Skeleton className="h-[200px] w-full" />
                  ) : utilisation.total === 0 ? (
                    <EmptyChart height={200} message="No vehicles in the fleet yet." />
                  ) : (
                    <div className="flex items-center gap-4">
                      <div className="relative mx-auto h-[200px] w-[200px] shrink-0">
                        <ChartContainer config={utilisationConfig} className="h-full w-full">
                          <RadialBarChart
                            data={utilisationData}
                            innerRadius={72}
                            outerRadius={102}
                            startAngle={90}
                            endAngle={-270}
                          >
                            <PolarAngleAxis
                              type="number"
                              domain={[0, 100]}
                              tick={false}
                              axisLine={false}
                            />
                            <RadialBar
                              dataKey="value"
                              background={{ fill: "hsl(var(--muted))" }}
                              cornerRadius={14}
                            />
                          </RadialBarChart>
                        </ChartContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-semibold">
                            {Math.round(utilisation.percentage)}%
                          </span>
                          <span className="text-xs text-muted-foreground">on the road</span>
                        </div>
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="font-medium">
                          {utilisation.rented} of {utilisation.total} vehicles
                        </div>
                        <div className="text-muted-foreground">
                          {utilisation.available} available now
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Top vehicles by revenue */}
              {showRevenue && showFleet && (
                <div>
                  <div className="mb-3 text-sm font-medium">Top vehicles by revenue</div>
                  {analyticsLoading ? (
                    <Skeleton className="h-[220px] w-full" />
                  ) : analytics?.topVehicles?.length ? (
                    <ChartContainer config={topVehiclesConfig} className="h-[220px] w-full">
                      <BarChart
                        data={analytics.topVehicles}
                        layout="vertical"
                        margin={{ left: 0, right: 56, top: 4 }}
                      >
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <YAxis
                          dataKey="vehicle"
                          type="category"
                          tickLine={false}
                          axisLine={false}
                          width={104}
                          fontSize={12}
                        />
                        <XAxis type="number" hide />
                        <ChartTooltip cursor={{ fillOpacity: 0.1 }} content={<ChartTooltipContent />} />
                        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={6} maxBarSize={18}>
                          <LabelList
                            dataKey="revenue"
                            position="right"
                            offset={8}
                            className="fill-muted-foreground"
                            fontSize={11}
                            formatter={(v: number) => money(v)}
                          />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <EmptyChart height={220} message="No vehicle revenue in this period yet." />
                  )}
                </div>
              )}

              {/* Pickups vs returns */}
              {showRentals && (
                <div>
                  <div className="mb-3 text-sm font-medium">Pickups vs returns</div>
                  {analyticsLoading ? (
                    <Skeleton className="h-[220px] w-full" />
                  ) : analytics?.opsSeries?.some((d) => d.pickups > 0 || d.returns > 0) ? (
                    <ChartContainer config={opsConfig} className="h-[220px] w-full">
                      <BarChart data={analytics.opsSeries} margin={{ top: 8 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={10}
                          minTickGap={16}
                          interval="preserveStartEnd"
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar
                          dataKey="pickups"
                          stackId="a"
                          fill="var(--color-pickups)"
                          radius={[0, 0, 4, 4]}
                          maxBarSize={26}
                        />
                        <Bar
                          dataKey="returns"
                          stackId="a"
                          fill="var(--color-returns)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={26}
                        />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <EmptyChart height={220} message="No pickups or returns in this period yet." />
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
