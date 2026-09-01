'use client';

import { Bar, BarChart, Pie, PieChart, Line, LineChart, XAxis, YAxis, Cell, ResponsiveContainer } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import type { ChartData } from '@/hooks/use-trax-chat';

interface TraxChatChartProps {
  chart: ChartData;
}

// Color palette for charts
const COLORS = [
  '#E9B63E',  // gold (accent)
  '#F5C94D',  // lighter gold
  '#D4A435',  // darker gold
  '#C79028',  // bronze
  '#AB7B1E',  // deep bronze
];

function BarChartComponent({ data }: { data: ChartData['data'] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart
        data={data}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) =>
            typeof value === 'number' ? value.toLocaleString() : value
          }
        />
        <ChartTooltip
          content={<ChartTooltipContent />}
          cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PieChartComponent({ data }: { data: ChartData['data'] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={30}
          outerRadius={60}
          paddingAngle={2}
          label={({ percent }) =>
            `${(percent * 100).toFixed(0)}%`
          }
          labelLine={false}
        >
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

function LineChartComponent({ data }: { data: ChartData['data'] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart
        data={data}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) =>
            typeof value === 'number' ? value.toLocaleString() : value
          }
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={COLORS[0]}
          strokeWidth={2}
          dot={{ fill: COLORS[0], r: 3, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TraxChatChart({ chart }: TraxChatChartProps) {
  const chartConfig = chart.data.reduce((acc, item, index) => {
    acc[item.name] = {
      label: item.name,
      color: COLORS[index % COLORS.length],
    };
    return acc;
  }, {} as Record<string, { label: string; color: string }>);

  chartConfig['value'] = {
    label: 'Value',
    color: COLORS[0],
  };

  const renderChart = () => {
    switch (chart.type) {
      case 'bar':
        return <BarChartComponent data={chart.data} />;
      case 'pie':
        return <PieChartComponent data={chart.data} />;
      case 'line':
        return <LineChartComponent data={chart.data} />;
      default:
        return <BarChartComponent data={chart.data} />;
    }
  };

  return (
    <div className={cn(
      "mt-2 rounded-lg p-3",
      "bg-muted/50 border border-border/50"
    )}>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-medium">{chart.title}</h4>
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
          {chart.type}
        </span>
      </div>
      <ChartContainer config={chartConfig} className="h-[160px] w-full">
        {renderChart()}
      </ChartContainer>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-2 justify-center">
        {chart.data.map((item, index) => (
          <div key={item.name} className="flex items-center gap-1">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="text-[10px] text-muted-foreground">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
