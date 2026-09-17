"use client";

/**
 * The hero-tab graph, drawn the way Stripe draws its home chart: a headline
 * number, a quiet comparison, and a short chart with nothing around it.
 *
 * The team lead's brief for the Rentals, Customers and Vehicles tabs was one
 * graph across ~75% of the row, "extremely simple, like Stripe's", because
 * complicated graphs never get read. Their second pass (Sep 15 2026) asked for
 * it shorter with the axis labels gone, the headline numbers put up "a bit
 * differently", and "a bit more" inside the graph without making it flashy: a
 * primary line and one more. So it draws, and draws only:
 *   - the chosen metric for the chosen period, as a solid line;
 *   - optionally a SECOND solid line in a lighter tint of the same colour: a
 *     companion measure in the same unit (rentals picked up beside rentals
 *     booked, verified beside new customers, the fleet beside cars on rent),
 *     named in a small legend with its own total;
 *   - the period before it as a faint dotted line.
 * Above the chart: the number and a change chip against the previous period on
 * the left; on the right one legend, every entry drawn alike, naming each line:
 * the metric, the second line with its total, and the previous period with its
 * total ("Previous 30 days $522"). No grid, no axes, no end labels.
 *
 * "All time" (offered only when every metric can draw it) has no period before
 * it, so it draws no chip, no previous legend entry and no dotted line.
 *
 * The numbers come from lib/hero-series.ts, pure functions of the rows the page
 * already fetched, so nothing drawn here can disagree with the table below it.
 *
 * v2 only; mounted inside each hero tab's overview.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Minus } from "lucide-react";
import { Line, LineChart, ReferenceLine, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  HERO_RANGES,
  earliestEventDay,
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

/**
 * The second line. Same kind and same unit as its metric (it shares the y
 * scale and the formatter), so it can never be a different quantity drawn on
 * the same axis.
 */
interface SecondaryBase {
  /** "Picked up", "Verified", "Fleet" */
  label: string;
}

export type HeroMetric =
  | (MetricBase & {
      kind: "flow";
      events: readonly HeroEvent[];
      secondary?: SecondaryBase & { events: readonly HeroEvent[] };
    })
  | (MetricBase & {
      kind: "stock";
      valueOn: (day: Date) => number;
      secondary?: SecondaryBase & { valueOn: (day: Date) => number };
      /**
       * The first day `valueOn` (and the second line's) has real history for.
       * Without it the metric cannot say where "all time" starts, so "All time"
       * is not offered. Vehicles leaves it out: its rentals read covers 24 months.
       */
      historyStart?: Date;
    });

/** A point as drawn: the series point, plus the second line's value when there is one. */
type ChartPoint = HeroPoint & { secondary?: number };

/**
 * The chart's height. Shared with any placeholder that stands in for the chart
 * while its data loads, so the row does not jump when the chart lands. Explicit
 * because ChartContainer is aspect-video by default, and the overview flip
 * measures this face, so it must not depend on its width.
 */
export const HERO_CHART_HEIGHT = "h-[140px]";

const chartConfig: ChartConfig = {
  // Dark mode's --primary is a deep indigo that all but disappears on the
  // near-black ground, so the lines switch to the brighter chart indigo there.
  current: { label: "This period", theme: { light: "hsl(var(--primary))", dark: "hsl(var(--chart-2))" } },
  // A lighter tint of the same colour: clearly a second series, never a
  // competing one. On the near-black dark ground a see-through --chart-2 sank
  // below the dotted line, so dark mode takes the palest chart indigo instead.
  secondary: { label: "Second line", theme: { light: "hsl(var(--primary) / 0.4)", dark: "hsl(var(--chart-1) / 0.6)" } },
  previous: { label: "Previous period", color: "hsl(var(--muted-foreground))" },
};

/**
 * The legend's swatches sit outside ChartContainer, where its --color-* custom
 * properties are not defined, so they carry the same colours as classes.
 */
const SWATCH = {
  current: "h-0.5 w-3 rounded-full bg-primary dark:bg-[hsl(var(--chart-2))]",
  secondary: "h-0.5 w-3 rounded-full bg-primary/40 dark:bg-[hsl(var(--chart-1)/0.6)]",
  // The dotted line, drawn as the tooltip draws it.
  previous: "w-3 border-t-2 border-dotted border-muted-foreground",
};

const PICKER =
  "inline-flex items-center gap-1 rounded-md text-sm font-medium text-foreground outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The period picker. With no card beside the graph it sits flush with the row's
 * right edge, where the overview flip clips (overflow-hidden), and an outer
 * focus ring lost its right side there. So its ring is drawn INSIDE the button:
 * 6px of padding on the left and 2px above and below, each taken back by a
 * negative margin, so the text sits exactly where it did and the ring clears
 * it. On the right the ring falls in the chevron's own blank margin.
 */
const RANGE_PICKER = `${PICKER} -my-0.5 -ml-1.5 py-0.5 pl-1.5 focus-visible:ring-inset`;

/** "All time" needs a first day: a flow metric has its events, a stock metric must say. */
function supportsAllTime(metric: HeroMetric): boolean {
  if (metric.kind === "flow") return true;
  return metric.historyStart instanceof Date && !Number.isNaN(metric.historyStart.getTime());
}

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
  /** data-tour anchor on the headline: the metric, the period and the numbers (always rendered). */
  anchor?: string;
  /**
   * The day the windows end on. Without it, the clock is read on every render,
   * so a list that refetches after midnight is charted against the new day, and
   * useDayRollover re-renders a page left open with no data change.
   */
  today?: Date;
}) {
  const [metricKey, setMetricKey] = useState(defaultMetric ?? metrics[0]?.key);
  const [chosenRange, setRange] = useState<HeroRange>(defaultRange);
  useDayRollover(!today);
  // The series depend only on the calendar day, so they are recomputed when the
  // day changes, not on every render.
  const dayKey = startOfDay(today ?? new Date()).getTime();

  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  // "All time" is offered only when every metric can draw it, so switching
  // metric never lands on one that cannot. Should the metrics change under a
  // chosen "All time" to ones that cannot, the chart shows the default period.
  const allTimeOffered = metrics.length > 0 && metrics.every(supportsAllTime);
  const fallbackRange: HeroRange = defaultRange === "all" ? "30d" : defaultRange;
  const range: HeroRange =
    chosenRange === "all" && !(allTimeOffered && metric && supportsAllTime(metric)) ? fallbackRange : chosenRange;

  const series = useMemo(() => {
    if (!metric) return null;
    const day = new Date(dayKey);
    // "All time" starts from ONE day for both lines, the earliest of either (a
    // stock metric's history start), so their buckets are the same.
    const since =
      range !== "all"
        ? undefined
        : metric.kind === "flow"
          ? earliestEventDay([metric.events, metric.secondary?.events ?? []], day)
          : metric.historyStart;
    const options = { since };
    const main =
      metric.kind === "flow"
        ? flowSeries(metric.events, range, day, options)
        : stockSeries(metric.valueOn, range, day, options);
    // Same range, same day, same `since`: the second series has exactly the same
    // buckets, so its points line up with the main ones index for index.
    const second =
      metric.kind === "flow"
        ? metric.secondary && flowSeries(metric.secondary.events, range, day, options)
        : metric.secondary && stockSeries(metric.secondary.valueOn, range, day, options);
    const points: ChartPoint[] = second
      ? main.points.map((p, i) => ({ ...p, secondary: second.points[i]?.current ?? 0 }))
      : main.points;
    return { ...main, points, secondaryTotal: second ? second.currentTotal : null };
  }, [metric, range, dayKey]);

  if (!metric || !series) return null;
  const rangeInfo = HERO_RANGES.find((r) => r.key === range) ?? HERO_RANGES[1];
  const secondaryLabel = metric.secondary?.label ?? null;
  // A running total (flow) only climbs, so a smooth curve reads true. A level
  // (stock), such as cars on rent, holds one value per day, week or month, so it
  // steps. "step" changes value halfway between two points, which is exactly
  // where the tooltip hands over from one point to the next: the level under
  // the pointer is always the one the tooltip names.
  const curve = metric.kind === "stock" ? "step" : "monotone";
  // A level has no total over a period. So for a stock metric the headline is
  // named as today's (on every range, All time included), and the comparison as
  // the one day it was read on ("On Aug 16"), not as "Previous 30 days". Flow
  // metrics are unchanged.
  const isStock = metric.kind === "stock";
  const previousDay = isStock ? series.previousDay : undefined;
  const headlineLabel = isStock ? `${metric.label} today` : metric.label;
  // Null when there is nothing to compare with (All time).
  const previousTotal = series.hasPrevious ? series.previousTotal : null;
  const compareLabel =
    previousTotal === null
      ? null
      : previousDay
        ? `On ${format(previousDay, previousDay.getFullYear() === new Date(dayKey).getFullYear() ? "MMM d" : "MMM d, yyyy")}`
        : rangeInfo.compareLabel;
  const secondaryText =
    secondaryLabel && series.secondaryTotal !== null
      ? isStock
        ? ` ${secondaryLabel} today: ${metric.format(series.secondaryTotal)}.`
        : ` ${secondaryLabel}, ${rangeInfo.label.toLowerCase()}: ${metric.format(series.secondaryTotal)}.`
      : "";
  // " Previous 30 days: 4." or " On Aug 16: 1.", and nothing on All time.
  const previousSentence =
    compareLabel !== null && previousTotal !== null ? ` ${compareLabel}: ${metric.format(previousTotal)}.` : "";
  // The legend, one entry per line drawn. The main line carries no value: the
  // big number is its value.
  const legend: LegendEntryProps[] = [{ swatch: SWATCH.current, label: metric.label }];
  if (secondaryLabel && series.secondaryTotal !== null) {
    legend.push({ swatch: SWATCH.secondary, label: secondaryLabel, value: metric.format(series.secondaryTotal) });
  }
  if (compareLabel !== null && previousTotal !== null) {
    legend.push({ swatch: SWATCH.previous, label: compareLabel, value: metric.format(previousTotal) });
  }

  return (
    <section className="flex flex-col gap-3" aria-label={`${metric.label}, ${rangeInfo.label.toLowerCase()}`}>
      {/* Two rows, so a narrow row wraps cleanly: what is measured and over
          which period on top; the number, how it moved and the legend under
          it, the legend dropping to its own right-aligned line when there is
          no room beside the number. */}
      <div className="flex flex-col gap-2" data-tour={anchor}>
        <div className="flex items-center justify-between gap-4">
          {metrics.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(PICKER, "self-start")} aria-label={`Metric: ${metric.label}`}>
                {headlineLabel}
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
            <span className="text-sm font-medium text-foreground">{headlineLabel}</span>
          )}
          <div className="flex shrink-0 items-center gap-2">
            {note && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/80">
                {note}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className={RANGE_PICKER} aria-label={`Period: ${rangeInfo.label}`}>
                {rangeInfo.label}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={range} onValueChange={(v) => setRange(v as HeroRange)}>
                  {HERO_RANGES.filter((r) => r.key !== "all" || allTimeOffered).map((r) => (
                    <DropdownMenuRadioItem key={r.key} value={r.key}>
                      {r.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
          {/* The number and how it moved: "$9,177.00  ↗ 1,659%". What it moved
              from is in the legend. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-baseline gap-1.5" title={metric.description}>
              <span className="font-heading text-3xl leading-none tracking-tight tabular-nums">
                {metric.format(series.currentTotal)}
              </span>
              {metric.suffix && <span className="text-sm text-muted-foreground">{metric.suffix}</span>}
            </span>
            {previousTotal !== null && (
              <ChangeChip
                kind={metric.kind}
                current={series.currentTotal}
                previous={previousTotal}
                format={metric.format}
              />
            )}
          </div>
          {/* Each line named, with its total: "— Booked value  — Picked up $4,210
              ⋯ Previous 30 days $522". Decorative: the sr-only summary says it. */}
          {legend.length >= 2 && (
            <div className="ml-auto flex min-h-[30px] flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
              {legend.map((entry) => (
                <LegendEntry key={entry.swatch} {...entry} />
              ))}
            </div>
          )}
        </div>
      </div>

      <ChartContainer config={chartConfig} className={cn("aspect-auto w-full", HERO_CHART_HEIGHT)}>
        <LineChart data={series.points} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
          {/* Never a zero-height scale: an empty period draws a flat baseline. */}
          <YAxis hide domain={[0, (dataMax: number) => Math.max(1, dataMax)]} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ChartTooltip
            cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
            content={
              <HeroTooltip
                metric={metric}
                secondaryLabel={secondaryLabel}
                averaged={metric.kind === "stock" && series.averaged === true}
                showPrevious={series.hasPrevious}
              />
            }
          />
          {series.hasPrevious && (
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
          )}
          {secondaryLabel && (
            <Line
              dataKey="secondary"
              type={curve}
              stroke="var(--color-secondary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          )}
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

      <p className="sr-only">
        {isStock
          ? `${headlineLabel}: ${metric.format(series.currentTotal)}${metric.suffix ? ` ${metric.suffix}` : ""}.${previousSentence}${secondaryText}${series.averaged ? " Each point on the line is a daily average." : ""}`
          : `${metric.label}, ${rangeInfo.label.toLowerCase()}: ${metric.format(series.currentTotal)}.${previousSentence}${secondaryText}`}
      </p>
    </section>
  );
}

const CHIP_TONE = {
  up: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400",
  down: "bg-rose-500/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-400",
  flat: "bg-muted text-muted-foreground",
};

/**
 * How the headline moved against the previous period, as a small chip.
 *
 * FLOW (a total over the period): the change as a percentage of the previous
 * total. With nothing in the previous period a percentage has no meaning, so
 * there is no chip, and the legend beside it ("Previous 30 days 0") says it.
 *
 * STOCK (a level on a day): the change in the level itself ("↗ 5" cars), since
 * a percentage of a handful of cars reads as noise.
 *
 * Every metric on these tabs is one where more is better, so up is green.
 * Decorative: the sr-only summary carries both numbers. Not drawn at all on
 * "All time", which has no previous period.
 */
function ChangeChip({
  kind,
  current,
  previous,
  format: formatValue,
}: {
  kind: HeroMetric["kind"];
  current: number;
  previous: number;
  format: (value: number) => string;
}) {
  let direction: keyof typeof CHIP_TONE;
  let text: string;
  if (kind === "flow") {
    if (!(previous > 0)) return null;
    const pct = Math.round(((current - previous) / previous) * 100);
    direction = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    text = `${Math.abs(pct).toLocaleString()}%`;
  } else {
    const delta = current - previous;
    direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    text = formatValue(Math.abs(delta));
  }
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <span
      aria-hidden
      data-change={direction}
      className={cn(
        "inline-flex h-6 items-center gap-0.5 rounded-full pl-1.5 pr-2 text-xs font-semibold tabular-nums",
        CHIP_TONE[direction],
      )}
    >
      <Icon className="size-3.5" />
      {text}
    </span>
  );
}

/**
 * Re-renders the chart when the local calendar day turns over, so a tab left
 * open past midnight moves its windows on without waiting for the data to
 * change. A timer set for just after midnight covers a page left in view; focus
 * and visibilitychange cover a background tab whose timers the browser slowed
 * or a laptop that slept. Setting the same day again changes no state, so React
 * skips the render.
 */
function useDayRollover(enabled: boolean) {
  const [, setDay] = useState(() => startOfDay(new Date()).getTime());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => setDay(startOfDay(new Date()).getTime());
    const arm = () => {
      const nextMidnight = addDays(startOfDay(new Date()), 1).getTime();
      timer = setTimeout(() => {
        sync();
        arm();
      }, Math.max(1000, nextMidnight - Date.now() + 1000));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    arm();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}

interface LegendEntryProps {
  /** The line's swatch classes (SWATCH). */
  swatch: string;
  label: string;
  /** The line's total, formatted. The main line has none: the big number is its value. */
  value?: string;
}

/** One legend entry. Every entry is this markup, so they all sit and space alike. */
function LegendEntry({ swatch, label, value }: LegendEntryProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("shrink-0", swatch)} />
      {label}
      {value !== undefined && <span className="font-medium tabular-nums text-foreground/80">{value}</span>}
    </span>
  );
}

function HeroTooltip({
  active,
  payload,
  metric,
  secondaryLabel,
  averaged = false,
  showPrevious = true,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  metric: HeroMetric;
  secondaryLabel: string | null;
  /** Each point is a level averaged over several days (a week or a month). */
  averaged?: boolean;
  /** False on "All time", which has no previous period. */
  showPrevious?: boolean;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="min-w-[200px] rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-medium text-foreground">{point.currentLabel}</span>
        {averaged && <span className="text-[11px] text-muted-foreground">Daily average</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: "var(--color-current)" }} aria-hidden />
        <span className="text-muted-foreground">{metric.label}</span>
        <span className="ml-auto pl-3 font-medium tabular-nums">{metric.format(point.current)}</span>
      </div>
      {secondaryLabel && point.secondary !== undefined && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: "var(--color-secondary)" }} aria-hidden />
          <span className="text-muted-foreground">{secondaryLabel}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{metric.format(point.secondary)}</span>
        </div>
      )}
      {showPrevious && point.previous !== null && point.previousLabel !== null && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="w-3 shrink-0 border-t-2 border-dotted border-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{point.previousLabel}</span>
          <span className="ml-auto pl-3 tabular-nums text-muted-foreground">{metric.format(point.previous)}</span>
        </div>
      )}
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
 *
 * A CARD THE HEIGHT OF THE GRAPH. The card is a grid item and stretches to
 * the row, and the row is exactly as tall as the graph column: the headline at
 * its top, the chart's baseline at its bottom (there is no axis label row under
 * it any more). So the card's top lines up with the metric label and its
 * bottom with the chart, as the team lead asked. Nothing inside a card may set
 * a desktop minimum height taller than that column, or the row grows and the
 * graph no longer reaches the card's bottom: minimum heights on cards are for
 * the stacked (below lg) layout only.
 *
 * A CARD THAT STAYS READABLE. The row splits at `lg`, where the content column
 * can be as narrow as 720px, and four equal columns made the card 162px wide:
 * its one-line subtitle wrapped to three lines and its art shrank to slivers.
 * So the card's column never drops below 15rem (the widest subtitle is about
 * 196px of text inside 16px of padding a side), and the graph's three columns
 * give way instead. From a 1032px row up all four columns are equal, as before.
 */
export function HeroRow({ chart, card }: { chart: ReactNode; card?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 py-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(15rem,1fr)] lg:[&:has(>[data-hero-card]:empty)>[data-hero-chart]]:col-span-4">
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
