"use client";

import { useMemo } from "react";
import { useUsageData } from "@/hooks/use-usage-data";
import { USAGE_CATEGORIES, getCategoryConfig } from "@/lib/usage-categories";
import type { UsageEvent } from "@/lib/usage-categories";
import { useTenantSubscription, TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

function formatCurrencyFromCents(amount: number, currency = "usd") {
  return formatCurrency(amount / 100, currency);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateLong(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMonthLabel(monthStr: string) {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

/** Generate last N months as YYYY-MM strings ending at current month */
function getLastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

// ── Period Header ────────────────────────────────────────────────────

function PeriodHeader({
  periodStart,
  periodEnd,
  estimatedTotal,
  stripeMode,
}: {
  periodStart: string | null;
  periodEnd: string | null;
  estimatedTotal: number;
  stripeMode: "test" | "live";
}) {
  const isTest = stripeMode === "test";

  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Usage & Billing</h3>
          <Badge
            variant={isTest ? "outline" : "default"}
            className={
              isTest
                ? "border-orange-500/50 text-orange-500 text-[10px] px-1.5 py-0"
                : "bg-green-500/15 text-green-500 border-green-500/50 text-[10px] px-1.5 py-0"
            }
          >
            {isTest ? "SANDBOX" : "LIVE"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDateLong(periodStart)} – {formatDateLong(periodEnd)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Estimated Invoice
        </p>
        <p className="text-xl font-semibold">
          {formatCurrency(estimatedTotal)}
        </p>
      </div>
    </div>
  );
}

// ── Summary Cards ────────────────────────────────────────────────────

function UsageSummaryCards({
  usageData,
  baseAmount,
}: {
  usageData: Record<
    string,
    { currentCount: number; currentCost: number; unitCost: number }
  >;
  baseAmount: number;
}) {
  const categories = USAGE_CATEGORIES;
  const totalUsageCost = categories.reduce(
    (sum, cat) => sum + (usageData[cat.key]?.currentCost || 0),
    0
  );

  return (
    <div
      className={`grid gap-4 ${
        categories.length === 1
          ? "grid-cols-2"
          : categories.length === 2
            ? "grid-cols-3"
            : "grid-cols-2 lg:grid-cols-4"
      }`}
    >
      {/* One card per category */}
      {categories.map((cat) => {
        const data = usageData[cat.key];
        const Icon = cat.icon;
        const count = data?.currentCount || 0;
        const cost = data?.currentCost || 0;
        const rate = data?.unitCost || 0;

        return (
          <Card key={cat.key}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">
                  {cat.label}
                </span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
              </div>
              <p className="text-2xl font-semibold">
                {count}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {count === 1 ? cat.unitLabel : cat.unitLabelPlural}
                </span>
              </p>
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>
                  {formatCurrency(rate)} / {cat.unitLabel}
                </span>
                <span className="font-medium text-foreground">
                  {formatCurrency(cost)}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Estimated total card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">
              Estimated Total
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
              <TrendingUp className="h-4 w-4 text-orange-500" />
            </div>
          </div>
          <p className="text-2xl font-semibold">
            {formatCurrency(baseAmount + totalUsageCost)}
          </p>
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span>Base: {formatCurrency(baseAmount)}</span>
            <span>Usage: {formatCurrency(totalUsageCost)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Usage History Chart ──────────────────────────────────────────────

function UsageHistoryChart({
  usageData,
}: {
  usageData: Record<
    string,
    {
      monthlyAggregates: {
        month: string;
        count: number;
        totalCost: number;
      }[];
    }
  >;
}) {
  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    for (const cat of USAGE_CATEGORIES) {
      config[cat.key] = { label: cat.label, color: cat.color };
    }
    return config;
  }, []);

  const chartData = useMemo(() => {
    // Always show last 6 months, backfill with zeros
    const months = getLastNMonths(6);

    return months.map((month) => {
      const row: Record<string, string | number> = {
        month: formatMonthLabel(month),
      };
      for (const cat of USAGE_CATEGORIES) {
        const agg = usageData[cat.key]?.monthlyAggregates || [];
        const found = agg.find((a) => a.month === month);
        row[cat.key] = found?.count || 0;
      }
      return row;
    });
  }, [usageData]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Usage History</CardTitle>
        <p className="text-xs text-muted-foreground">
          Monthly usage over the last 6 months
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[280px] w-full">
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-border"
            />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {USAGE_CATEGORIES.length > 1 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
            {USAGE_CATEGORIES.map((cat) => (
              <Bar
                key={cat.key}
                dataKey={cat.key}
                stackId="usage"
                fill={`var(--color-${cat.key})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ── Usage Event Log ──────────────────────────────────────────────────

function UsageEventLog({
  events,
  categoryKey,
}: {
  events: UsageEvent[];
  categoryKey: string;
}) {
  const config = getCategoryConfig(categoryKey);

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No usage recorded this billing period
      </p>
    );
  }

  const totalCost = events.reduce((sum, e) => sum + e.unitCost, 0);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-primary/5">
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
                Date
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
                Ref
              </th>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
                Customer
              </th>
              <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b last:border-0">
                <td className="py-2.5 px-3 text-sm text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </td>
                <td className="py-2.5 px-3 text-sm font-mono text-muted-foreground">
                  {event.ref || "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-muted-foreground">
                  {event.customerName || "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-muted-foreground">
                  {formatCurrency(event.unitCost, event.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {events.length}{" "}
        {events.length === 1
          ? config?.unitLabel
          : config?.unitLabelPlural}{" "}
        · {formatCurrency(totalCost)} total
      </p>
    </div>
  );
}

function UsageEventLogSection({
  usageData,
}: {
  usageData: Record<string, { events: UsageEvent[] }>;
}) {
  const categories = USAGE_CATEGORIES;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Activity Log</CardTitle>
        <p className="text-xs text-muted-foreground">
          Metered usage events this billing period
        </p>
      </CardHeader>
      <CardContent>
        {categories.length > 1 ? (
          <div className="space-y-6">
            {categories.map((cat) => (
              <div key={cat.key}>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <cat.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {cat.label}
                </h4>
                <UsageEventLog
                  events={usageData[cat.key]?.events || []}
                  categoryKey={cat.key}
                />
              </div>
            ))}
          </div>
        ) : (
          <UsageEventLog
            events={usageData[categories[0].key]?.events || []}
            categoryKey={categories[0].key}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Invoice History Table ────────────────────────────────────────────

function InvoiceHistoryTable({
  invoices,
  onViewInvoice,
}: {
  invoices: TenantSubscriptionInvoice[];
  onViewInvoice: (invoice: TenantSubscriptionInvoice) => void;
}) {
  if (invoices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No invoices yet</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-primary/5">
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
              Period
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">
              Base
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">
              Usage
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">
              Total
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
              Status
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const hasUsageBreakdown = inv.base_amount != null;
            return (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="py-2.5 px-3 text-sm text-muted-foreground">
                  {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-muted-foreground">
                  {hasUsageBreakdown
                    ? formatCurrencyFromCents(inv.base_amount!, inv.currency)
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-muted-foreground">
                  {hasUsageBreakdown && inv.usage_amount
                    ? `${formatCurrencyFromCents(inv.usage_amount, inv.currency)} (${inv.usage_quantity || 0})`
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-right font-medium">
                  {formatCurrencyFromCents(inv.amount_due, inv.currency)}
                </td>
                <td className="py-2.5 px-3 text-sm">
                  <span
                    className={
                      inv.status === "paid"
                        ? "text-green-500"
                        : inv.status === "open"
                          ? "text-orange-500"
                          : "text-muted-foreground"
                    }
                  >
                    {inv.status === "paid"
                      ? "Paid"
                      : inv.status === "open"
                        ? "Open"
                        : inv.status}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-sm">
                  <button
                    onClick={() => onViewInvoice(inv)}
                    className="text-primary hover:underline"
                  >
                    View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────

export function UsageDashboard({
  invoices,
  invoicesLoading,
  onViewInvoice,
}: {
  invoices: TenantSubscriptionInvoice[];
  invoicesLoading: boolean;
  onViewInvoice: (invoice: TenantSubscriptionInvoice) => void;
}) {
  const usageData = useUsageData();
  const { subscription } = useTenantSubscription();
  const { tenant } = useTenant();

  const stripeMode = tenant?.subscription_stripe_mode || "test";
  const baseAmountPounds = (subscription?.amount || 0) / 100;

  const totalUsageCost = USAGE_CATEGORIES.reduce(
    (sum, cat) => sum + (usageData[cat.key]?.currentCost || 0),
    0
  );
  const estimatedTotal = baseAmountPounds + totalUsageCost;

  const isLoading = USAGE_CATEGORIES.some(
    (cat) => usageData[cat.key]?.isLoading
  );
  const isLoadingHistory = USAGE_CATEGORIES.some(
    (cat) => usageData[cat.key]?.isLoadingHistory
  );

  const periodStart = subscription?.current_period_start ?? null;
  const periodEnd = subscription?.current_period_end ?? null;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-[130px] w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[320px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PeriodHeader
        periodStart={periodStart}
        periodEnd={periodEnd}
        estimatedTotal={estimatedTotal}
        stripeMode={stripeMode as "test" | "live"}
      />

      <UsageSummaryCards usageData={usageData} baseAmount={baseAmountPounds} />

      {!isLoadingHistory && <UsageHistoryChart usageData={usageData} />}

      <UsageEventLogSection usageData={usageData} />

      <div className="space-y-4">
        <h3 className="text-sm font-medium">Invoices</h3>
        {invoicesLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <InvoiceHistoryTable
            invoices={invoices}
            onViewInvoice={onViewInvoice}
          />
        )}
      </div>
    </div>
  );
}
