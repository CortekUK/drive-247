"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Tag } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useExpenses, type Expense } from "@/hooks/use-expenses";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { ExpenseCategoriesDialog } from "@/components/expenses/expense-categories-dialog";
import { ExpenseTabPanel } from "@/components/expenses/expense-tab-panel";

type TabKey = "overall" | "business" | "vehicle";

const TABS: Record<
  TabKey,
  { type: "all" | "business" | "vehicle"; scope: "overall" | "business" | "vehicle"; label: string; sub: string }
> = {
  overall: { type: "all", scope: "overall", label: "Overall", sub: "All expenses" },
  business: { type: "business", scope: "business", label: "Business-wide", sub: "Overheads" },
  vehicle: { type: "vehicle", scope: "vehicle", label: "Vehicle-wise", sub: "Vehicle costs" },
};

export default function ExpensesPage() {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || "USD";
  const { canEdit } = useManagerPermissions();
  const editable = canEdit("expenses");

  const [tab, setTab] = useState<TabKey>("overall");

  // Page-level data: drives the nav-card totals + mutations (invalidates all tabs).
  const {
    expenses: allExpenses,
    addExpenseAsync,
    updateExpenseAsync,
    deleteExpense,
    isDeleting,
    uploadReceipt,
    getReceiptUrl,
    removeReceiptFile,
  } = useExpenses("all");

  const totals = useMemo(() => {
    const acc = {
      overall: { total: 0, count: 0 },
      business: { total: 0, count: 0 },
      vehicle: { total: 0, count: 0 },
    };
    for (const e of allExpenses) {
      const a = Number(e.amount || 0);
      acc.overall.total += a;
      acc.overall.count += 1;
      if (e.vehicle_id) {
        acc.vehicle.total += a;
        acc.vehicle.count += 1;
      } else {
        acc.business.total += a;
        acc.business.count += 1;
      }
    }
    return acc;
  }, [allExpenses]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (e: Expense) => {
    setEditing(e);
    setDialogOpen(true);
  };

  const handleSubmit = async (input: any) => {
    if (editing) await updateExpenseAsync({ id: editing.id, ...input });
    else await addExpenseAsync(input);
  };

  const active = TABS[tab];

  return (
    <div className="container mx-auto space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium text-foreground">Expenses</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Track vehicle costs and business overheads, visualised.
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <Tag className="mr-2 h-4 w-4" />
              Categories
            </Button>
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Expense
            </Button>
          </div>
        )}
      </div>

      {/* Nav cards — total per scope, double as the tab switcher */}
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {(Object.keys(TABS) as TabKey[]).map((key) => {
          const t = TABS[key];
          const isActive = tab === key;
          const stat = totals[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={isActive}
              className={cn(
                "rounded-xl border p-4 text-left transition-all",
                isActive
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border/60 bg-card hover:border-border hover:bg-muted/30"
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-sm font-medium",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {t.label}
                </span>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full transition-colors",
                    isActive ? "bg-primary" : "bg-border"
                  )}
                />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(stat.total, currencyCode)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.sub} · {stat.count} item{stat.count === 1 ? "" : "s"}
              </p>
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      <ExpenseTabPanel
        key={tab}
        type={active.type}
        scope={active.scope}
        scopeLabel={active.label}
        currencyCode={currencyCode}
        editable={editable}
        onEdit={openEdit}
        onDelete={setDeleting}
        getReceiptUrl={getReceiptUrl}
      />

      {/* Manage categories */}
      <ExpenseCategoriesDialog open={categoriesOpen} onOpenChange={setCategoriesOpen} />

      {/* Add / Edit dialog */}
      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
        onSubmit={handleSubmit}
        uploadReceipt={uploadReceipt}
        getReceiptUrl={getReceiptUrl}
        removeReceiptFile={removeReceiptFile}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {deleting?.category} expense of{" "}
              {deleting ? formatCurrency(Number(deleting.amount), currencyCode) : ""} and its
              receipt. It will also be removed from your P&amp;L. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(ev) => {
                ev.preventDefault();
                if (deleting) {
                  deleteExpense(
                    { id: deleting.id, receipt_url: deleting.receipt_url },
                    { onSuccess: () => setDeleting(null) }
                  );
                }
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
