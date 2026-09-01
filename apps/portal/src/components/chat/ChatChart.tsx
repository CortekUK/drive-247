'use client';

import { Bar, BarChart, Pie, PieChart, Line, LineChart, XAxis, YAxis, Cell, ResponsiveContainer } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import type { ChartData } from '@/types/chat';

interface ChatChartProps {
  chart: ChartData;
}

// Generate color variations from a base color
function generateColorPalette(baseColor: string): string[] {
  // Parse hex color to HSL-like variations
  // Create 5 variations with different opacities/shades
  return [
    baseColor,
    `${baseColor}dd`,
    `${baseColor}bb`,
    `${baseColor}99`,
    `${baseColor}77`,
  ];
}

// Fallback sophisticated color palette
const DEFAULT_COLORS = [
  '#E9B63E',  // gold (accent)
  '#F5C94D',  // lighter gold
  '#D4A435',  // darker gold
  '#C79028',  // bronze
  '#AB7B1E',  // deep bronze
];

function BarChartComponent({ data, colors }: { data: ChartData['data']; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart
        data={data}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
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
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={colors[index % colors.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PieChartComponent({ data, colors }: { data: ChartData['data']; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={70}
          paddingAngle={2}
          label={({ percent }) =>
            `${(percent * 100).toFixed(0)}%`
          }
          labelLine={false}
        >
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={colors[index % colors.length]}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

function LineChartComponent({ data, colors }: { data: ChartData['data']; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart
        data={data}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
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
          stroke={colors[0]}
          strokeWidth={2}
          dot={{ fill: colors[0], r: 4, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ChatChart({ chart }: ChatChartProps) {
  const { branding } = useTenantBranding();

  // Get branding color and generate palette
  const accentColor = branding?.accent_color || '#E9B63E';
  const colors = generateColorPalette(accentColor);

  const chartConfig = chart.data.reduce((acc, item, index) => {
    acc[item.name] = {
      label: item.name,
      color: colors[index % colors.length],
    };
    return acc;
  }, {} as Record<string, { label: string; color: string }>);

  chartConfig['value'] = {
    label: 'Value',
    color: colors[0],
  };

  const renderChart = () => {
    switch (chart.type) {
      case 'bar':
        return <BarChartComponent data={chart.data} colors={colors} />;
      case 'pie':
        return <PieChartComponent data={chart.data} colors={colors} />;
      case 'line':
        return <LineChartComponent data={chart.data} colors={colors} />;
      default:
        return <BarChartComponent data={chart.data} colors={colors} />;
    }
  };

  return (
    <div className={cn(
      "mt-2 rounded-xl p-4",
      "bg-secondary/30 border border-border/50",
      "backdrop-blur-sm animate-fade-in"
    )}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium">{chart.title}</h4>
        <span
          className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
          style={{
            background: `${accentColor}15`,
            color: accentColor,
            borderColor: `${accentColor}30`,
          }}
        >
          {chart.type}
        </span>
      </div>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        {renderChart()}
      </ChartContainer>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 justify-center">
        {chart.data.map((item, index) => (
          <div key={item.name} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />
            <span className="text-xs text-muted-foreground">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
