"use client";

import { useMemo, useState } from "react";
import { KPICard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Receipt,
  Plus,
  Search,
  Download,
  MoreVertical,
  Pencil,
  Trash2,
  FileText,
  Wallet,
  Car,
  Building2,
  Repeat,
  ExternalLink,
  Tag,
} from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useExpenseCategories } from "@/hooks/use-expense-categories";
import { useExpenses, type Expense, type ExpenseScope } from "@/hooks/use-expenses";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { ExpenseCategoriesDialog } from "@/components/expenses/expense-categories-dialog";

type RangePreset = "all" | "this_month" | "last_30" | "this_year";

function presetToRange(preset: RangePreset): { from?: string; to?: string } {
  if (preset === "all") return {};
  const now = new Date();
  const iso = (d: Date) => d.toISOString().split("T")[0];
  if (preset === "this_month") {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
  if (preset === "last_30") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return { from: iso(d), to: iso(now) };
  }
  // this_year
  return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
}

export default function ExpensesPage() {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || "USD";
  const { canEdit } = useManagerPermissions();
  const editable = canEdit("expenses");
  const { categories } = useExpenseCategories();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [scope, setScope] = useState<ExpenseScope>("all");
  const [preset, setPreset] = useState<RangePreset>("this_year");

  const range = useMemo(() => presetToRange(preset), [preset]);

  const {
    expenses,
    stats,
    isLoading,
    addExpenseAsync,
    updateExpenseAsync,
    deleteExpense,
    isDeleting,
    uploadReceipt,
    getReceiptUrl,
  } = useExpenses({ search, category, scope, ...range });

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
    if (editing) {
      await updateExpenseAsync({ id: editing.id, ...input });
    } else {
      await addExpenseAsync(input);
    }
  };

  const viewReceipt = async (path: string) => {
    const url = await getReceiptUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const exportCsv = () => {
    const headers = [
      "Date",
      "Category",
      "Type",
      "Vehicle",
      "Vendor",
      "Payment Method",
      "Reference",
      "Amount",
      "Recurring",
      "Notes",
    ];
    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = expenses.map((e) =>
      [
        e.expense_date,
        e.category,
        e.vehicle_id ? "Vehicle" : "Business",
        e.vehicle ? `${e.vehicle.reg ?? ""}` : "",
        e.vendor ?? "",
        e.payment_method ?? "",
        e.reference ?? "",
        Number(e.amount).toFixed(2),
        e.is_recurring ? e.recurrence_interval ?? "yes" : "",
        e.notes ?? "",
      ]
        .map(escape)
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const topCategoryLabel = stats.topCategories[0]
    ? `${stats.topCategories[0].name}`
    : "—";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium text-foreground">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track vehicle costs and business overheads in one place.
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <Tag className="h-4 w-4 mr-2" />
              Categories
            </Button>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Expense
            </Button>
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KPICard
          title="Total Spent"
          value={formatCurrency(stats.total, currencyCode)}
          subtitle={`${stats.count} expense${stats.count === 1 ? "" : "s"}`}
          icon={<Wallet className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <KPICard
          title="Vehicle Costs"
          value={formatCurrency(stats.vehicleTotal, currencyCode)}
          subtitle="Tied to vehicles"
          valueClassName="text-foreground"
          icon={<Car className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <KPICard
          title="Business / Overhead"
          value={formatCurrency(stats.businessTotal, currencyCode)}
          subtitle="Not tied to a vehicle"
          icon={<Building2 className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <KPICard
          title="Top Category"
          value={topCategoryLabel}
          subtitle={
            stats.topCategories[0]
              ? formatCurrency(stats.topCategories[0].amount, currencyCode)
              : "No spend yet"
          }
          icon={<Receipt className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor, notes, reference..."
              className="pl-8"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={(v) => setScope(v as ExpenseScope)}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="vehicle">Vehicle only</SelectItem>
              <SelectItem value="business">Business only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="last_30">Last 30 days</SelectItem>
              <SelectItem value="this_year">This year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!expenses.length}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary/5 hover:bg-primary/5">
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Vehicle / Type</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="hidden md:table-cell">Payment</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-16 text-center">Receipt</TableHead>
              {editable && <TableHead className="w-12 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={editable ? 8 : 7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={editable ? 8 : 7} className="py-12">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <Receipt className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No expenses found</p>
                    <p className="text-sm text-muted-foreground">
                      {search || category !== "all" || scope !== "all"
                        ? "Try adjusting your filters."
                        : "Add your first expense to start tracking."}
                    </p>
                    {editable && !search && category === "all" && scope === "all" && (
                      <Button variant="outline" size="sm" className="mt-2" onClick={openAdd}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Expense
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(e.expense_date + "T00:00:00").toLocaleDateString(undefined, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      {e.category}
                      {e.is_recurring && (
                        <Repeat className="h-3 w-3 text-muted-foreground" aria-label="Recurring" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {e.vehicle_id && e.vehicle ? (
                      <span className="text-sm">
                        {e.vehicle.reg}
                        <span className="text-muted-foreground">
                          {" "}
                          · {e.vehicle.make} {e.vehicle.model}
                        </span>
                      </span>
                    ) : (
                      <Badge variant="secondary" className="font-normal">
                        Business
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.vendor || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {e.payment_method || "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(Number(e.amount), currencyCode)}
                  </TableCell>
                  <TableCell className="text-center">
                    {e.receipt_url ? (
                      <button
                        type="button"
                        onClick={() => viewReceipt(e.receipt_url!)}
                        className="inline-flex items-center justify-center text-primary hover:text-primary/80"
                        title="View receipt"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(e)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          {e.receipt_url && (
                            <DropdownMenuItem onClick={() => viewReceipt(e.receipt_url!)}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View receipt
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(e)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {deleting?.category} expense of{" "}
              {deleting ? formatCurrency(Number(deleting.amount), currencyCode) : ""} and its
              receipt. It will also be removed from your P&amp;L. This can't be undone.
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
