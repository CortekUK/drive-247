'use client';

/**
 * Insights — the four charts.
 *
 * Hierarchy is deliberate and top-down: the full-width money-over-time chart
 * answers "is the business working?", and the three below it answer "where
 * exactly?". Every colour comes from `_kit.tsx`; none is declared here.
 *
 * ── How colour reaches a mark ────────────────────────────────────────────────
 * Never as a literal hex on a `<Cell fill="#…">`. A literal is a LIGHT-mode
 * value that dark mode cannot swap, and Recharts renders SVG so no Tailwind
 * `dark:` class reaches it. Instead every colour is registered in the
 * `ChartConfig` with its `{ light, dark }` pair — `ui/chart.tsx` emits those as
 * `--color-<key>` under `[data-chart]` and `.dark [data-chart]` — and the mark
 * reads `var(--color-<key>)`. One declaration, both modes, no duplication.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatCurrency } from '@/lib/format-utils';
import {
  AGING_COLORS,
  LegendRow,
  MIX_COLORS,
  MONEY_COLORS,
  OTHER_COLOR,
  PROFIT_COLORS,
  Panel,
  Swatch,
} from './_kit';
import type { InsightsData } from './_data';

/**
 * Axis ticks in the tenant's currency, shortened.
 *
 * Full currency strings on a y-axis ("$1,250,000.00") squeeze the plot area
 * into a sliver. The tooltip carries the exact figure; the axis only has to
 * give the reader a sense of scale.
 */
function shortMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Recessive axes — no tick marks, no axis rule, small type. */
const AXIS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  fontSize: 12,
} as const;

const CURSOR = { fill: 'hsl(var(--muted))', opacity: 0.5 } as const;

const exact = (currency: string) => (v: number) =>
  formatCurrency(v, currency, { maximumFractionDigits: 0 });

/* ────────────────────────────────────────────────────────────────────────────
 * 1 · Revenue vs costs by month
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The page's headline chart, and the one that had to be composed rather than
 * three bars.
 *
 * Revenue and operating cost are drawn as paired bars — same unit, same axis,
 * directly comparable, which is the whole question. Net profit rides over them
 * as a line so its SHAPE is readable: three flat months and one bad one is a
 * different story from a steady slide, and a third bar would bury that.
 *
 * ONE y-axis, always. A second scale for the profit line would let the two be
 * made to cross wherever the renderer felt like it.
 */
export function RevenueVsCosts({
  data,
  loading,
  currency,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
}) {
  const config: ChartConfig = {
    revenue: { label: 'Operating revenue', theme: MONEY_COLORS.revenue },
    cost: { label: 'Operating cost', theme: MONEY_COLORS.cost },
    profit: { label: 'Net profit', theme: MONEY_COLORS.profit },
  };

  const monthly = data?.monthly ?? [];
  const isEmpty = monthly.length === 0 || monthly.every((m) => m.revenue === 0 && m.cost === 0);

  return (
    <Panel
      title="Revenue vs costs"
      description="Operating money in and out, month by month. Vehicle purchases are not in here."
      loading={loading}
      isEmpty={isEmpty}
      emptyMessage="No revenue or costs recorded in this period. Once rentals start completing, this fills in month by month."
      action={
        !loading && !isEmpty ? (
          <div
            data-slot="card-action"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Swatch color={MONEY_COLORS.revenue} /> Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch color={MONEY_COLORS.cost} /> Cost
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch color={MONEY_COLORS.profit} shape="line" /> Net profit
            </span>
          </div>
        ) : undefined
      }
    >
      <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
        <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} width={52} tickFormatter={(v) => shortMoney(Number(v))} />
          {/* Zero is load-bearing here — the profit line crosses it. */}
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ChartTooltip
            cursor={CURSOR}
            content={<ChartTooltipContent valueFormatter={exact(currency)} />}
          />
          {/* 4px rounded data-ends, anchored to the baseline. */}
          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="cost" fill="var(--color-cost)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line
            type="monotone"
            dataKey="profit"
            stroke="var(--color-profit)"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: 'var(--color-profit)' }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ChartContainer>
    </Panel>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2 · Profit by vehicle
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Best five and worst five, and nothing in between.
 *
 * A bar per vehicle across a 40-car fleet is a wall nobody reads. The
 * actionable question is which cars carry the business and which cost money,
 * and both answers live at the ends of the distribution.
 *
 * Diverging colour, because the polarity is real: green made money, red lost
 * it. The sign is in the tooltip figure too, so the encoding is never colour
 * alone — and the bar's direction from the zero rule says it a third time.
 */
export function ProfitByVehicle({
  data,
  loading,
  currency,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
}) {
  const best = data?.bestVehicles ?? [];
  const worst = data?.worstVehicles ?? [];
  // Worst listed after best: the eye lands on the top of a list, and the top
  // should be the good news.
  const rows = [...best, ...worst];
  const isEmpty = rows.length === 0;

  const config: ChartConfig = {
    profit: { label: 'Net profit' },
    positive: { label: 'Profitable', theme: PROFIT_COLORS.positive },
    negative: { label: 'Loss-making', theme: PROFIT_COLORS.negative },
  };

  return (
    <Panel
      title="Profit by vehicle"
      description={
        isEmpty
          ? undefined
          : `Best ${best.length} and worst ${worst.length} performers in this period.`
      }
      loading={loading}
      isEmpty={isEmpty}
      emptyMessage="No revenue or costs have been booked against a specific vehicle yet."
    >
      <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis type="number" {...AXIS} tickFormatter={(v) => shortMoney(Number(v))} />
          <YAxis
            type="category"
            dataKey="label"
            {...AXIS}
            width={136}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          <ReferenceLine x={0} stroke="hsl(var(--border))" />
          <ChartTooltip cursor={CURSOR} content={<ChartTooltipContent valueFormatter={exact(currency)} />} />
          <Bar dataKey="profit" radius={4} maxBarSize={18}>
            {rows.map((row) => (
              <Cell
                key={row.vehicleId}
                fill={row.profit >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </Panel>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3 · Revenue mix
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Where the operating revenue actually comes from.
 *
 * Part-to-whole, and on most tenants one slice (Rental) is the overwhelming
 * majority — which is itself the finding, and a donut states it in a glance.
 * Everything past the top five folds into "Other" rather than adding hues; see
 * `foldMix` and the palette note in `_kit.tsx`.
 *
 * The legend beside it is not decoration. Three of the light-mode slots sit
 * under 3:1 against a white card, so every slice is named with its amount and
 * share in text — identity never depends on telling two wedges apart.
 *
 * Config keys are positional slugs (`slice0`…) rather than the category names
 * themselves, because a category like "Service Fee" would become the CSS custom
 * property `--color-Service Fee`, which is not a valid identifier. The tooltip
 * still shows the real name: `ChartTooltipContent` falls back to the payload's
 * own `name` when the config has no matching entry.
 */
export function RevenueMix({
  data,
  loading,
  currency,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
}) {
  const mix = data?.mix ?? [];
  const isEmpty = mix.length === 0;

  const colorFor = (index: number, category: string) =>
    category === 'Other' ? OTHER_COLOR : (MIX_COLORS[index] ?? OTHER_COLOR);

  const config: ChartConfig = Object.fromEntries(
    mix.map((slice, i) => [
      `slice${i}`,
      { label: slice.category, theme: colorFor(i, slice.category) },
    ]),
  );

  const total = mix.reduce((sum, s) => sum + s.amount, 0);

  return (
    <Panel
      title="Revenue mix"
      description="What the operating revenue is made of."
      loading={loading}
      isEmpty={isEmpty}
      emptyMessage="No operating revenue in this period yet."
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <ChartContainer config={config} className="aspect-square h-[190px] shrink-0">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent nameKey="category" hideLabel valueFormatter={exact(currency)} />
              }
            />
            <Pie
              data={mix}
              dataKey="amount"
              nameKey="category"
              innerRadius={54}
              outerRadius={82}
              // A visible gap between wedges, so adjacent fills read as two
              // marks rather than one continuous band.
              paddingAngle={2}
              strokeWidth={0}
            >
              {mix.map((_, i) => (
                <Cell key={i} fill={`var(--color-slice${i})`} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (!viewBox || !('cx' in viewBox)) return null;
                  const cx = viewBox.cx ?? 0;
                  const cy = viewBox.cy ?? 0;
                  return (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan
                        x={cx}
                        y={cy - 4}
                        className="fill-foreground text-sm font-semibold tabular-nums"
                      >
                        {formatCurrency(total, currency, { maximumFractionDigits: 0 })}
                      </tspan>
                      <tspan x={cx} y={cy + 14} className="fill-muted-foreground text-[10px]">
                        total
                      </tspan>
                    </text>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>

        <div className="min-w-0 flex-1 space-y-2">
          {mix.map((slice, i) => (
            <LegendRow
              key={slice.category}
              color={colorFor(i, slice.category)}
              label={slice.category}
              value={formatCurrency(slice.amount, currency, { maximumFractionDigits: 0 })}
              meta={`${slice.share.toFixed(0)}%`}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4 · Money owed by age
 * ──────────────────────────────────────────────────────────────────────────── */

const AGING_BUCKETS = [
  { key: 'bucket_0_30', label: '0–30 days' },
  { key: 'bucket_31_60', label: '31–60 days' },
  { key: 'bucket_61_90', label: '61–90 days' },
  { key: 'bucket_90_plus', label: '90+ days' },
] as const;

/**
 * Outstanding balances, oldest to the right.
 *
 * The only figure on this page that does NOT come from `pnl_entries`:
 * `view_aging_receivables` already does this correctly and does it in SQL, so
 * re-deriving it in the browser would only add a way to get it wrong.
 *
 * Sequential colour, light → dark with age, because the buckets are ordinal.
 * Not a green→red status ramp: this reports what is owed, it does not grade
 * anyone's collections.
 *
 * Deliberately NOT scoped to the selected period. A debt does not stop existing
 * because you asked about the last three months — money owed is a balance as of
 * today, and the period selector has no business changing it. The card's
 * description says so on screen, so the one number that ignores the selector
 * announces that itself rather than looking like a bug.
 */
export function MoneyOwedByAge({
  data,
  loading,
  currency,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
}) {
  const rows = AGING_BUCKETS.map((b, i) => ({
    label: b.label,
    amount: data?.aging[b.key] ?? 0,
    slot: i,
  }));
  const isEmpty = rows.every((r) => r.amount === 0);

  const config: ChartConfig = {
    amount: { label: 'Owed' },
    ...Object.fromEntries(
      AGING_COLORS.map((color, i) => [`age${i}`, { label: AGING_BUCKETS[i].label, theme: color }]),
    ),
  };

  return (
    <Panel
      title="Money owed by age"
      description="Outstanding balances as of today, whatever period is selected above."
      loading={loading}
      isEmpty={isEmpty}
      emptyMessage="Nothing outstanding. Every invoice has been settled."
    >
      <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
        <BarChart data={rows} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} width={52} tickFormatter={(v) => shortMoney(Number(v))} />
          <ChartTooltip cursor={CURSOR} content={<ChartTooltipContent valueFormatter={exact(currency)} />} />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {rows.map((row) => (
              <Cell key={row.label} fill={`var(--color-age${row.slot})`} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </Panel>
  );
}
