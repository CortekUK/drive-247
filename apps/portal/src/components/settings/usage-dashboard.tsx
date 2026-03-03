"use client";

import { useMemo } from "react";
import {
  useESignUsage,
  type ESignUsageEvent,
  type MonthlyUsageAggregate,
} from "@/hooks/use-esign-usage";
import { useTenantSubscription, TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { FileSignature, PoundSterling, Receipt } from "lucide-react";

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

// ------------------------------------------------------------------
// Current Period Summary
// ------------------------------------------------------------------
function CurrentPeriodSummary({
  currentCount,
  currentCost,
  unitCost,
  periodStart,
  periodEnd,
  baseAmount,
}: {
  currentCount: number;
  currentCost: number;
  unitCost: number;
  periodStart: string | null;
  periodEnd: string | null;
  baseAmount: number;
}) {
  const estimatedTotal = baseAmount + currentCost;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          Usage This Period
        </CardTitle>
        <p className="text-sm text-[#737373]">
          {formatDateLong(periodStart)} – {formatDateLong(periodEnd)}
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="rounded-lg border bg-[#f8fafc] p-4 text-center">
            <div className="flex items-center justify-center mb-1">
              <FileSignature className="h-4 w-4 text-[#6366f1] mr-1.5" />
            </div>
            <p className="text-2xl font-semibold text-[#080812]">{currentCount}</p>
            <p className="text-xs text-[#737373]">Agreements Sent</p>
          </div>
          <div className="rounded-lg border bg-[#f8fafc] p-4 text-center">
            <div className="flex items-center justify-center mb-1">
              <PoundSterling className="h-4 w-4 text-[#6366f1] mr-1.5" />
            </div>
            <p className="text-2xl font-semibold text-[#080812]">
              {formatCurrency(unitCost)}
            </p>
            <p className="text-xs text-[#737373]">Per Sign</p>
          </div>
          <div className="rounded-lg border bg-[#f8fafc] p-4 text-center">
            <div className="flex items-center justify-center mb-1">
              <Receipt className="h-4 w-4 text-[#6366f1] mr-1.5" />
            </div>
            <p className="text-2xl font-semibold text-[#080812]">
              {formatCurrency(currentCost)}
            </p>
            <p className="text-xs text-[#737373]">Usage This Month</p>
          </div>
        </div>
        <div className="text-sm text-[#404040] bg-[#f8fafc] rounded-lg border p-3">
          <span className="text-[#737373]">Estimated Invoice:</span>{" "}
          Base Plan: {formatCurrency(baseAmount)} + Usage: {formatCurrency(currentCost)} ={" "}
          <span className="font-semibold">{formatCurrency(estimatedTotal)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// Usage Event Log Table
// ------------------------------------------------------------------
function UsageEventLog({ events }: { events: ESignUsageEvent[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">E-Sign Usage Log</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#737373] py-4">
            No e-sign agreements sent this billing period
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalCost = events.reduce((sum, e) => sum + Number(e.unit_cost), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">E-Sign Usage Log</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[#eef2ff]">
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
                  Date
                </th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
                  Ref
                </th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
                  Customer
                </th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b last:border-0">
                  <td className="py-2.5 px-3 text-sm text-[#404040]">
                    {formatDateTime(event.created_at)}
                  </td>
                  <td className="py-2.5 px-3 text-sm font-mono text-[#404040]">
                    {event.rental_ref || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sm text-[#404040]">
                    {event.customer_name || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sm text-right text-[#404040]">
                    {formatCurrency(Number(event.unit_cost), event.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[#737373] mt-3">
          Showing {events.length} event{events.length !== 1 ? "s" : ""} · Total:{" "}
          {formatCurrency(totalCost)}
        </p>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// Historical Usage Chart
// ------------------------------------------------------------------
function UsageHistoryChart({ data }: { data: MonthlyUsageAggregate[] }) {
  const chartData = useMemo(() => {
    // Show up to last 12 months
    return data.slice(-12).map((d) => ({
      month: formatMonthLabel(d.month),
      usage: d.total_cost,
      count: d.count,
    }));
  }, [data]);

  if (chartData.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Usage History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12, fill: "#737373" }}
                axisLine={{ stroke: "#f1f5f9" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#737373" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === "usage") return [formatCurrency(value), "Usage"];
                  return [value, name];
                }}
                labelStyle={{ fontWeight: 600 }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #f1f5f9",
                  fontSize: 13,
                }}
              />
              <Bar
                dataKey="usage"
                fill="#6366f1"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// Updated Invoice History with base/usage split
// ------------------------------------------------------------------
function InvoiceHistoryTable({
  invoices,
  onViewInvoice,
}: {
  invoices: TenantSubscriptionInvoice[];
  onViewInvoice: (invoice: TenantSubscriptionInvoice) => void;
}) {
  if (invoices.length === 0) {
    return (
      <p className="text-sm text-[#737373] py-4">No invoices yet</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-[#eef2ff]">
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
              Period
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
              Base
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
              E-Signs
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
              Total
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
              Status
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-[#6366f1]">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const hasUsageBreakdown = inv.base_amount != null;
            return (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="py-2.5 px-3 text-sm text-[#404040]">
                  {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-[#404040]">
                  {hasUsageBreakdown
                    ? formatCurrencyFromCents(inv.base_amount!, inv.currency)
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-[#404040]">
                  {hasUsageBreakdown && inv.usage_amount
                    ? `${formatCurrencyFromCents(inv.usage_amount, inv.currency)} (${inv.usage_quantity || 0})`
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-right font-medium text-[#080812]">
                  {formatCurrencyFromCents(inv.amount_due, inv.currency)}
                </td>
                <td className="py-2.5 px-3 text-sm">
                  <span
                    className={
                      inv.status === "paid"
                        ? "text-[#16a34a]"
                        : inv.status === "open"
                          ? "text-[#d97706]"
                          : "text-[#737373]"
                    }
                  >
                    {inv.status === "paid" ? "Paid" : inv.status === "open" ? "Open" : inv.status}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-sm">
                  <button
                    onClick={() => onViewInvoice(inv)}
                    className="text-[#6366f1] hover:underline"
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

// ------------------------------------------------------------------
// Main Export
// ------------------------------------------------------------------
export function UsageDashboard({
  invoices,
  invoicesLoading,
  onViewInvoice,
}: {
  invoices: TenantSubscriptionInvoice[];
  invoicesLoading: boolean;
  onViewInvoice: (invoice: TenantSubscriptionInvoice) => void;
}) {
  const {
    currentEvents,
    currentCount,
    currentCost,
    unitCost,
    periodStart,
    periodEnd,
    monthlyAggregates,
    isLoading,
    isLoadingHistory,
  } = useESignUsage();
  const { subscription } = useTenantSubscription();

  // Base plan amount in pounds (from cents)
  const baseAmountPounds = (subscription?.amount || 0) / 100;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[200px] w-full rounded-xl" />
        <Skeleton className="h-[200px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CurrentPeriodSummary
        currentCount={currentCount}
        currentCost={currentCost}
        unitCost={unitCost}
        periodStart={periodStart}
        periodEnd={periodEnd}
        baseAmount={baseAmountPounds}
      />

      <UsageEventLog events={currentEvents} />

      {!isLoadingHistory && monthlyAggregates.length >= 2 && (
        <UsageHistoryChart data={monthlyAggregates} />
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[#080812]">Invoices</h3>
        {invoicesLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
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
