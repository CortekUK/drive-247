"use client";

/**
 * The hero-tab graph: one simple line, the way Stripe's home chart is one line.
 *
 * The team lead's brief for the Rentals, Customers and Vehicles tabs was a
 * single graph across ~75% of the row, "extremely simple, like Stripe's",
 * because complicated graphs never get read. So this draws exactly one thing:
 * the chosen metric for the chosen period as a solid line, the period before it
 * as a faint dotted line, the two totals as numbers above, and a label at each
 * end of the axis. No grid, no y-axis, no legend, no second panel.
 *
 * The numbers come from lib/hero-series.ts, pure functions of the rows the page
 * already fetched, so nothing drawn here can disagree with the table below it.
 *
 * v2 only; mounted inside each hero tab's overview.
 */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Line, LineChart, ReferenceLine, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import {
  HERO_RANGES,
  flowSeries,
  stockSeries,
  type HeroEvent,
  type HeroPoint,
  type HeroRange,
} from "@/lib/hero-series";

interface MetricBase {
  key: string;
  /** "Booked value", "New customers", "Cars on rent" */
  label: string;
  /** Plain-language definition, shown on hover over the number. */
  description?: string;
  format: (value: number) => string;
  /** Words after the headline number, e.g. "of 8 cars". */
  suffix?: string;
}

export type HeroMetric =
  | (MetricBase & { kind: "flow"; events: readonly HeroEvent[] })
  | (MetricBase & { kind: "stock"; valueOn: (day: Date) => number });

const chartConfig: ChartConfig = {
  // Dark mode's --primary is a deep indigo that all but disappears on the
  // near-black ground, so the line switches to the brighter chart indigo there.
  current: { label: "This period", theme: { light: "hsl(var(--primary))", dark: "hsl(var(--chart-2))" } },
  previous: { label: "Previous period", color: "hsl(var(--muted-foreground))" },
};

const PICKER =
  "inline-flex items-center gap-1 rounded-md text-sm font-medium text-foreground outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring";

export function HeroChart({
  metrics,
  defaultMetric,
  defaultRange = "30d",
  note,
  anchor,
  today,
}: {
  metrics: readonly HeroMetric[];
  defaultMetric?: string;
  defaultRange?: HeroRange;
  /** A small chip beside the range picker, e.g. "Filtered". */
  note?: ReactNode;
  /** data-tour anchor on the metric label and numbers (always rendered, small). */
  anchor?: string;
  /** For tests. Defaults to the moment the chart mounts. */
  today?: Date;
}) {
  const [metricKey, setMetricKey] = useState(defaultMetric ?? metrics[0]?.key);
  const [range, setRange] = useState<HeroRange>(defaultRange);
  const now = useMemo(() => today ?? new Date(), [today]);

  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const series = useMemo(() => {
    if (!metric) return null;
    return metric.kind === "flow"
      ? flowSeries(metric.events, range, now)
      : stockSeries(metric.valueOn, range, now);
  }, [metric, range, now]);

  if (!metric || !series) return null;
  const rangeInfo = HERO_RANGES.find((r) => r.key === range) ?? HERO_RANGES[1];
  // A running total (flow) only climbs, so a smooth curve reads true. A daily
  // level (stock), such as cars on rent, is a whole number per day: a smooth
  // curve would bend between days and suggest "2.5 cars", so it steps.
  const curve = metric.kind === "stock" ? "stepAfter" : "monotone";

  return (
    <section className="flex flex-col gap-3" aria-label={`${metric.label}, ${rangeInfo.label.toLowerCase()}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex flex-wrap items-start gap-x-12 gap-y-3" data-tour={anchor}>
          <div className="flex flex-col gap-1.5">
            {metrics.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger className={PICKER} aria-label={`Metric: ${metric.label}`}>
                  {metric.label}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup value={metric.key} onValueChange={setMetricKey}>
                    {metrics.map((m) => (
                      <DropdownMenuRadioItem key={m.key} value={m.key}>
                        {m.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-sm font-medium text-foreground">{metric.label}</span>
            )}
            <div className="flex items-baseline gap-2" title={metric.description}>
              <span className="font-heading text-3xl leading-none tracking-tight tabular-nums">
                {metric.format(series.currentTotal)}
              </span>
              {metric.suffix && <span className="text-sm text-muted-foreground">{metric.suffix}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">{rangeInfo.compareLabel}</span>
            <span className="font-heading text-xl leading-none tracking-tight tabular-nums text-muted-foreground">
              {metric.format(series.previousTotal)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {note && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {note}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger className={PICKER} aria-label={`Period: ${rangeInfo.label}`}>
              {rangeInfo.label}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={range} onValueChange={(v) => setRange(v as HeroRange)}>
                {HERO_RANGES.map((r) => (
                  <DropdownMenuRadioItem key={r.key} value={r.key}>
                    {r.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* An explicit height: ChartContainer is aspect-video by default, and the
          overview flip measures this face, so it must not depend on its width. */}
      <ChartContainer config={chartConfig} className="aspect-auto h-[160px] w-full">
        <LineChart data={series.points} margin={{ top: 8, right: 4, bottom: 4, left: 4 }}>
          {/* Never a zero-height scale: an empty period draws a flat baseline. */}
          <YAxis hide domain={[0, (dataMax: number) => Math.max(1, dataMax)]} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ChartTooltip
            cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
            content={<HeroTooltip metric={metric} />}
          />
          <Line
            dataKey="previous"
            type={curve}
            stroke="var(--color-previous)"
            strokeOpacity={0.6}
            strokeWidth={2}
            strokeDasharray="2 4"
            strokeLinecap="round"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="current"
            type={curve}
            stroke="var(--color-current)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>

      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{series.startLabel}</span>
        <span>{series.endLabel}</span>
      </div>

      <p className="sr-only">
        {`${metric.label}, ${rangeInfo.label.toLowerCase()}: ${metric.format(series.currentTotal)}. ${rangeInfo.compareLabel}: ${metric.format(series.previousTotal)}.`}
      </p>
    </section>
  );
}

function HeroTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: { payload: HeroPoint }[];
  metric: HeroMetric;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="min-w-[190px] rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: "var(--color-current)" }} aria-hidden />
        <span className="text-muted-foreground">{point.currentLabel}</span>
        <span className="ml-auto pl-3 font-medium tabular-nums">{metric.format(point.current)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-3 shrink-0 border-t-2 border-dotted border-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">{point.previousLabel}</span>
        <span className="ml-auto pl-3 tabular-nums text-muted-foreground">{metric.format(point.previous)}</span>
      </div>
    </div>
  );
}

/**
 * The hero row: the graph across three quarters, a featured card in the last.
 * With no card (nothing on offer that this viewer may open), the graph takes the
 * whole row rather than leaving an empty quarter.
 *
 * A CARD THAT DECIDES FOR ITSELF. The featured deck
 * (components/shared/featured-deck-v2.tsx) only knows whether it has anything
 * to show once its own gates and the announcements read have resolved, so the
 * tab cannot know up front, and a `card` element that renders nothing used to
 * leave that empty quarter. So a provided card now sits in a `display:
 * contents` wrapper, which has no box of its own (the card is still the grid
 * item, laid out exactly as before), and while that wrapper is EMPTY the chart
 * spans all four columns. That is CSS (`:has(> [data-hero-card]:empty)`), not a
 * measured flag, so there is no frame where the row is laid out wrong. Pass the
 * deck directly as `card`: wrapping it in another element defeats `:empty`.
 */
export function HeroRow({ chart, card }: { chart: ReactNode; card?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 py-2 lg:grid-cols-4 lg:[&:has(>[data-hero-card]:empty)>[data-hero-chart]]:col-span-4">
      <div data-hero-chart="" className={card ? "min-w-0 lg:col-span-3" : "min-w-0 lg:col-span-4"}>
        {chart}
      </div>
      {card ? (
        <div data-hero-card="" className="contents">
          {card}
        </div>
      ) : null}
    </div>
  );
}
