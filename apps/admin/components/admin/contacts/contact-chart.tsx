'use client';

/**
 * Requests over time, drawn like Northwind's hero chart
 * (apps/portal/src/components/shared/hero-chart-v2.tsx): the number for the
 * period, a change chip against the period before, a solid line for this
 * period and a faint dotted one for the last. No grid, no axes.
 */

import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, Minus } from 'lucide-react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type RangeKey = '30d' | '90d' | '12m' | 'all';
const RANGES: { key: RangeKey; label: string; compare: string }[] = [
  { key: '30d', label: 'Last 30 days', compare: 'Previous 30 days' },
  { key: '90d', label: 'Last 90 days', compare: 'Previous 90 days' },
  { key: '12m', label: 'Last 12 months', compare: 'Previous 12 months' },
  { key: 'all', label: 'All time', compare: '' },
];

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

interface Point {
  label: string;
  current: number;
  previous?: number;
}

/** Buckets: days for 30 days, weeks for 90, months for a year or more. */
function buildSeries(dates: number[], range: RangeKey, today: Date) {
  const end = startOfDay(today).getTime() + DAY; // exclusive
  const first = dates.length ? Math.min(...dates) : end - 30 * DAY;

  if (range === '30d' || range === '90d') {
    const days = range === '30d' ? 30 : 90;
    const step = range === '30d' ? 1 : 7;
    const buckets = Math.ceil(days / step);
    const start = end - buckets * step * DAY;
    const prevStart = start - buckets * step * DAY;
    const points: Point[] = Array.from({ length: buckets }, (_, i) => {
      const from = new Date(start + i * step * DAY);
      return {
        label:
          step === 1
            ? from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : `Week of ${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        current: 0,
        previous: 0,
      };
    });
    let current = 0;
    let previous = 0;
    for (const t of dates) {
      if (t >= start && t < end) {
        points[Math.min(buckets - 1, Math.floor((t - start) / (step * DAY)))].current++;
        current++;
      } else if (t >= prevStart && t < start) {
        points[Math.min(buckets - 1, Math.floor((t - prevStart) / (step * DAY)))].previous!++;
        previous++;
      }
    }
    return { points, current, previous: previous as number | null };
  }

  // Months.
  const now = new Date(end - 1);
  const months =
    range === '12m'
      ? 12
      : Math.max(2, (now.getFullYear() - new Date(first).getFullYear()) * 12 + now.getMonth() - new Date(first).getMonth() + 1);
  const monthStart = (back: number) => new Date(now.getFullYear(), now.getMonth() - back, 1).getTime();
  const points: Point[] = Array.from({ length: months }, (_, i) => ({
    label: new Date(monthStart(months - 1 - i)).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    current: 0,
    ...(range === '12m' ? { previous: 0 } : {}),
  }));
  const start = monthStart(months - 1);
  const prevStart = monthStart(2 * months - 1);
  const monthIndex = (t: number, base: number) => {
    const d = new Date(t);
    const b = new Date(base);
    return (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth();
  };
  let current = 0;
  let previous = 0;
  for (const t of dates) {
    if (t >= start && t < end) {
      points[Math.min(months - 1, monthIndex(t, start))].current++;
      current++;
    } else if (range === '12m' && t >= prevStart && t < start) {
      points[Math.min(months - 1, monthIndex(t, prevStart))].previous!++;
      previous++;
    }
  }
  return { points, current, previous: range === '12m' ? previous : null };
}

export function ContactChart({ dates, className }: { dates: number[]; className?: string }) {
  const [range, setRange] = useState<RangeKey>('30d');
  const info = RANGES.find((r) => r.key === range)!;
  const series = useMemo(() => buildSeries(dates, range, new Date()), [dates, range]);
  const hasPrevious = series.previous !== null;

  return (
    <section className={cn('flex flex-col gap-3 rounded-3xl border border-border bg-card p-5', className)} aria-label={`Requests, ${info.label.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-foreground">New requests</span>
        <DropdownMenu>
          <DropdownMenuTrigger className="-my-0.5 inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 text-sm font-medium text-foreground outline-none hover:opacity-75 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {info.label}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {RANGES.map((r) => (
              <DropdownMenuItem key={r.key} onSelect={() => setRange(r.key)} className={cn(r.key === range && 'font-medium text-primary')}>
                {r.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{series.current.toLocaleString()}</span>
          {hasPrevious && <ChangeChip current={series.current} previous={series.previous!} />}
        </div>
        {hasPrevious && (
          <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-primary" />
              {info.label}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-dotted border-muted-foreground" />
              {info.compare}
              <span className="font-medium text-foreground tabular-nums">{series.previous}</span>
            </span>
          </div>
        )}
      </div>

      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series.points} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
            <YAxis hide domain={[0, (max: number) => Math.max(1, max)]} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Tooltip cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }} content={<ChartTip showPrevious={hasPrevious} compare={info.compare} />} />
            {hasPrevious && (
              <Line
                dataKey="previous"
                type="monotone"
                stroke="hsl(var(--muted-foreground))"
                strokeOpacity={0.6}
                strokeWidth={2}
                strokeDasharray="2 4"
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              dataKey="current"
              type="monotone"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ChangeChip({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  const pct = previous === 0 ? null : Math.round((diff / previous) * 100);
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        diff > 0 ? 'bg-success/10 text-success' : diff < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="size-3.5" />
      {pct === null ? (diff === 0 ? '0%' : 'New') : `${Math.abs(pct)}%`}
    </span>
  );
}

function ChartTip({
  active,
  payload,
  showPrevious,
  compare,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  showPrevious: boolean;
  compare: string;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{p.label}</p>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-0.5 w-3 rounded-full bg-primary" />
        <span className="font-medium text-foreground tabular-nums">{p.current}</span> {p.current === 1 ? 'request' : 'requests'}
      </p>
      {showPrevious && p.previous !== undefined && (
        <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
          <span className="w-3 border-t-2 border-dotted border-muted-foreground" />
          <span className="tabular-nums">{p.previous}</span> in the {compare.toLowerCase()}
        </p>
      )}
    </div>
  );
}
