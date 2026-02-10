'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { format, subDays, eachDayOfInterval, startOfDay } from 'date-fns';
import { TrendingUp, DollarSign } from 'lucide-react';
import { formatCurrency, getCurrencySymbol } from '@/lib/format-utils';

interface DailyData {
  date: string;
  displayDate: string;
  revenue: number;
  rentals: number;
}

export function RevenueChart() {
  const { tenant } = useTenant();

  // Fetch last 30 days of rental data
  const { data: chartData, isLoading } = useQuery({
    queryKey: ['revenue-chart', tenant?.id],
    queryFn: async (): Promise<DailyData[]> => {
      const endDate = new Date();
      const startDate = subDays(endDate, 29); // Last 30 days

      // Get all days in the range
      const days = eachDayOfInterval({ start: startDate, end: endDate });

      // Initialize data for all days
      const dailyDataMap = new Map<string, DailyData>();
      days.forEach(day => {
        const dateKey = format(day, 'yyyy-MM-dd');
        dailyDataMap.set(dateKey, {
          date: dateKey,
          displayDate: format(day, 'MMM d'),
          revenue: 0,
          rentals: 0,
        });
      });

      // Fetch rentals created in this period
      let rentalsQuery = supabase
        .from('rentals')
        .select('id, created_at, total_price')
        .gte('created_at', format(startDate, 'yyyy-MM-dd'))
        .lte('created_at', format(endDate, 'yyyy-MM-dd') + 'T23:59:59');

      if (tenant?.id) {
        rentalsQuery = rentalsQuery.eq('tenant_id', tenant.id);
      }

      const { data: rentals, error: rentalsError } = await rentalsQuery;

      if (rentalsError) {
        console.error('Error fetching rentals:', rentalsError);
        return Array.from(dailyDataMap.values());
      }

      // Aggregate rentals by day
      rentals?.forEach(rental => {
        const dateKey = format(new Date(rental.created_at), 'yyyy-MM-dd');
        const dayData = dailyDataMap.get(dateKey);
        if (dayData) {
          dayData.rentals += 1;
          dayData.revenue += rental.total_price || 0;
        }
      });

      return Array.from(dailyDataMap.values());
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Calculate totals and trends
  const stats = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { totalRevenue: 0, totalRentals: 0, avgDaily: 0, trend: 0 };
    }

    const totalRevenue = chartData.reduce((sum, d) => sum + d.revenue, 0);
    const totalRentals = chartData.reduce((sum, d) => sum + d.rentals, 0);
    const avgDaily = totalRevenue / chartData.length;

    // Calculate trend (compare last 7 days vs previous 7 days)
    const last7 = chartData.slice(-7);
    const prev7 = chartData.slice(-14, -7);
    const last7Revenue = last7.reduce((sum, d) => sum + d.revenue, 0);
    const prev7Revenue = prev7.reduce((sum, d) => sum + d.revenue, 0);
    const trend = prev7Revenue > 0 ? ((last7Revenue - prev7Revenue) / prev7Revenue) * 100 : 0;

    return { totalRevenue, totalRentals, avgDaily, trend };
  }, [chartData]);

  const currencyCode = tenant?.currency_code || 'GBP';
  const currencySymbol = getCurrencySymbol(currencyCode);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Revenue Overview
            </CardTitle>
            <CardDescription className="mt-1">
              Last 30 days performance
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{formatCurrency(stats.totalRevenue, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            <div className="flex items-center justify-end gap-1 text-sm">
              {stats.trend !== 0 && (
                <>
                  <TrendingUp className={`h-4 w-4 ${stats.trend >= 0 ? 'text-green-500' : 'text-red-500 rotate-180'}`} />
                  <span className={stats.trend >= 0 ? 'text-green-500' : 'text-red-500'}>
                    {stats.trend >= 0 ? '+' : ''}{stats.trend.toFixed(1)}%
                  </span>
                </>
              )}
              <span className="text-muted-foreground ml-1">vs prev. week</span>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
          <div>
            <div className="text-sm text-muted-foreground">Total Rentals</div>
            <div className="text-xl font-semibold">{stats.totalRentals}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Avg. Daily Revenue</div>
            <div className="text-xl font-semibold">{formatCurrency(stats.avgDaily, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Avg. Per Rental</div>
            <div className="text-xl font-semibold">
              {stats.totalRentals > 0 ? formatCurrency(stats.totalRevenue / stats.totalRentals, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : formatCurrency(0, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="displayDate"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                dy={10}
                interval="preserveStartEnd"
                minTickGap={50}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                tickFormatter={(value) => `${currencySymbol}${(value / 1000).toFixed(0)}k`}
                dx={-10}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600, marginBottom: 4 }}
                formatter={(value: number, name: string) => {
                  if (name === 'revenue') return [formatCurrency(value, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), 'Revenue'];
                  return [value, 'Rentals'];
                }}
              />
              <Legend
                verticalAlign="top"
                height={36}
                formatter={(value) => (
                  <span className="text-sm text-muted-foreground capitalize">{value}</span>
                )}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#revenueGradient)"
                name="revenue"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
