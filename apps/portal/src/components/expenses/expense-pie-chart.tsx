"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { PieChart as PieIcon } from "lucide-react";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatCurrency } from "@/lib/format-utils";
import type { DistributionSlice } from "@/lib/expense-utils";

// Themed palette — indigo-led, distinct and readable in light + dark.
const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#06b6d4", "#f43f5e", "#84cc16",
];

const config: ChartConfig = { value: { label: "Amount", color: "#6366f1" } };

interface Props {
  data: DistributionSlice[];
  currencyCode: string;
  title: string;
  subtitle?: string;
}

export function ExpensePieChart({ data, currencyCode, title, subtitle }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const top = data.slice(0, 8);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PieIcon className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      {total === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          Nothing to break down yet.
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <div className="relative h-[200px] w-[200px] shrink-0">
            <ChartContainer config={config} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <ChartTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as DistributionSlice;
                      const pct = total ? Math.round((d.value / total) * 100) : 0;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="mb-0.5 text-xs text-muted-foreground">{d.name}</p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrency(d.value, currencyCode)} · {pct}%
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Pie
                    data={top}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={2}
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                    animationDuration={600}
                  >
                    {top.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] text-muted-foreground">Total</span>
              <span className="text-base font-semibold text-foreground">
                {formatCurrency(total, currencyCode)}
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="w-full space-y-1.5">
            {top.map((d, i) => {
              const pct = total ? Math.round((d.value / total) * 100) : 0;
              return (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="flex-1 truncate text-foreground">{d.name}</span>
                  <span className="tabular-nums text-muted-foreground">{pct}%</span>
                  <span className="w-20 text-right tabular-nums font-medium text-foreground">
                    {formatCurrency(d.value, currencyCode)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
