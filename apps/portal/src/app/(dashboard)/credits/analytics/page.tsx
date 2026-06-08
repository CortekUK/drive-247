"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ArrowLeft } from "lucide-react";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
import { Tile, Shimmer } from "@/components/bento";

function formatMonthLabel(monthStr: string) {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatDayLabel(dayStr: string) {
  const d = new Date(dayStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type TimeRange = "7d" | "30d" | "3m" | "6m" | "12m";
type IntegrationFilter = "all" | "esign" | "twilio" | "verification";

export default function CreditsAnalyticsPage() {
  const { transactions, isLoading } = useCreditWallet();
  const [timeRange, setTimeRange] = useState<TimeRange>("6m");
  const [integrationFilter, setIntegrationFilter] = useState<IntegrationFilter>("all");

  const chartConfig = useMemo<ChartConfig>(() => ({
    usage: { label: "Credit Usage", color: "hsl(var(--primary))" },
  }), []);

  const chartData = useMemo(() => {
    const now = new Date();
    const usageTransactions = transactions.filter(
      (tx) => tx.type === "usage" && !tx.is_test_mode && (integrationFilter === "all" || tx.category === integrationFilter)
    );

    if (timeRange === "7d" || timeRange === "30d") {
      const days = timeRange === "7d" ? 7 : 30;
      const result: { label: string; usage: number }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dayStr = d.toISOString().substring(0, 10);
        let count = 0;
        for (const tx of usageTransactions) {
          if (tx.created_at.substring(0, 10) === dayStr) count++;
        }
        result.push({ label: formatDayLabel(dayStr), usage: count });
      }
      return result;
    }

    const months = timeRange === "3m" ? 3 : timeRange === "6m" ? 6 : 12;
    const result: { label: string; usage: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      let count = 0;
      for (const tx of usageTransactions) {
        if (tx.created_at.substring(0, 7) === monthKey) count++;
      }
      result.push({ label: formatMonthLabel(monthKey), usage: count });
    }
    return result;
  }, [transactions, timeRange, integrationFilter]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Shimmer className="h-9 w-64" />
        <Shimmer className="h-[460px] rounded-tile" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/credits">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Credits Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Credit usage trends and insights</p>
        </div>
      </div>

      <Tile className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-bold tracking-tight">Usage History</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Live credit usage over time</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={integrationFilter} onValueChange={(v) => setIntegrationFilter(v as IntegrationFilter)}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Services</SelectItem>
                <SelectItem value="esign">E-Sign</SelectItem>
                <SelectItem value="twilio">Twilio</SelectItem>
                <SelectItem value="verification">Verification</SelectItem>
              </SelectContent>
            </Select>
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
              <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 days</SelectItem>
                <SelectItem value="30d">30 days</SelectItem>
                <SelectItem value="3m">3 months</SelectItem>
                <SelectItem value="6m">6 months</SelectItem>
                <SelectItem value="12m">12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <ChartContainer config={chartConfig} className="h-[400px] w-full">
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="usage" fill="var(--color-usage)" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ChartContainer>
      </Tile>
    </div>
  );
}
