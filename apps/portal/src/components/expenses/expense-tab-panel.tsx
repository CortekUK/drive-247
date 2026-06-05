"use client";

import { useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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

  const monthly = useMemo(() => groupSpendByMonth(expenses), [expenses]);
  const distribution = useMemo(
    () => (scope === "vehicle" ? distributionByVehicle(expenses) : distributionByCategory(expenses)),
    [expenses, scope]
  );
  const total = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses]
  );
  const current = { count: expenses.length, total };

  // Shared with the AI card (same query key) — used for the PDF export text.
  const { summary } = useExpenseSummary(scope, current);

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{current.count}</span> expense
          {current.count === 1 ? "" : "s"} ·{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(total, currencyCode)}
          </span>{" "}
          total
        </p>
        <ExpenseExportButtons
          rows={expenses}
          currencyCode={currencyCode}
          scopeLabel={scopeLabel}
          captureRef={captureRef}
          summary={summary}
        />
      </div>

      <div ref={captureRef} className="space-y-4 bg-background">
        <ExpenseLineChart data={monthly} currencyCode={currencyCode} />
        <div className="grid gap-4 lg:grid-cols-2">
          <ExpensePieChart
            data={distribution}
            currencyCode={currencyCode}
            title={scope === "vehicle" ? "Spend by vehicle" : "Spend by category"}
            subtitle={scope === "vehicle" ? "Which vehicles cost most" : "Where the money goes"}
          />
          <ExpenseAiSummary scope={scope} current={current} canGenerate={editable} />
        </div>
      </div>

      <ExpenseTable
        rows={expenses}
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
