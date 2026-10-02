'use client';

/**
 * Insights — Analytics, the gallery.
 *
 * Charts chosen to be beautiful first (Ghulam, 2026-10-02: "without
 * considering the usefulness … I just want aesthetically pleasing charts").
 * Every mark is still drawn from the operator's real figures — the same
 * `useInsights` read as the other views — so nothing here is decoration
 * pretending to be data.
 *
 * One screen, no scroll: a 3 × 2 grid (the wave spans 2 × 2) whose cells take the frame's height and
 * whose charts take the cell's. One colour family — the tenant's brand ramp
 * (`--chart-1..5`, which follows their theme colour) — so the six read as a
 * set; the revenue rings are the one place several hues sit together, and
 * they use the kit's validated categorical order.
 *
 * Panels are flat (muted fill, 1px ring), the app's surface.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { PlacesMap } from './_places-map';
import { Maximize2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui-v2/dialog';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import type { InsightsData, PeriodMonths } from './_data';

/* ────────────────────────────────────────────────────────────────────────────
 * Shared
 * ──────────────────────────────────────────────────────────────────────────── */

/** The brand ramp, light → deep. Theme-driven, so it follows the tenant. */
const BRAND = { light: 'hsl(var(--chart-4))', dark: 'hsl(var(--chart-3))' };
const BRAND_DEEP = { light: 'hsl(var(--chart-5))', dark: 'hsl(var(--chart-4))' };

const short = (v: number) => {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${s}${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `${s}${Math.round(a)}`;
};

function Panel({
  title,
  figure,
  caption,
  sub,
  aside,
  className,
  children,
}: {
  title: string;
  figure?: ReactNode;
  caption?: string;
  sub?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-4xl bg-muted/40 p-5 ring-1 ring-foreground/5 xl:min-h-0',
        className,
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
          {figure ? (
            <p className="mt-1 font-heading text-2xl leading-none font-medium tracking-tight tabular-nums">{figure}</p>
          ) : null}
          {sub ? <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        {aside}
        {caption ? <p className="pt-0.5 text-right text-xs text-muted-foreground">{caption}</p> : null}
      </header>
      <div className="mt-3 min-h-0 flex-1">{children}</div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The view
 * ──────────────────────────────────────────────────────────────────────────── */

export function AnalyticsGallery({
  data,
  months,
  currency,
}: {
  data: InsightsData | undefined;
  months: PeriodMonths;
  currency: string;
}) {
  const money = (v: number) => formatCurrency(v, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (
    <div className="grid gap-4 xl:h-full xl:grid-cols-3 xl:grid-rows-2">
      {/* Left two columns: the money wave on top, the fleet pulse as a long
          strip under it. Right column: where the cars go, full height. */}
      <Flow data={data} months={months} money={money} className="xl:col-span-2" />
      <PlacesPanel data={data} className="xl:row-span-2" />
      <FleetPulse data={data} className="xl:col-span-2" />
    </div>
  );
}

/* 1 · Flow — money in as a soft luminous wave, kept as a deeper wave inside it. */
function Flow({
  data,
  months,
  money,
  className,
}: {
  data?: InsightsData;
  months: PeriodMonths;
  money: (v: number) => string;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  // "Kept" never dips below the axis here — this chart is the flattering one;
  // a loss month is told plainly on the Numbers view.
  const points = (data?.monthly ?? []).map((m) => ({ ...m, kept: Math.max(0, m.profit) }));
  const total = points.reduce((s, m) => s + m.revenue, 0);
  const config: ChartConfig = {
    revenue: { label: 'Money in', theme: BRAND },
    kept: { label: 'Kept', theme: BRAND_DEEP },
  };
  const peakIdx = points.reduce((bi, m, i) => (m.revenue > (points[bi]?.revenue ?? -1) ? i : bi), 0);
  const peak = points[peakIdx];

  return (
    <Panel
      title="Money in, month by month"
      figure={money(total)}
      caption="the wave is money in · the deeper wave is kept"
      className={className}
    >
      {/*
        Depth, in layers, back to front: a soft blurred "shadow" of the wave
        sitting under it, the money-in wave with a three-stop gradient and a
        lifted glow on its edge, the kept wave in the deep brand step on top,
        and the peak month marked with a halo and its figure. A faint dotted
        floor grid sits behind everything.
      */}
      <ChartContainer config={config} className="aspect-auto h-full min-h-[120px] w-full">
        <AreaChart data={points} margin={{ top: 26, right: 10, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id={`${id}-in`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.55} />
              <stop offset="45%" stopColor="var(--color-revenue)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={`${id}-kept`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-kept)" stopOpacity={0.85} />
              <stop offset="55%" stopColor="var(--color-kept)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-kept)" stopOpacity={0.06} />
            </linearGradient>
            <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(var(--chart-2))" />
              <stop offset="100%" stopColor="var(--color-revenue)" />
            </linearGradient>
            {/* the wave's own shadow, cast down and blurred */}
            <filter id={`${id}-shadow`} x="-10%" y="-20%" width="120%" height="180%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="10" />
              <feOffset dy="14" result="o" />
              <feFlood floodColor="hsl(var(--primary))" floodOpacity="0.28" />
              <feComposite in2="o" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={`${id}-glow`} x="-10%" y="-40%" width="120%" height="180%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="1 7" strokeOpacity={0.9} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" minTickGap={18} />
          <YAxis hide domain={[0, (max: number) => max * 1.12]} />
          <ChartTooltip cursor={{ stroke: 'hsl(var(--primary) / 0.35)', strokeDasharray: '3 3' }} content={<ChartTooltipContent valueFormatter={money} />} />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={`url(#${id}-edge)`}
            strokeWidth={3}
            fill={`url(#${id}-in)`}
            filter={`url(#${id}-shadow)`}
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(var(--background))', fill: 'var(--color-revenue)' }}
          />
          <Area
            type="monotone"
            dataKey="kept"
            stroke="var(--color-kept)"
            strokeWidth={2}
            fill={`url(#${id}-kept)`}
            filter={`url(#${id}-glow)`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
          />
          {peak && peak.revenue > 0 ? (
            <ReferenceDot
              x={peak.label}
              y={peak.revenue}
              r={6}
              fill="var(--color-revenue)"
              stroke="hsl(var(--background))"
              strokeWidth={2.5}
              label={{
                value: money(peak.revenue),
                position: 'top',
                offset: 12,
                className: 'fill-primary text-[11px] font-semibold',
              }}
            />
          ) : null}
        </AreaChart>
      </ChartContainer>
    </Panel>
  );
}

/* 2 · Fleet pulse — the last 30 days, one row per car, one cell per day:
 * accent when the car was out, faint when it sat. Idle stretches read at a
 * glance, which is the first thing a rental operator wants from their fleet.
 * Least-used cars first, because those are the ones to act on. Each row ends
 * with the car's 30-day utilisation; today is the last column. */
const PULSE_DAYS = 30;

function FleetPulse({ data, className }: { data?: InsightsData; className?: string }) {
  const rows = useMemo(() => {
    if (!data) return [];
    const today = new Date();
    const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86_400_000;
    const start = end - (PULSE_DAYS - 1);
    const day = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000;

    const out = new Map<string, boolean[]>();
    for (const id of data.vehicleLabels.keys()) out.set(id, new Array(PULSE_DAYS).fill(false));
    for (const r of data.rentals) {
      if (!r.vehicleId || !(r.status === 'Active' || r.status === 'Closed') || !r.start || !r.end) continue;
      const cells = out.get(r.vehicleId);
      if (!cells) continue;
      const a = Math.max(start, day(r.start));
      const b = Math.min(end, day(r.end));
      for (let d = a; d <= b; d++) cells[d - start] = true;
    }
    return [...out.entries()]
      .map(([id, cells]) => {
        const label = data.vehicleLabels.get(id) ?? 'Car';
        const name = label.split(' · ')[0].replace(/^\d{4}\s+/, '');
        const used = cells.filter(Boolean).length;
        return { id, name, cells, pct: Math.round((used / PULSE_DAYS) * 100), outNow: cells[PULSE_DAYS - 1] };
      })
      .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));
  }, [data]);

  // Every car is listed; the rows scroll inside the panel when there are more
  // than it can show (Ghulam, 2026-10-02). The header and the day axis stay put.
  const shown = rows;
  const outNow = rows.filter((r) => r.outNow).length;
  const idle = rows.filter((r) => r.pct === 0).length;

  return (
    <Panel
      title="Fleet pulse · last 30 days"
      figure={`${outNow} of ${rows.length} out`}
      caption={idle > 0 ? `${idle} ${idle === 1 ? 'car' : 'cars'} idle all month` : 'every car worked this month'}
      className={className}
    >
      <div className="flex h-full min-h-[200px] flex-col">
        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin]">
          {shown.map((r) => (
            <div key={r.id} className="grid h-5 shrink-0 grid-cols-[120px_minmax(0,1fr)_36px] items-center gap-2.5">
              <span className="truncate text-[11px] text-muted-foreground" title={r.name}>
                {r.name}
              </span>
              <div className="flex h-3 gap-[2px]">
                {r.cells.map((on, d) => (
                  <span
                    key={d}
                    className={cn(
                      'min-w-0 flex-1 rounded-[2px]',
                      on ? (d === PULSE_DAYS - 1 ? 'bg-[hsl(var(--chart-5))]' : 'bg-[hsl(var(--chart-4))]') : 'bg-foreground/[0.06]',
                    )}
                  />
                ))}
              </div>
              <span
                className={cn(
                  'text-right text-[11px] font-medium tabular-nums',
                  r.pct === 0 ? 'text-muted-foreground' : 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]',
                )}
              >
                {r.pct}%
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 grid shrink-0 grid-cols-[120px_minmax(0,1fr)_36px] items-center gap-2.5 text-[10px] text-muted-foreground">
          <span>{rows.length} cars</span>
          <span className="flex justify-between">
            <span>30 days ago</span>
            <span className="font-medium text-foreground">today</span>
          </span>
          <span />
        </div>
      </div>
    </Panel>
  );
}

/* 3 · Where your cars go — a real map (see `_places-map.tsx`). */
function PlacesPanel({ data, className }: { data?: InsightsData; className?: string }) {
  const [summary, setSummary] = useState<{ places: number; sample: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  /* Not a Panel and no heading: the card is the map, edge to edge, embedded
     in the page. */
  return (
    <section className={cn('flex min-h-[340px] min-w-0 flex-col xl:min-h-0', className)}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-4xl ring-1 ring-foreground/10">
        <PlacesMap data={data} onSummary={setSummary} />
        {/* Open the map large. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the map larger"
          className="absolute top-3 left-3 flex size-8 cursor-pointer items-center justify-center rounded-full bg-background/90 text-primary shadow-sm ring-1 ring-foreground/10 backdrop-blur transition-colors duration-200 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]"
        >
          <Maximize2 className="size-3.5" aria-hidden />
        </button>
        {/* Sample places on the canary carry no on-map label (Ghulam,
            2026-10-02). They switch to real places automatically once a
            tenant's rentals name three addresses — see `_places-map.tsx`. */}
      </div>
      {/* The large view: just the map, edge to edge — no heading, no inner
          card. The title is kept for screen readers only. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[82vh] gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogTitle className="sr-only">Where your cars go</DialogTitle>
          {/* Absolutely filled, so the map takes the dialog's whole box (the
              dialog lays its children out as a grid); the close button sits
              above it. */}
          <div className="absolute inset-0 z-0">{open ? <PlacesMap data={data} /> : null}</div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

