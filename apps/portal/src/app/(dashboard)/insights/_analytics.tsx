'use client';

/**
 * Insights — Analytics.
 *
 * Five charts on ONE screen, no scroll: a 3 × 2 grid whose cells take the
 * frame's height and whose charts take the cell's (`h-full`, never a fixed
 * pixel height), so the view fits a laptop and a 32" monitor alike.
 *
 * Every figure comes from the same `useInsights` read as the Numbers view, so
 * the tenant's "what counts where" rules and single-entry corrections are in
 * every mark here too. Every colour comes from `_kit.tsx`, registered in the
 * `ChartConfig` as a `{ light, dark }` pair and read as `var(--color-<key>)`
 * — never a literal hex on a mark, which dark mode could not swap.
 *
 * Flat panels (muted fill, 1px ring) rather than cards — the same surface as
 * the What-if panel, so the page reads as one product.
 */

import { useId, type ReactNode } from 'react';
import {
  Area,
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
import { cn } from '@/lib/utils';
import {
  AGING_COLORS,
  LegendRow,
  MIX_COLORS,
  MONEY_COLORS,
  OTHER_COLOR,
  PROFIT_COLORS,
  Swatch,
} from './_kit';
import type { InsightsData } from './_data';

/* ────────────────────────────────────────────────────────────────────────────
 * Shared
 * ──────────────────────────────────────────────────────────────────────────── */

/** Axis ticks shortened; the tooltip carries the exact figure. */
export function shortMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}${Math.round(abs)}`;
}

const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 11 } as const;
const CURSOR = { fill: 'hsl(var(--muted))', opacity: 0.5 } as const;

const whole = (currency: string) => (v: number) =>
  formatCurrency(v, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** One flat panel. The chart inside gets every pixel the grid cell has left. */
function ChartPanel({
  title,
  description,
  aside,
  isEmpty,
  emptyMessage,
  className,
  children,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-h-[280px] min-w-0 flex-col rounded-4xl bg-muted/40 p-5 ring-1 ring-foreground/5 xl:min-h-0',
        className,
      )}
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="font-heading text-[15px] font-medium tracking-tight">{title}</h3>
          {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </header>
      <div className="mt-3 min-h-0 flex-1">
        {isEmpty ? (
          <div className="flex h-full min-h-[160px] items-center justify-center rounded-3xl bg-background/60 px-6 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">{emptyMessage ?? 'Nothing to show yet.'}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The view
 * ──────────────────────────────────────────────────────────────────────────── */

export function AnalyticsView({ data, currency }: { data: InsightsData | undefined; currency: string }) {
  return (
    <div className="grid gap-4 xl:h-full xl:grid-cols-3 xl:grid-rows-2">
      <MoneyInOut data={data} currency={currency} className="xl:col-span-2" />
      <RevenueMix data={data} currency={currency} />
      <ProfitByCar data={data} currency={currency} />
      <RunningProfit data={data} currency={currency} />
      <OwedByAge data={data} currency={currency} />
    </div>
  );
}

/* 1 · Money in and out ──────────────────────────────────────────────────────
 * Revenue and cost as soft filled areas, profit as a line over them. ONE
 * y-axis, always — a second scale would let the line cross wherever it liked.
 * `linear`, not `monotone`: a smoothed curve overshoots, drawing a peak above
 * the real month and a dip below zero that never happened. */
function MoneyInOut({ data, currency, className }: { data?: InsightsData; currency: string; className?: string }) {
  const gid = useId().replace(/:/g, '');
  const monthly = data?.monthly ?? [];
  const isEmpty = monthly.every((m) => m.revenue === 0 && m.cost === 0);
  const config: ChartConfig = {
    revenue: { label: 'Money in', theme: MONEY_COLORS.revenue },
    cost: { label: 'Money spent', theme: MONEY_COLORS.cost },
    profit: { label: 'Kept', theme: MONEY_COLORS.profit },
  };

  return (
    <ChartPanel
      title="Money in and out"
      description="Month by month. Car purchases are not in here."
      className={className}
      isEmpty={isEmpty}
      emptyMessage="Once rentals start completing, I'll draw your months here."
      aside={
        isEmpty ? undefined : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Swatch color={MONEY_COLORS.revenue} /> Money in</span>
            <span className="flex items-center gap-1.5"><Swatch color={MONEY_COLORS.cost} /> Spent</span>
            <span className="flex items-center gap-1.5"><Swatch color={MONEY_COLORS.profit} shape="line" /> Kept</span>
          </div>
        )
      }
    >
      <ChartContainer config={config} className="aspect-auto h-full min-h-[200px] w-full">
        <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`${gid}-rev`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={`${gid}-cost`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-cost)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--color-cost)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} width={44} tickFormatter={(v) => shortMoney(Number(v))} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ChartTooltip cursor={CURSOR} content={<ChartTooltipContent valueFormatter={whole(currency)} />} />
          <Area
            type="linear"
            dataKey="revenue"
            stroke="var(--color-revenue)"
            strokeWidth={2}
            fill={`url(#${gid}-rev)`}
          />
          <Area type="linear" dataKey="cost" stroke="var(--color-cost)" strokeWidth={2} fill={`url(#${gid}-cost)`} />
          <Line
            type="linear"
            dataKey="profit"
            stroke="var(--color-profit)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--color-profit)' }}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ChartContainer>
    </ChartPanel>
  );
}

/* 2 · Revenue mix ───────────────────────────────────────────────────────────
 * Part-to-whole. Every slice is also named with amount and share in text, so
 * identity never rests on telling two wedges apart. Config keys are positional
 * slugs — "Service Fee" is not a valid CSS custom-property name. */
function RevenueMix({ data, currency, className }: { data?: InsightsData; currency: string; className?: string }) {
  const mix = data?.mix ?? [];
  const total = mix.reduce((s, m) => s + m.amount, 0);
  const colorFor = (i: number, category: string) =>
    category === 'Other' ? OTHER_COLOR : (MIX_COLORS[i] ?? OTHER_COLOR);
  const config: ChartConfig = Object.fromEntries(
    mix.map((slice, i) => [`slice${i}`, { label: slice.category, theme: colorFor(i, slice.category) }]),
  );

  return (
    <ChartPanel
      title="Where the money comes from"
      className={className}
      description="Your own revenue, by kind of charge."
      isEmpty={mix.length === 0}
      emptyMessage="No revenue in this period yet."
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <ChartContainer config={config} className="aspect-auto min-h-[140px] w-full flex-1">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="category" hideLabel valueFormatter={whole(currency)} />} />
            <Pie data={mix} dataKey="amount" nameKey="category" innerRadius="62%" outerRadius="92%" paddingAngle={2} strokeWidth={0}>
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
                      <tspan x={cx} y={cy - 4} className="fill-foreground text-sm font-semibold tabular-nums">
                        {shortMoney(total)}
                      </tspan>
                      <tspan x={cx} y={cy + 13} className="fill-muted-foreground text-[10px]">
                        total
                      </tspan>
                    </text>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="shrink-0 space-y-1.5">
          {mix.slice(0, 4).map((slice, i) => (
            <LegendRow
              key={slice.category}
              color={colorFor(i, slice.category)}
              label={slice.category}
              value={whole(currency)(slice.amount)}
              meta={`${slice.share.toFixed(0)}%`}
            />
          ))}
        </div>
      </div>
    </ChartPanel>
  );
}

/* 3 · Profit by car ─────────────────────────────────────────────────────────
 * Every car that moved money, best at the top, as many as the cell has room
 * for (capped at 8 so bars stay readable). Diverging colour because the
 * polarity is real; the bar's side of the zero rule says it a second time.
 * The axis shows the car's NAME only — the plate made every label wrap onto
 * two lines; it is in the tooltip. */
function ProfitByCar({ data, currency, className }: { data?: InsightsData; currency: string; className?: string }) {
  const all = data?.vehicleProfits ?? [];
  const rows =
    all.length <= 8 ? all : [...all.slice(0, 5), ...all.slice(-3)];
  const config: ChartConfig = {
    profit: { label: 'Kept' },
    positive: { label: 'Made money', theme: PROFIT_COLORS.positive },
    negative: { label: 'Lost money', theme: PROFIT_COLORS.negative },
  };
  const name = (label: string) => label.split(' · ')[0];

  return (
    <ChartPanel
      title="Profit by car"
      className={className}
      description={all.length > 8 ? 'Your best five and worst three.' : 'What each car kept after its own costs.'}
      isEmpty={rows.length === 0}
      emptyMessage="Nothing has been booked against a specific car yet."
    >
      <ChartContainer config={config} className="aspect-auto h-full min-h-[200px] w-full">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis type="number" {...AXIS} tickFormatter={(v) => shortMoney(Number(v))} />
          <YAxis
            type="category"
            dataKey="label"
            {...AXIS}
            width={116}
            interval={0}
            tickFormatter={(v) => {
              const n = name(String(v));
              return n.length > 18 ? `${n.slice(0, 17)}…` : n;
            }}
          />
          <ReferenceLine x={0} stroke="hsl(var(--border))" />
          <ChartTooltip cursor={CURSOR} content={<ChartTooltipContent valueFormatter={whole(currency)} />} />
          <Bar dataKey="profit" radius={4} maxBarSize={16}>
            {rows.map((row) => (
              <Cell key={row.vehicleId} fill={row.profit >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartPanel>
  );
}

/* 4 · Running profit ────────────────────────────────────────────────────────
 * What you have kept so far in the period, month on month — the one chart
 * that answers "am I ahead?" without any arithmetic. */
function RunningProfit({ data, currency, className }: { data?: InsightsData; currency: string; className?: string }) {
  const gid = useId().replace(/:/g, '');
  let running = 0;
  const points = (data?.monthly ?? []).map((m) => {
    running += m.profit;
    return { label: m.label, kept: running };
  });
  const isEmpty = (data?.monthly ?? []).every((m) => m.revenue === 0 && m.cost === 0);
  const last = points.at(-1)?.kept ?? 0;
  const config: ChartConfig = { kept: { label: 'Kept so far', theme: MONEY_COLORS.revenue } };

  return (
    <ChartPanel
      title="Kept so far"
      className={className}
      description="Your running total across the period."
      isEmpty={isEmpty}
      emptyMessage="Nothing kept or spent in this period yet."
      aside={
        isEmpty ? undefined : (
          <span className={cn('pt-0.5 text-sm font-medium tabular-nums', last < 0 && 'text-destructive')}>
            {last < 0 ? `− ${whole(currency)(-last)}` : whole(currency)(last)}
          </span>
        )
      }
    >
      <ChartContainer config={config} className="aspect-auto h-full min-h-[200px] w-full">
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`${gid}-kept`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-kept)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-kept)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...AXIS} width={44} tickFormatter={(v) => shortMoney(Number(v))} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ChartTooltip cursor={CURSOR} content={<ChartTooltipContent valueFormatter={whole(currency)} />} />
          <Area type="linear" dataKey="kept" stroke="var(--color-kept)" strokeWidth={2} fill={`url(#${gid}-kept)`} />
        </ComposedChart>
      </ChartContainer>
    </ChartPanel>
  );
}

/* 5 · Owed by age ───────────────────────────────────────────────────────────
 * Balances as of TODAY, whatever the period — a debt does not stop existing
 * because you asked about three months. Sequential colour, light → dark with
 * age, because the buckets are ordinal. */
const AGING_BUCKETS = [
  { key: 'bucket_0_30', label: '0–30d' },
  { key: 'bucket_31_60', label: '31–60d' },
  { key: 'bucket_61_90', label: '61–90d' },
  { key: 'bucket_90_plus', label: '90d+' },
] as const;

function OwedByAge({ data, currency, className }: { data?: InsightsData; currency: string; className?: string }) {
  const rows = AGING_BUCKETS.map((b, i) => ({ label: b.label, amount: data?.aging[b.key] ?? 0, slot: i }));
  const isEmpty = rows.every((r) => r.amount === 0);
  const config: ChartConfig = {
    amount: { label: 'Owed' },
    ...Object.fromEntries(AGING_COLORS.map((c, i) => [`age${i}`, { label: AGING_BUCKETS[i].label, theme: c }])),
  };

  return (
    <ChartPanel
      title="Still owed, by age"
      className={className}
      description="As of today, whatever period is picked."
      isEmpty={isEmpty}
      emptyMessage="Nobody owes you anything. Every invoice is settled."
      aside={
        isEmpty ? undefined : (
          <span className="pt-0.5 text-sm font-medium tabular-nums">{whole(currency)(data?.aging.total ?? 0)}</span>
        )
      }
    >
      <ChartContainer config={config} className="aspect-auto h-full min-h-[200px] w-full">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} width={44} tickFormatter={(v) => shortMoney(Number(v))} />
          <ChartTooltip cursor={CURSOR} content={<ChartTooltipContent valueFormatter={whole(currency)} />} />
          <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={48}>
            {rows.map((row) => (
              <Cell key={row.label} fill={`var(--color-age${row.slot})`} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartPanel>
  );
}

/* Exported for the Trax summary, which draws the same charts beside its
 * prose rather than a second, different set. */
export { MoneyInOut, RevenueMix, ProfitByCar, RunningProfit, OwedByAge, ChartPanel };
