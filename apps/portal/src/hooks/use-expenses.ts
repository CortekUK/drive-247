import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";

export type RecurrenceInterval = "monthly" | "yearly";

export interface ExpenseVehicleRef {
  id: string;
  reg: string | null;
  make: string | null;
  model: string | null;
}

export interface Expense {
  id: string;
  tenant_id: string | null;
  vehicle_id: string | null;
  expense_date: string;
  category: string;
  amount: number;
  vendor: string | null;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  receipt_url: string | null;
  is_recurring: boolean;
  recurrence_interval: RecurrenceInterval | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  vehicle?: ExpenseVehicleRef | null;
}

export type ExpenseScope = "all" | "vehicle" | "business";

export interface ExpenseFilters {
  search?: string;
  /** category name, or "all" */
  category?: string;
  scope?: ExpenseScope;
  /** specific vehicle id, or undefined for any */
  vehicleId?: string;
  /** ISO date (yyyy-MM-dd) inclusive */
  from?: string;
  to?: string;
}

export interface ExpenseInput {
  expense_date: string;
  category: string;
  amount: number;
  vehicle_id?: string | null;
  vendor?: string | null;
  payment_method?: string | null;
  reference?: string | null;
  notes?: string | null;
  receipt_url?: string | null;
  is_recurring?: boolean;
  recurrence_interval?: RecurrenceInterval | null;
}

const RECEIPT_BUCKET = "expense-receipts";

// P&L dashboard + vehicle detail caches that depend on expense data.
const DEPENDENT_KEYS = [
  "pl-summary",
  "vehicle-pl",
  "monthly-pl",
  "plSummary",
  "vehiclePLData",
  "monthlyPLData",
  "plEntries",
  "vehicleExpenses",
  "vehicle-events",
];

export function useExpenses(filters: ExpenseFilters = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();

  const { search, category, scope = "all", vehicleId, from, to } = filters;

  const listQuery = useQuery({
    queryKey: ["expenses", tenant?.id, { category, scope, vehicleId, from, to }],
    queryFn: async () => {
      let q = supabase
        .from("vehicle_expenses")
        .select(
          "*, vehicle:vehicles(id, reg, make, model)"
        )
        .eq("tenant_id", tenant!.id)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (from) q = q.gte("expense_date", from);
      if (to) q = q.lte("expense_date", to);
      if (category && category !== "all") q = q.eq("category", category);
      if (scope === "business") q = q.is("vehicle_id", null);
      if (scope === "vehicle") q = q.not("vehicle_id", "is", null);
      if (vehicleId) q = q.eq("vehicle_id", vehicleId);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as Expense[];
    },
    enabled: !!tenant,
  });

  // Client-side free-text search across vendor / notes / reference / category / reg.
  const expenses = useMemo(() => {
    const rows = listQuery.data || [];
    const term = search?.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((e) => {
      const hay = [
        e.category,
        e.vendor,
        e.notes,
        e.reference,
        e.payment_method,
        e.vehicle?.reg,
        e.vehicle ? `${e.vehicle.make ?? ""} ${e.vehicle.model ?? ""}` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [listQuery.data, search]);

  const stats = useMemo(() => {
    const rows = expenses;
    const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
    const businessTotal = rows
      .filter((e) => !e.vehicle_id)
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const vehicleTotal = total - businessTotal;

    const byCategory = new Map<string, number>();
    for (const e of rows) {
      byCategory.set(e.category, (byCategory.get(e.category) || 0) + Number(e.amount || 0));
    }
    const topCategories = [...byCategory.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      total,
      count: rows.length,
      businessTotal,
      vehicleTotal,
      recurringCount: rows.filter((e) => e.is_recurring).length,
      topCategories,
    };
  }, [expenses]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses", tenant?.id] });
    DEPENDENT_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };

  const addExpense = useMutation({
    mutationFn: async (input: ExpenseInput) => {
      if (!tenant?.id) throw new Error("No tenant context");
      const { data, error } = await supabase
        .from("vehicle_expenses")
        .insert({
          tenant_id: tenant.id,
          vehicle_id: input.vehicle_id || null,
          expense_date: input.expense_date,
          category: input.category,
          amount: input.amount,
          vendor: input.vendor || null,
          payment_method: input.payment_method || null,
          reference: input.reference || null,
          notes: input.notes || null,
          receipt_url: input.receipt_url || null,
          is_recurring: input.is_recurring ?? false,
          recurrence_interval: input.is_recurring ? input.recurrence_interval ?? null : null,
          created_by: appUser?.id ?? null,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Expense added" });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't add expense", description: e?.message, variant: "destructive" }),
  });

  const updateExpense = useMutation({
    mutationFn: async ({ id, ...input }: ExpenseInput & { id: string }) => {
      const { error } = await supabase
        .from("vehicle_expenses")
        .update({
          vehicle_id: input.vehicle_id || null,
          expense_date: input.expense_date,
          category: input.category,
          amount: input.amount,
          vendor: input.vendor || null,
          payment_method: input.payment_method || null,
          reference: input.reference || null,
          notes: input.notes || null,
          receipt_url: input.receipt_url ?? null,
          is_recurring: input.is_recurring ?? false,
          recurrence_interval: input.is_recurring ? input.recurrence_interval ?? null : null,
        } as any)
        .eq("id", id)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Expense updated" });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't update expense", description: e?.message, variant: "destructive" }),
  });

  const deleteExpense = useMutation({
    mutationFn: async (expense: Pick<Expense, "id" | "receipt_url">) => {
      if (expense.receipt_url) {
        // Best-effort receipt cleanup; ignore failures so the row still deletes.
        await supabase.storage.from(RECEIPT_BUCKET).remove([expense.receipt_url]).catch(() => {});
      }
      const { error } = await supabase
        .from("vehicle_expenses")
        .delete()
        .eq("id", expense.id)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Expense deleted" });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't delete expense", description: e?.message, variant: "destructive" }),
  });

  /** Uploads a receipt to the private bucket and returns its storage path. */
  const uploadReceipt = async (file: File): Promise<string> => {
    if (!tenant?.id) throw new Error("No tenant context");
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const rand = Math.abs(
      Array.from(file.name + file.size + file.lastModified).reduce(
        (a, c) => (a * 31 + c.charCodeAt(0)) | 0,
        7
      )
    ).toString(36);
    const path = `${tenant.id}/${Date.now()}-${rand}.${ext}`;
    const { error } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    return path;
  };

  /** Creates a short-lived signed URL to view a stored receipt. */
  const getReceiptUrl = async (path: string): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(path, 60 * 10);
    if (error) return null;
    return data?.signedUrl ?? null;
  };

  return {
    expenses,
    stats,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    addExpense: addExpense.mutate,
    addExpenseAsync: addExpense.mutateAsync,
    updateExpense: updateExpense.mutate,
    updateExpenseAsync: updateExpense.mutateAsync,
    deleteExpense: deleteExpense.mutate,
    isAdding: addExpense.isPending,
    isUpdating: updateExpense.isPending,
    isDeleting: deleteExpense.isPending,
    uploadReceipt,
    getReceiptUrl,
  };
}
