import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";

export type ExpenseType = "all" | "business" | "vehicle";

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
  expense_at: string;
  expense_date: string;
  category: string;
  amount: number;
  receipt_url: string | null;
  created_by: string | null;
  created_at: string;
  vehicle?: ExpenseVehicleRef | null;
}

export interface ExpenseInput {
  /** ISO timestamp from the date+time picker. */
  expense_at: string;
  category: string;
  amount: number;
  vehicle_id?: string | null;
  receipt_url?: string | null;
  /** previous receipt path — removed from storage if it changed (avoids orphans). */
  previous_receipt_url?: string | null;
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

/**
 * Loads a tenant's expenses for one tab/scope. The whole set is returned (the
 * charts need full history); the table paginates client-side. `type` filters to
 * business (no vehicle) or vehicle (has vehicle).
 */
export function useExpenses(type: ExpenseType = "all") {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();

  const listQuery = useQuery({
    queryKey: ["expenses", tenant?.id, type],
    queryFn: async () => {
      let q = supabase
        .from("vehicle_expenses")
        .select("*, vehicle:vehicles(id, reg, make, model)")
        .eq("tenant_id", tenant!.id)
        .order("expense_at", { ascending: false });
      if (type === "business") q = q.is("vehicle_id", null);
      if (type === "vehicle") q = q.not("vehicle_id", "is", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as Expense[];
    },
    enabled: !!tenant,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses", tenant?.id] });
    DEPENDENT_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };

  /** Best-effort removal of a stored receipt; never throws. */
  const removeReceiptFile = async (path?: string | null) => {
    if (!path) return;
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]).catch(() => {});
  };

  const addExpense = useMutation({
    mutationFn: async (input: ExpenseInput) => {
      if (!tenant?.id) throw new Error("No tenant context");
      const { data, error } = await supabase
        .from("vehicle_expenses")
        .insert({
          tenant_id: tenant.id,
          vehicle_id: input.vehicle_id || null,
          expense_at: input.expense_at,
          // Keep expense_date (date part) in sync so the P&L trigger keeps working.
          expense_date: input.expense_at.slice(0, 10),
          category: input.category,
          amount: input.amount,
          receipt_url: input.receipt_url || null,
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
    mutationFn: async ({ id, previous_receipt_url, ...input }: ExpenseInput & { id: string }) => {
      const { error } = await supabase
        .from("vehicle_expenses")
        .update({
          vehicle_id: input.vehicle_id || null,
          expense_at: input.expense_at,
          expense_date: input.expense_at.slice(0, 10),
          category: input.category,
          amount: input.amount,
          receipt_url: input.receipt_url ?? null,
        } as any)
        .eq("id", id)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      if (previous_receipt_url && previous_receipt_url !== (input.receipt_url ?? null)) {
        await removeReceiptFile(previous_receipt_url);
      }
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
      await removeReceiptFile(expense.receipt_url);
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
    const path = `${tenant.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    return path;
  };

  /** Short-lived signed URL to view (or, with download, save) a stored receipt. */
  const getReceiptUrl = async (
    path: string,
    opts?: { download?: boolean }
  ): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(path, 60 * 10, opts?.download ? { download: true } : undefined);
    if (error) {
      toast({ title: "Couldn't open receipt", description: error.message, variant: "destructive" });
      return null;
    }
    return data?.signedUrl ?? null;
  };

  return {
    expenses: listQuery.data || [],
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    addExpenseAsync: addExpense.mutateAsync,
    updateExpenseAsync: updateExpense.mutateAsync,
    deleteExpense: deleteExpense.mutate,
    isDeleting: deleteExpense.isPending,
    uploadReceipt,
    getReceiptUrl,
    removeReceiptFile,
  };
}
