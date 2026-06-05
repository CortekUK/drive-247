"use client";

import { useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import {
  groupSpendByMonth,
  distributionByCategory,
  distributionByVehicle,
} from "@/lib/expense-utils";
import { useExpenses, type Expense, type ExpenseType } from "@/hooks/use-expenses";
import { useExpenseSummary, type SummaryScope } from "@/hooks/use-expense-summary";
import { ExpenseLineChart } from "@/components/expenses/expense-line-chart";
import { ExpensePieChart } from "@/components/expenses/expense-pie-chart";
import { ExpenseAiSummary } from "@/components/expenses/expense-ai-summary";
import { ExpenseExportButtons } from "@/components/expenses/expense-export-buttons";
import { ExpenseTable } from "@/components/expenses/expense-table";

interface Props {
  type: ExpenseType;
  scope: SummaryScope;
  scopeLabel: string;
  currencyCode: string;
  editable: boolean;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  getReceiptUrl: (path: string, opts?: { download?: boolean }) => Promise<string | null>;
}

type RangeKey = "3m" | "6m" | "12m" | "all";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "12m", label: "12M" },
  { key: "all", label: "All" },
];

function rangeCutoff(key: RangeKey): Date | null {
  if (key === "all") return null;
  const months = key === "3m" ? 3 : key === "6m" ? 6 : 12;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function ExpenseTabPanel({
  type,
  scope,
  scopeLabel,
  currencyCode,
  editable,
  onEdit,
  onDelete,
  getReceiptUrl,
}: Props) {
  const { expenses, isLoading } = useExpenses(type);
  const captureRef = useRef<HTMLDivElement>(null);

  // Time range scopes the charts + table + totals (not the AI summary, which is holistic).
  const [range, setRange] = useState<RangeKey>("all");
  // Vehicle-wise tab can break the pie down by vehicle or by category.
  const [vehicleMode, setVehicleMode] = useState<"vehicle" | "category">("vehicle");
  const showByVehicle = scope === "vehicle" && vehicleMode === "vehicle";

  const filtered = useMemo(() => {
    const cutoff = rangeCutoff(range);
    if (!cutoff) return expenses;
    return expenses.filter((e) => new Date(e.expense_at) >= cutoff);
  }, [expenses, range]);

  const monthly = useMemo(() => groupSpendByMonth(filtered), [filtered]);
  const distribution = useMemo(
    () => (showByVehicle ? distributionByVehicle(filtered) : distributionByCategory(filtered)),
    [filtered, showByVehicle]
  );
  const filteredTotal = useMemo(
    () => filtered.reduce((s, e) => s + Number(e.amount || 0), 0),
    [filtered]
  );

  // AI summary works over the full set for the scope (all-time), independent of range.
  const allTotal = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses]
  );
  const aiCurrent = { count: expenses.length, total: allTotal };

  const rangeToggle = (
    <div className="inline-flex rounded-lg border border-border p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => setRange(r.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            range === r.key
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  const breakdownToggle =
    scope === "vehicle" ? (
      <div className="inline-flex rounded-lg border border-border p-0.5">
        {(["vehicle", "category"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setVehicleMode(m)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              vehicleMode === m
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m}
          </button>
        ))}
      </div>
    ) : undefined;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[320px] w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[280px] rounded-xl" />
          <Skeleton className="h-[280px] rounded-xl" />
        </div>
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{filtered.length}</span> expense
          {filtered.length === 1 ? "" : "s"} ·{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(filteredTotal, currencyCode)}
          </span>{" "}
          total
          {range !== "all" && <span className="text-muted-foreground/70"> · in range</span>}
        </p>
        <div className="flex items-center gap-2">
          {rangeToggle}
          <ExpenseExportButtons
            rows={filtered}
            currencyCode={currencyCode}
            scopeLabel={scopeLabel}
            captureRef={captureRef}
          />
        </div>
      </div>

      <div ref={captureRef} className="space-y-4 bg-background">
        <ExpenseLineChart data={monthly} currencyCode={currencyCode} />
        <div className="grid gap-4 lg:grid-cols-2">
          <ExpensePieChart
            data={distribution}
            currencyCode={currencyCode}
            title={showByVehicle ? "Spend by vehicle" : "Spend by category"}
            subtitle={showByVehicle ? "Which vehicles cost most" : "Where the money goes"}
            headerRight={breakdownToggle}
          />
          <ExpenseAiSummary
            scope={scope}
            current={aiCurrent}
            currencyCode={currencyCode}
            canGenerate={editable}
          />
        </div>
      </div>

      <ExpenseTable
        rows={filtered}
        currencyCode={currencyCode}
        showVehicle={scope !== "business"}
        editable={editable}
        onEdit={onEdit}
        onDelete={onDelete}
        getReceiptUrl={getReceiptUrl}
      />
    </div>
  );
}
