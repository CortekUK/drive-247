'use client';

/**
 * Drive247's revenue as a RUNNING TOTAL — the Northwind operator home's chart
 * (apps/portal/src/components/dashboard-v2/home/revenue-line-card.tsx), fed
 * with the platform's own money: paid subscription invoices, net of refunds,
 * from live companies.
 *
 * The line climbs to the headline figure; the dashed ghost is the period
 * before, drawn the same way, so "ahead of last time" is a shape. No grid, no
 * y-axis. Hover for the figures at a point. The range lives in the ⋮ menu and
 * is remembered in this browser.
 */

import { useEffect, useId, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { Area, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useRevenueSeries, type Bucket, type RevenuePoint, type RevenueRange } from '@/lib/dashboard/use-admin-dashboard';
import { usd } from './kit';

const RANGE_WORDS: Record<RevenueRange, string> = {
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '12m': 'last 12 months',
};
const VIEW_KEY = 'admin-dashboard:revenue-range';

function label(iso: string, bucket: Bucket): string {
  const d = new Date(iso);
  if (bucket === 'month') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  if (bucket === 'week') return `week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function tick(iso: string, bucket: Bucket): string {
  const d = new Date(iso);
  return bucket === 'month'
    ? d.toLocaleDateString('en-US', { month: 'short' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TrendTip({ point, bucket }: { point: RevenuePoint; bucket: Bucket }) {
  const unit = bucket;
  const prev = point.previous;
  const vs = prev !== undefined && prev > 0 ? Math.round(((point.total - prev) / prev) * 100) : null;
  return (
    <div className="pv min-w-[190px] rounded-xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-3.5 py-3 text-[12px]">
      <p className="text-[11px] font-medium text-[var(--pv-ink-3)]">{label(point.date, bucket)}</p>
      <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--pv-ink)]">{usd(point.total)}</p>
      <p className="text-[11.5px] text-[var(--pv-ink-3)]">collected so far</p>
      <div className="mt-2 space-y-1 border-t border-[var(--pv-line)] pt-2 text-[11.5px] text-[var(--pv-ink-2)]">
        <p className="flex items-center justify-between gap-4">
          <span>That {unit}</span>
          <span className="font-semibold tabular-nums text-[var(--pv-ink)]">
            {point.came > 0 ? `+${usd(point.came)}` : `Quiet ${unit}`}
          </span>
        </p>
        {vs !== null && (
          <p className="flex items-center justify-between gap-4">
            <span>Against the period before</span>
            <span className={cn('font-semibold tabular-nums', vs >= 0 ? 'text-[var(--pv-clear)]' : 'text-[var(--pv-late)]')}>
              {vs >= 0 ? '↑' : '↓'} {Math.abs(vs)}%
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

export function RevenueCard({ className }: { className?: string }) {
  const [range, setRangeRaw] = useState<RevenueRange>('12m');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === '30d' || saved === '90d' || saved === '12m') setRangeRaw(saved);
    } catch {
      /* storage unavailable — default */
    }
  }, []);
  const setRange = (r: RevenueRange) => {
    setRangeRaw(r);
    try {
      window.localStorage.setItem(VIEW_KEY, r);
    } catch {
      /* ignore */
    }
  };

  const { data, isLoading, isError } = useRevenueSeries(range);
  const uid = useId().replace(/:/g, '');
  const last = data?.points[data.points.length - 1];
  const vs = data && data.previousTotal > 0 ? Math.round(((data.total - data.previousTotal) / data.previousTotal) * 100) : null;

  return (
    <div className={cn('flex h-[260px] min-w-0 flex-col', className)}>
      <header className="flex items-start justify-between gap-4 pt-1">
        <div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--pv-ink)]">
              {isLoading ? <span className="inline-block h-8 w-36 animate-pulse rounded-lg bg-[var(--pv-wash)] motion-reduce:animate-none" /> : data ? usd(data.total) : '—'}
            </span>
            {vs !== null && (
              <span className={cn('text-[12px] font-semibold tabular-nums', vs >= 0 ? 'text-[var(--pv-clear)]' : 'text-[var(--pv-late)]')}>
                {vs >= 0 ? '↑' : '↓'} {Math.abs(vs)}%
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-[var(--pv-ink-3)]">
            Subscription revenue, {RANGE_WORDS[range]}
            {data ? ` · ${data.payments} payment${data.payments === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Chart options"
              className="-mr-1.5 flex size-7 items-center justify-center rounded-lg text-[var(--pv-ink-3)] hover:text-[var(--pv-accent-ink)] data-[state=open]:text-[var(--pv-accent-ink)]"
            >
              <MoreVertical className="size-4" strokeWidth={2.25} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-52 rounded-xl p-1.5 shadow-none">
            <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Period
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={range} onValueChange={(v) => setRange(v as RevenueRange)}>
              {(Object.keys(RANGE_WORDS) as RevenueRange[]).map((r) => (
                <DropdownMenuRadioItem key={r} value={r} className="rounded-lg text-[13px]">
                  {RANGE_WORDS[r].replace(/^last/, 'Last')}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="relative min-h-0 flex-1 pt-2 text-[var(--pv-accent-ink)]">
        {isError && (
          <p className="flex h-full items-center justify-center text-[13px] text-[var(--pv-ink-3)]">
            Revenue couldn&rsquo;t be loaded just now.
          </p>
        )}
        {data && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.points} margin={{ top: 14, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                  <stop offset="70%" stopColor="currentColor" stopOpacity={0.06} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                minTickGap={48}
                tickMargin={6}
                tick={{ fontSize: 10.5, fill: 'var(--pv-ink-3)' }}
                tickFormatter={(d: string) => tick(d, data.bucket)}
              />
              <YAxis hide domain={[0, (max: number) => Math.max(1, max * 1.08)]} />
              <Tooltip
                cursor={{ stroke: 'var(--pv-ink-3)', strokeWidth: 1, strokeDasharray: '2 3' }}
                content={(props) => {
                  const point = props.active ? (props.payload?.[0]?.payload as RevenuePoint | undefined) : undefined;
                  return point ? <TrendTip point={point} bucket={data.bucket} /> : null;
                }}
                wrapperStyle={{ outline: 'none', zIndex: 20 }}
                offset={14}
                isAnimationActive={false}
              />
              <Line
                dataKey="previous"
                type="monotone"
                stroke="var(--pv-ink-3)"
                strokeOpacity={0.45}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Area
                dataKey="total"
                type="monotone"
                stroke="currentColor"
                strokeWidth={2.25}
                fill={`url(#${uid}-fill)`}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--pv-paper)', fill: 'currentColor' }}
                animationDuration={800}
                animationEasing="ease-out"
              />
              {last && (
                <ReferenceDot x={last.date} y={last.total} r={4} fill="currentColor" stroke="var(--pv-paper)" strokeWidth={2} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {data && data.total === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-[var(--pv-ink-3)]">
            No subscription payments in the {RANGE_WORDS[range]}.
          </p>
        )}
      </div>
    </div>
  );
}
