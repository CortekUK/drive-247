'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, getCurrencySymbol } from '@/lib/format-utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  format,
  subDays,
  eachDayOfInterval,
  differenceInDays,
} from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';

// ─── Chart color palette ────────────────────────────────────────────
const CHART = {
  gold: 'hsl(41 49% 56%)',
  green: 'hsl(142 76% 36%)',
  blue: 'hsl(217 91% 60%)',
};

// ─── Interfaces ─────────────────────────────────────────────────────
interface DailyPoint {
  date: string;
  label: string;
  revenue: number;
  rentals: number;
  customers: number;
}

// ─── Custom Tooltip ─────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, currencyCode = 'GBP' }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3 shadow-lg backdrop-blur-sm text-xs">
      {label && (
        <p className="font-medium text-foreground/60 mb-1.5 text-[11px] uppercase tracking-wide">
          {label}
        </p>
      )}
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2.5 py-0.5">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: entry.color || entry.payload?.fill }}
          />
          <span className="text-foreground/50">{entry.name}</span>
          <span className="ml-auto font-semibold text-foreground/90 tabular-nums">
            {entry.dataKey === 'revenue'
              ? formatCurrency(entry.value, currencyCode, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
              : entry.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Chart Skeleton ─────────────────────────────────────────────────
function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="flex items-end gap-[3px] px-2" style={{ height }}>
      {Array.from({ length: 20 }).map((_, i) => (
        <Skeleton
          key={i}
          className="flex-1 rounded-t-sm"
          style={{ height: `${15 + Math.sin(i * 0.5) * 30 + Math.random() * 25}%`, opacity: 0.15 + i * 0.03 }}
        />
      ))}
    </div>
  );
}

function getDefaultRange(): { from: Date; to: Date } {
  return { from: subDays(new Date(), 29), to: new Date() };
}

// ─── Main Component ─────────────────────────────────────────────────
export function DashboardCharts() {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';
  const currencySymbol = getCurrencySymbol(currencyCode);

  // Date range state — default last 30 days
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(getDefaultRange);

  const handleCustomRange = (range: { from: Date; to: Date }) => {
    setDateRange(range);
  };

  // ── Fetch chart data based on date range ──
  const fromStr = format(dateRange.from, 'yyyy-MM-dd');
  const toStr = format(dateRange.to, 'yyyy-MM-dd') + 'T23:59:59';

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-charts', tenant?.id, fromStr, toStr],
    queryFn: async () => {
      const [
        { data: recentRentals },
        { data: recentCustomers },
      ] = await Promise.all([
        supabase
          .from('rentals')
          .select('created_at, monthly_amount, status')
          .eq('tenant_id', tenant!.id)
          .gte('created_at', fromStr)
          .lte('created_at', toStr)
          .order('created_at', { ascending: true }),
        supabase
          .from('customers')
          .select('created_at')
          .eq('tenant_id', tenant!.id)
          .gte('created_at', fromStr)
          .lte('created_at', toStr)
          .order('created_at', { ascending: true }),
      ]);

      const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });

      const dailyMap = new Map<string, { revenue: number; rentals: number; customers: number }>();
      days.forEach(d => {
        dailyMap.set(format(d, 'yyyy-MM-dd'), { revenue: 0, rentals: 0, customers: 0 });
      });

      recentRentals?.forEach(r => {
        const key = format(new Date(r.created_at), 'yyyy-MM-dd');
        const entry = dailyMap.get(key);
        if (entry) {
          entry.rentals++;
          entry.revenue += r.monthly_amount || 0;
        }
      });

      recentCustomers?.forEach(c => {
        const key = format(new Date(c.created_at), 'yyyy-MM-dd');
        const entry = dailyMap.get(key);
        if (entry) entry.customers++;
      });

      // Use shorter label format for longer ranges
      const useShortLabel = days.length > 31;
      const daily: DailyPoint[] = days.map(d => {
        const key = format(d, 'yyyy-MM-dd');
        const entry = dailyMap.get(key)!;
        return {
          date: key,
          label: format(d, useShortLabel ? 'dd/MM' : 'dd MMM'),
          ...entry,
        };
      });

      return { daily };
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
  });

  const totalRevenue = useMemo(
    () => data?.daily?.reduce((s, d) => s + d.revenue, 0) || 0,
    [data?.daily]
  );
  const totalRentals = useMemo(
    () => data?.daily?.reduce((s, d) => s + d.rentals, 0) || 0,
    [data?.daily]
  );
  const totalCustomers = useMemo(
    () => data?.daily?.reduce((s, d) => s + d.customers, 0) || 0,
    [data?.daily]
  );

  // Shared axis/grid styles
  const axisStyle = { fontSize: 11, fill: 'hsl(159 15% 50%)' };
  const gridStyle = { strokeDasharray: '4 8', stroke: 'hsl(159 15% 85%)', strokeOpacity: 0.5 };

  // Determine tick interval based on range length
  const dayCount = differenceInDays(dateRange.to, dateRange.from) + 1;
  const tickInterval = dayCount <= 14 ? 0 : dayCount <= 31 ? 2 : Math.floor(dayCount / 12);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">
                Business Activity
              </CardTitle>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 active:scale-95 transition-all cursor-pointer">
                      <CalendarIcon className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <div className="p-4 space-y-4">
                      <div className="text-sm font-medium">Select Date Range</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs text-muted-foreground">From</label>
                          <Calendar
                            mode="single"
                            selected={dateRange.from}
                            onSelect={(date) => {
                              if (date) setDateRange(prev => ({ ...prev, from: date }));
                            }}
                            disabled={(date) => date > dateRange.to}
                            initialFocus
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">To</label>
                          <Calendar
                            mode="single"
                            selected={dateRange.to}
                            onSelect={(date) => {
                              if (date) setDateRange(prev => ({ ...prev, to: date }));
                            }}
                            disabled={(date) => date < dateRange.from}
                          />
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  {format(dateRange.from, 'dd MMM yyyy')} — {format(dateRange.to, 'dd MMM yyyy')}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Revenue</p>
                <span className="text-sm font-bold tabular-nums">
                  {formatCurrency(totalRevenue, currencyCode, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}
                </span>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Bookings</p>
                <span className="text-sm font-bold tabular-nums">{totalRentals}</span>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Customers</p>
                <span className="text-sm font-bold tabular-nums">{totalCustomers}</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: CHART.gold }} />
              Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: CHART.green }} />
              Bookings
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full opacity-60" style={{ background: CHART.blue }} />
              New Customers
            </span>
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-4">
          {isLoading ? (
            <ChartSkeleton height={320} />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={data?.daily || []} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={CHART.gold} stopOpacity={0.6} />
                    <stop offset="50%" stopColor={CHART.gold} stopOpacity={1} />
                    <stop offset="100%" stopColor={CHART.gold} stopOpacity={0.6} />
                  </linearGradient>
                  <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <CartesianGrid {...gridStyle} vertical={false} />

                <XAxis
                  dataKey="label"
                  tick={axisStyle}
                  axisLine={false}
                  tickLine={false}
                  interval={tickInterval}
                  minTickGap={30}
                />
                <YAxis
                  yAxisId="left"
                  tick={axisStyle}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={axisStyle}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={(v) => `${currencySymbol}${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />

                <RechartsTooltip
                  content={<ChartTooltip currencyCode={currencyCode} />}
                  cursor={{ stroke: 'hsl(159 15% 70%)', strokeWidth: 1, strokeDasharray: '4 4' }}
                />

                {/* Revenue line — primary, glowing */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="url(#goldLine)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{
                    r: 5,
                    stroke: CHART.gold,
                    strokeWidth: 2,
                    fill: 'hsl(var(--card))',
                  }}
                  filter="url(#softGlow)"
                />

                {/* Bookings line — solid green */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="rentals"
                  name="Bookings"
                  stroke={CHART.green}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{
                    r: 4,
                    stroke: CHART.green,
                    strokeWidth: 2,
                    fill: 'hsl(var(--card))',
                  }}
                />

                {/* Customers line — subtle dashed blue */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="customers"
                  name="New Customers"
                  stroke={CHART.blue}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  strokeOpacity={0.55}
                  dot={false}
                  activeDot={{
                    r: 3.5,
                    stroke: CHART.blue,
                    strokeWidth: 2,
                    fill: 'hsl(var(--card))',
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
