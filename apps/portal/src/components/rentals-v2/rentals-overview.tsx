"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Cell, Label as RLabel, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui-v2/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { EnhancedRental, RentalStats } from "@/hooks/use-enhanced-rentals";

/**
 * The overview row that sits above the rentals table.
 *
 * Four cards: where the list stands by status, how many rentals came in over
 * the last six months, what they were booked at, and a way through to the
 * calendar.
 *
 * EVERY NUMBER HERE IS REAL. The design this is ported from charted hardcoded
 * arrays — a fixed six-month trend and a fixed "$36k revenue" — which is
 * defensible in a design branch and is not defensible on a screen a paying
 * operator reads as fact. Each series is instead derived from the rentals the
 * page already fetched, so nothing on this row can say something the table
 * below it does not.
 *
 * TENANT SCOPE (V2_PLAN §5): this component issues no query at all. `stats` and
 * `rentals` both come from `useEnhancedRentals`, whose base query filters
 * `.eq("tenant_id", tenant.id)` — so every count, bar and slice here is, by
 * construction, this tenant's and only this tenant's.
 *
 * These are the FILTERED rentals, deliberately: the row describes the list you
 * are looking at, exactly as v1's four stat tiles did. Narrow the list and the
 * row narrows with it.
 *
 * The third card is called "Booked value", not "Revenue". It sums
 * `total_amount` — what the rentals were written for — which is not the same
 * thing as money collected, and there is no honest way to call it that.
 */

interface Props {
  stats: RentalStats | null;
  /** The full filtered set (`allRentals`), not the current page. */
  rentals: EnhancedRental[];
  currencySymbol: string;
  onOpenCalendar: () => void;
}

/** How far the two trend charts look back. */
const MONTHS = 6;

/**
 * The status palette, and deliberately the same three values the filter chips
 * and the table's own badges use — a slice should be the colour of the thing it
 * counts.
 *
 * Written as literals rather than `hsl(var(--chart-N))` so the row does not
 * depend on the `theme` gate also being on for this tenant: `--chart-1..5` are
 * defined only under `.v2-theme`, and a chart whose colours resolve to nothing
 * renders as invisible slices with no error.
 */
const STATUS_SERIES = [
  { key: "active", label: "Active", color: "#16a34a" },
  { key: "completed", label: "Completed", color: "#64748b" },
  { key: "pending", label: "Pending", color: "#d97706" },
] as const;

const statusConfig: ChartConfig = {
  active: { label: "Active", color: "#16a34a" },
  completed: { label: "Completed", color: "#64748b" },
  pending: { label: "Pending", color: "#d97706" },
};

const trendConfig: ChartConfig = {
  count: { label: "Rentals", color: "hsl(var(--primary))" },
};

const valueConfig: ChartConfig = {
  value: { label: "Booked", color: "hsl(var(--primary))" },
};

/**
 * Rentals bucketed into the last `MONTHS` calendar months by `created_at`.
 *
 * Buckets are built first and then filled, so a month with no rentals is a zero
 * rather than a gap — a trend line that silently skips July reads as a shorter
 * period rather than as a quiet one.
 */
function monthlySeries(rentals: EnhancedRental[]) {
  const now = new Date();
  const buckets: { key: string; m: string; count: number; value: number }[] = [];
  const index = new Map<string, number>();

  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    index.set(key, buckets.length);
    buckets.push({
      key,
      m: d.toLocaleString(undefined, { month: "short" }),
      count: 0,
      value: 0,
    });
  }

  for (const rental of rentals) {
    if (!rental.created_at) continue;
    const d = new Date(rental.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const at = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (at === undefined) continue;
    buckets[at].count += 1;
    buckets[at].value += Number(rental.total_amount) || 0;
  }

  return buckets;
}

/** `$8.3k` / `$820`. Kept short because it sits on one line under a mini-label. */
function compactMoney(value: number, symbol: string) {
  if (value >= 1000) {
    return `${symbol}${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return `${symbol}${Math.round(value)}`;
}

export function RentalsOverview({ stats, rentals, currencySymbol, onOpenCalendar }: Props) {
  const series = useMemo(() => monthlySeries(rentals), [rentals]);

  // v1 rendered nothing at all when there were no stats; keep that, so the
  // page's vertical rhythm on an empty tenant is the one it already had.
  if (!stats) return null;

  const statusData = STATUS_SERIES.map((s) => ({
    ...s,
    value:
      s.key === "active" ? stats.active : s.key === "completed" ? stats.closed : stats.pending,
  }));
  // Active + Completed + Pending is not always the whole list (Upcoming,
  // Cancelled and Rejected exist too), so the donut is drawn against what it
  // actually plots and `stats.total` is reported separately in the centre.
  const plotted = statusData.reduce((sum, d) => sum + d.value, 0);

  const newCount = series.reduce((sum, d) => sum + d.count, 0);
  const bookedValue = series.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1 — Status donut */}
      <Card className="shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">By status</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center pt-0">
          {plotted > 0 ? (
            <ChartContainer config={statusConfig} className="aspect-square h-[112px]">
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent nameKey="label" hideLabel />}
                />
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={36}
                  outerRadius={52}
                  cornerRadius={4}
                  strokeWidth={3}
                  paddingAngle={4}
                >
                  {statusData.map((d) => (
                    <Cell key={d.key} fill={d.color} className="stroke-card" />
                  ))}
                  <RLabel
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
                              className="fill-foreground text-xl font-bold"
                            >
                              {stats.total}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) + 15}
                              className="fill-muted-foreground text-[10px]"
                            >
                              rentals
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
          ) : (
            <div className="flex h-[112px] flex-col items-center justify-center">
              <span className="text-xl font-bold">{stats.total}</span>
              <span className="text-[10px] text-muted-foreground">rentals</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2 — New rentals, by month created */}
      <Card className="shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">New rentals</CardTitle>
          <p className="text-xl font-bold">
            {newCount}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">last 6 months</span>
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <ChartContainer config={trendConfig} className="h-[78px] w-full">
            <AreaChart data={series} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
              <defs>
                <linearGradient id="rentalsV2FillTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelKey="m" />} />
              <Area
                dataKey="count"
                type="natural"
                stroke="var(--color-count)"
                strokeWidth={2.5}
                fill="url(#rentalsV2FillTrend)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* 3 — Booked value, by month created */}
      <Card className="shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">Booked value</CardTitle>
          <p className="text-xl font-bold">
            {compactMoney(bookedValue, currencySymbol)}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">last 6 months</span>
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <ChartContainer config={valueConfig} className="h-[78px] w-full">
            <BarChart data={series} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
              <defs>
                <linearGradient id="rentalsV2FillValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-value)" stopOpacity={1} />
                  <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <ChartTooltip
                cursor={{ fillOpacity: 0.1 }}
                content={<ChartTooltipContent labelKey="m" />}
              />
              <Bar dataKey="value" fill="url(#rentalsV2FillValue)" radius={6} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* 4 — Calendar view */}
      <button
        type="button"
        onClick={onOpenCalendar}
        className="group relative flex cursor-pointer flex-col justify-end overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 text-left text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/15"
      >
        <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-primary/15 blur-2xl transition-all duration-300 group-hover:bg-primary/25" />
        <span className="pointer-events-none absolute -bottom-10 -left-6 size-24 rounded-full bg-primary/10 blur-2xl" />
        {/* Faint fleet-timeline preview — fills the body, echoes the Gantt view.
            `playhead-scan` and `timeline-grow` are real keyframes: they live in
            styles/v2-theme.css, which the root layout puts on <body> for the
            same gated tenants that reach this screen. */}
        <div className="pointer-events-none absolute inset-x-5 top-[38%] -translate-y-1/2 opacity-80 transition-opacity duration-300 group-hover:opacity-100">
          <span
            className="absolute -top-2 bottom-[-0.5rem] w-px bg-primary/60 shadow-[0_0_8px_hsl(var(--primary)/0.5)]"
            style={{ animation: "playhead-scan 4s ease-in-out infinite" }}
          >
            <span className="absolute -left-[3px] -top-1 size-[7px] rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
          </span>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-7 rounded-full bg-primary/20" />
              <span
                className="h-1.5 flex-[3] origin-left rounded-full bg-primary/60"
                style={{ animation: "timeline-grow 3.6s ease-in-out infinite" }}
              />
              <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-12 rounded-full bg-primary/20" />
              <span
                className="h-1.5 flex-1 origin-left rounded-full bg-primary/45"
                style={{
                  animation: "timeline-grow 3.6s ease-in-out infinite",
                  animationDelay: "0.45s",
                }}
              />
              <span className="h-1.5 flex-[2] rounded-full bg-primary/15" />
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 flex-[2] origin-left rounded-full bg-primary/50"
                style={{
                  animation: "timeline-grow 3.6s ease-in-out infinite",
                  animationDelay: "0.9s",
                }}
              />
              <span className="h-1.5 flex-[3] rounded-full bg-primary/15" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-5 rounded-full bg-primary/20" />
              <span
                className="h-1.5 flex-[2] origin-left rounded-full bg-primary/40"
                style={{
                  animation: "timeline-grow 3.6s ease-in-out infinite",
                  animationDelay: "1.35s",
                }}
              />
              <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
            </div>
          </div>
        </div>
        <div className="relative">
          <div className="mt-3 text-lg font-bold tracking-tight">Calendar View</div>
          <div className="text-sm text-muted-foreground">See your fleet on a timeline</div>
        </div>
        <ArrowRight
          className="absolute right-4 top-4 size-5 text-primary"
          style={{ animation: "arrow-nudge 4s ease-in-out infinite" }}
        />
      </button>
    </div>
  );
}
