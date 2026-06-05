"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Plus, Tag, LayoutGrid, Building2, Car } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useExpenses, type Expense } from "@/hooks/use-expenses";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { ExpenseCategoriesDialog } from "@/components/expenses/expense-categories-dialog";
import { ExpenseTabPanel } from "@/components/expenses/expense-tab-panel";

export default function ExpensesPage() {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || "USD";
  const { canEdit } = useManagerPermissions();
  const editable = canEdit("expenses");

  // Page-level mutations + receipt helpers (type-agnostic; invalidates all tabs).
  const {
    addExpenseAsync,
    updateExpenseAsync,
    deleteExpense,
    isDeleting,
    uploadReceipt,
    getReceiptUrl,
    removeReceiptFile,
  } = useExpenses("all");

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

  return (
    <div className="space-y-6">
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

      {/* Tabs */}
      <Tabs defaultValue="overall" className="space-y-5">
        <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
          <TabsTrigger value="overall" className="gap-1.5">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Overall</span>
            <span className="sm:hidden">All</span>
          </TabsTrigger>
          <TabsTrigger value="business" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Business-wide</span>
            <span className="sm:hidden">Business</span>
          </TabsTrigger>
          <TabsTrigger value="vehicle" className="gap-1.5">
            <Car className="h-4 w-4" />
            <span className="hidden sm:inline">Vehicle-wise</span>
            <span className="sm:hidden">Vehicle</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overall">
          <ExpenseTabPanel
            type="all"
            scope="overall"
            scopeLabel="Overall"
            currencyCode={currencyCode}
            editable={editable}
            onEdit={openEdit}
            onDelete={setDeleting}
            getReceiptUrl={getReceiptUrl}
          />
        </TabsContent>
        <TabsContent value="business">
          <ExpenseTabPanel
            type="business"
            scope="business"
            scopeLabel="Business-wide"
            currencyCode={currencyCode}
            editable={editable}
            onEdit={openEdit}
            onDelete={setDeleting}
            getReceiptUrl={getReceiptUrl}
          />
        </TabsContent>
        <TabsContent value="vehicle">
          <ExpenseTabPanel
            type="vehicle"
            scope="vehicle"
            scopeLabel="Vehicle-wise"
            currencyCode={currencyCode}
            editable={editable}
            onEdit={openEdit}
            onDelete={setDeleting}
            getReceiptUrl={getReceiptUrl}
          />
        </TabsContent>
      </Tabs>

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
