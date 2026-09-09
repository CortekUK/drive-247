"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { EnhancedRental, RentalStats } from "@/hooks/use-enhanced-rentals";

/**
 * The overview row that sits above the rentals table.
 *
 * Two things: ONE chart of how the list has moved over the last six months, and
 * a way through to the calendar.
 *
 * WHY ONE CHART AND NOT THREE TILES. This row used to spend three of its four
 * columns on a status donut, a count sparkline and a value bar chart — three
 * pictures of the same six months that could not be read against each other. A
 * month with fewer rentals but higher value is the single most useful thing on
 * this screen and none of the three could show it, because the reader had to
 * hold one chart in their head while looking at the next. Collapsed into one
 * figure, volume, mix and value share an x-axis and that comparison is just
 * there.
 *
 * NO SECOND Y-AXIS. The obvious move — value as a line overlaid on the count
 * bars — is a dual-axis chart, and the alignment of two arbitrary scales
 * invents a correlation the data does not contain. So value gets its OWN panel
 * under the columns, sharing the months and nothing else: the price-and-volume
 * arrangement, which is honest about the two scales being unrelated while still
 * letting the eye run down a month and read both. A `syncId` ties the hover so
 * the two panels behave as one chart.
 *
 * NO CARDS, AND ONE COLOUR. This row used to be four bordered, shadowed cards
 * in four different hues. Both are gone: it sits straight on the page ground,
 * and everything that carried meaning in green/amber/grey carries it in
 * `--primary` at different strengths instead.
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
 * The lower panel is called "Booked value", not "Revenue". It sums
 * `total_amount` — what the rentals were written for — which is not the same
 * thing as money collected, and there is no honest way to call it that.
 *
 * Single stable root, no fixed height: `rentals-overview-flip.tsx` measures this
 * face with a `ResizeObserver`, so it absorbs the new (taller) height on its
 * own — but it needs exactly one element to observe.
 */

interface Props {
  stats: RentalStats | null;
  /** The full filtered set (`allRentals`), not the current page. */
  rentals: EnhancedRental[];
  currencySymbol: string;
  onOpenCalendar: () => void;
}

/** How far the chart looks back. */
const MONTHS = 6;

/** Ties the hover on the two panels together, so they read as one chart. */
const SYNC = "rentals-v2-overview";

/**
 * The status ramp — one hue, five strengths, mixed toward `--muted-foreground`.
 *
 * Status here is an ORDERED scale, not a set of nominal categories: a rental is
 * on the road, then about to be, then waiting, then done, with cancellation as
 * the terminal case. That is what makes a single-hue ramp the right encoding
 * rather than a colour-per-category one — position in the ramp carries position
 * in that order, and a column reads strongest at the baseline (Active, the one
 * an operator is answerable for today) to palest at the top.
 *
 * FIVE STEPS, NOT SEVEN. `getRentalStatus` returns six names, and the first
 * draft here gave each one its own step. On screen that failed: in light mode
 * `--primary` (248 68% 51%) and `--muted-foreground` (0 0% 45%) sit at almost
 * the same lightness, so the ramp varies in chroma alone, and seven chroma
 * steps between them are not seven distinguishable colours — Cancelled and
 * Rejected were the same grey. Cancelled and Rejected are also the one pair
 * that answers the same question (this rental never ran), so they share the
 * terminal step under a label that names both. Nothing is hidden: the legend
 * and the tooltip both say "Cancelled or rejected", and the table below is
 * still the place to see which is which.
 *
 * The steps MIX TOWARD `--muted-foreground` rather than fade with alpha.
 * Fading reads well in light mode and fails outright in dark: `--primary` there
 * is already a dark indigo (246 61% 42%), so a quarter-alpha segment on a
 * near-black ground is invisible. `--muted-foreground` moves the opposite way
 * per theme — 45% grey in light, 63% in dark — so mixing toward it darkens the
 * step on white and lightens it on black. One formula, legible in both, and
 * still nothing but tokens.
 *
 * Each status keeps its OWN step whether or not the others are present, so
 * filtering the list never repaints the survivors. A status with no rentals in
 * the window is simply not drawn and not keyed.
 *
 * Tokens are resolved through `hsl(var(--…))` rather than `--chart-1..5`
 * because those five are defined only under `.v2-theme`, and a chart whose
 * colours resolve to nothing renders as invisible marks with no error.
 */
const RAMP = [100, 76, 52, 28, 6];

function toneAt(step: number) {
  const pct = RAMP[Math.min(step, RAMP.length - 1)];
  return pct >= 100
    ? "hsl(var(--primary))"
    : `color-mix(in oklab, hsl(var(--primary)) ${pct}%, hsl(var(--muted-foreground)))`;
}

/**
 * `statuses` is every `computed_status` that lands on this step. The last step
 * is also the catch-all: `getRentalStatus` only ever returns the six names
 * below, but if it ever returned another the rental still has to appear
 * somewhere, or the segments would sum to less than the column.
 */
const STATUS_SERIES = (
  [
    { key: "active", label: "Active", statuses: ["Active"] },
    { key: "upcoming", label: "Upcoming", statuses: ["Upcoming"] },
    { key: "pending", label: "Pending", statuses: ["Pending"] },
    { key: "completed", label: "Completed", statuses: ["Completed"] },
    { key: "ended", label: "Cancelled or rejected", statuses: ["Cancelled", "Rejected"] },
  ] as const
).map((s, i) => ({ ...s, tone: toneAt(i) }));

type StatusSeries = (typeof STATUS_SERIES)[number];

/** Anything unrecognised falls to the terminal step rather than off the chart. */
const FALLBACK_KEY = STATUS_SERIES[STATUS_SERIES.length - 1].key;

const STATUS_BY_NAME = new Map<string, string>(
  STATUS_SERIES.flatMap((s) => s.statuses.map((name) => [name, s.key] as [string, string]))
);

/** Swatches for the tooltip and legend, plus the value line's own key. */
const chartConfig: ChartConfig = {
  ...Object.fromEntries(STATUS_SERIES.map((s) => [s.key, { label: s.label, color: s.tone }])),
  value: { label: "Booked", color: "hsl(var(--primary))" },
};

/**
 * Rentals bucketed into the last `MONTHS` calendar months by `created_at`, and
 * split by where each one stands TODAY.
 *
 * Buckets are built first and then filled, so a month with no rentals is a zero
 * rather than a gap — a series that silently skips July reads as a shorter
 * period rather than as a quiet one.
 *
 * `__top` is the last status with a non-zero count in each month: the stacked
 * column's free end, and the only segment that gets a rounded cap. Everything
 * below it is squared off and inset 2px at the top, which is what separates
 * touching segments — a 2px gap of page ground rather than a stroke drawn
 * around each one. That matters more here than it would with hue, since
 * neighbouring steps share a colour.
 */
type MonthBucket = {
  key: string;
  m: string;
  mLong: string;
  count: number;
  value: number;
  __top: string | null;
} & Record<string, string | number | null>;

function monthlySeries(rentals: EnhancedRental[]): MonthBucket[] {
  const now = new Date();
  const buckets: MonthBucket[] = [];
  const index = new Map<string, number>();

  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    index.set(key, buckets.length);
    const bucket = {
      key,
      m: d.toLocaleString(undefined, { month: "short" }),
      mLong: d.toLocaleString(undefined, { month: "long", year: "numeric" }),
      count: 0,
      value: 0,
      __top: null,
    } as MonthBucket;
    for (const s of STATUS_SERIES) bucket[s.key] = 0;
    buckets.push(bucket);
  }

  for (const rental of rentals) {
    if (!rental.created_at) continue;
    const d = new Date(rental.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const at = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (at === undefined) continue;
    const bucket = buckets[at];
    bucket.count += 1;
    bucket.value += Number(rental.total_amount) || 0;
    const statusKey = STATUS_BY_NAME.get(rental.computed_status) ?? FALLBACK_KEY;
    bucket[statusKey] = (bucket[statusKey] as number) + 1;
  }

  for (const bucket of buckets) {
    let top: string | null = null;
    for (const s of STATUS_SERIES) if ((bucket[s.key] as number) > 0) top = s.key;
    bucket.__top = top;
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

/**
 * The three bands every tile is built from — and the reason the row holds
 * together without boxes.
 *
 * `LABEL` is the table's own column-head type, so a field name reads the same
 * here as it does six pixels lower. `VALUE` is a fixed-height band rather than
 * a self-sizing one: tile 4 has a sentence where the others have a 30px number,
 * and without a set height its graphic would start on a different line and the
 * whole grid would lose its baseline.
 */
const LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const VALUE = "flex h-9 items-baseline gap-2";
const NUMBER = "font-heading text-3xl leading-none tracking-tight tabular-nums";
const CAPTION = "text-xs text-muted-foreground";
/**
 * The gutter the two panels are inset by, so the columns, the value line and
 * the month labels all start on the same x. It is exactly the width reserved
 * for the count axis’ ticks: the lower panel has no axis of its own, so it
 * borrows the number as a margin instead.
 */
const AXIS_W = 26;
/**
 * No rule between the columns, at the user’s request — the row is held together
 * by the shared baseline grid and 32px of gutter alone. Kept as an empty
 * constant rather than deleted from the call sites, so putting a separator
 * back is one edit here.
 */
const RULE = "";

/** `Aug 2026 · 12 rentals`, then the mix, then what they were booked at. */
function MonthTooltip({
  active,
  payload,
  present,
  currencySymbol,
}: {
  active?: boolean;
  payload?: { payload: MonthBucket }[];
  present: StatusSeries[];
  currencySymbol: string;
}) {
  const bucket = active ? payload?.[0]?.payload : undefined;
  if (!bucket) return null;

  return (
    <div className="min-w-[176px] rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{bucket.mLong}</span>
        <span className="tabular-nums text-muted-foreground">
          {bucket.count} {bucket.count === 1 ? "rental" : "rentals"}
        </span>
      </div>
      {bucket.count > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {present.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: s.tone }}
                aria-hidden
              />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-medium tabular-nums">{bucket[s.key] as number}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-2 border-t pt-2">
        <span className="text-muted-foreground">Booked value</span>
        <span className="ml-auto font-medium tabular-nums">
          {currencySymbol}
          {Math.round(bucket.value).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/**
 * One segment of a stacked column.
 *
 * Recharts would draw touching rectangles; the 2px inset at the top of every
 * segment that is not the column’s free end is what separates them, in page
 * ground rather than in ink. Only the free end is rounded — an interior
 * segment with rounded corners would show the segment below through the notch.
 */
function Segment({
  x,
  y,
  width,
  height,
  tone,
  seriesKey,
  payload,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tone: string;
  seriesKey: string;
  payload?: MonthBucket;
}) {
  if (x == null || y == null || !width || !height || height <= 0) return null;

  const isTop = payload?.__top === seriesKey;
  const gap = isTop ? 0 : 2;
  const h = Math.max(1, height - gap);
  const top = y + gap;
  const r = isTop ? Math.min(4, h, width / 2) : 0;
  const d =
    r > 0
      ? `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${top + h} Z`
      : `M${x},${top} h${width} v${h} h${-width} Z`;

  return <path d={d} style={{ fill: tone }} />;
}

function Tile({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`flex flex-col gap-3 ${className}`}>{children}</div>;
}

export function RentalsOverview({ stats, rentals, currencySymbol, onOpenCalendar }: Props) {
  const series = useMemo(() => monthlySeries(rentals), [rentals]);

  /**
   * Only the statuses that actually occur in the window get a segment and a key.
   * Their ramp step comes from the canonical order, not from this list, so a
   * status appearing or disappearing never restains the ones already on screen.
   */
  const present = useMemo(
    () =>
      STATUS_SERIES.map((s) => ({
        ...s,
        total: series.reduce((sum, d) => sum + (d[s.key] as number), 0),
      })).filter((s) => s.total > 0),
    [series]
  );

  /** The one month worth direct-labelling on the value panel: the richest. */
  const peak = useMemo(
    () => series.reduce((best, d, i) => (d.value > series[best].value ? i : best), 0),
    [series]
  );

  // v1 rendered nothing at all when there were no stats; keep that, so the
  // page's vertical rhythm on an empty tenant is the one it already had.
  if (!stats) return null;

  const windowCount = series.reduce((sum, d) => sum + d.count, 0);
  const bookedValue = series.reduce((sum, d) => sum + d.value, 0);
  const peakValue = series[peak]?.value ?? 0;

  const tooltip = (
    <ChartTooltip
      cursor={{ fillOpacity: 0.08 }}
      content={<MonthTooltip present={present} currencySymbol={currencySymbol} />}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-y-8 py-2 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4">
      {/* 1 — Volume, mix and value over the same six months */}
      <Tile className={`sm:col-span-2 lg:col-span-3 ${RULE}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-3">
            <div className={LABEL}>Rentals by month</div>
            <div className={VALUE}>
              <span className={NUMBER}>{windowCount}</span>
              <span className={CAPTION}>rentals</span>
              <span className={NUMBER}>{compactMoney(bookedValue, currencySymbol)}</span>
              <span className={CAPTION}>
                booked, last 6 months
                {/* Only said when it needs saying: the columns count rentals
                    CREATED in the window, which is not always the whole list. */}
                {windowCount !== stats.total ? ` · ${stats.total} in view` : ""}
              </span>
            </div>
          </div>
          {/* The key. Two or more series always get one — the ramp alone is not
              allowed to be the only thing carrying identity. It doubles as the
              window’s status breakdown, which is what the donut’s legend was. */}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5 text-xs">
            {present.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: s.tone }}
                  aria-hidden
                />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium tabular-nums">{s.total}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col">
          {/* Upper panel — how many came in, and where they stand now. */}
          <ChartContainer config={chartConfig} className="h-[128px] w-full">
            <BarChart data={series} syncId={SYNC} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
              <CartesianGrid
                vertical={false}
                strokeDasharray="0"
                stroke="hsl(var(--border))"
                strokeOpacity={0.8}
              />
              <YAxis
                width={AXIS_W}
                axisLine={false}
                tickLine={false}
                tickCount={3}
                allowDecimals={false}
                tick={{ fontSize: 10 }}
              />
              {tooltip}
              {present.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="rentals"
                  fill={s.tone}
                  maxBarSize={24}
                  shape={(props: Record<string, unknown>) => (
                    <Segment
                      {...(props as { x: number; y: number; width: number; height: number })}
                      payload={props.payload as MonthBucket}
                      tone={s.tone}
                      seriesKey={s.key}
                    />
                  )}
                />
              ))}
            </BarChart>
          </ChartContainer>

          {/* Lower panel — what those rentals were written for. It needs to say
              so: a bare line under a column chart is a mystery, and the reader
              should not have to infer it from the headline. Its own scale,
              deliberately unticked apart from the best month — the shape is the
              point and the exact figures live in the tooltip. A continuous 2px
              stroke at full strength is the only mark of its kind on screen, so
              it stays apart from the columns without a second hue. */}
          <div
            className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            style={{ paddingLeft: AXIS_W }}
          >
            Booked value
          </div>
          <ChartContainer config={chartConfig} className="h-[56px] w-full">
            <AreaChart
              data={series}
              syncId={SYNC}
              margin={{ left: AXIS_W, right: 0, top: 14, bottom: 0 }}
            >
              <defs>
                <linearGradient id="rentalsV2FillValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              {/* Cursor only. The hover box belongs to the upper panel, which
                  `syncId` opens from here too, so one month gives one tooltip
                  wherever the pointer happens to be. */}
              <ChartTooltip cursor={{ fillOpacity: 0.08 }} content={() => null} />
              <Area
                dataKey="value"
                type="monotone"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#rentalsV2FillValue)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))" }}
              >
                <LabelList
                  dataKey="value"
                  content={(props: Record<string, unknown>) => {
                    const index = props.index as number;
                    const x = props.x as number;
                    const y = props.y as number;
                    if (index !== peak || peakValue <= 0 || x == null || y == null) return null;
                    const last = series.length - 1;
                    return (
                      <text
                        x={index === 0 ? x + 1 : index === last ? x - 1 : x}
                        y={Math.max(9, y - 7)}
                        textAnchor={index === 0 ? "start" : index === last ? "end" : "middle"}
                        className="fill-muted-foreground"
                        fontSize={10}
                        fontWeight={600}
                      >
                        {compactMoney(peakValue, currencySymbol)}
                      </text>
                    );
                  }}
                />
              </Area>
            </AreaChart>
          </ChartContainer>

          {/* Months, once, under both panels. Six equal cells inset by the axis
              gutter land on the same centres recharts gives the six bands. */}
          <div
            className="flex text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            style={{ paddingLeft: AXIS_W }}
          >
            {series.map((d) => (
              <span key={d.key} className="flex-1 text-center">
                {d.m}
              </span>
            ))}
          </div>
        </div>
      </Tile>

      {/* 4 — Calendar view */}
      <button
        type="button"
        onClick={onOpenCalendar}
        data-tour="rentals-calendar"
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
