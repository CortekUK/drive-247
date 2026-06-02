import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

export type PnlBucket = "Service" | "Expenses";

export interface ExpenseCategory {
  id: string;
  tenant_id: string;
  name: string;
  pnl_bucket: PnlBucket;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryInput {
  name: string;
  pnl_bucket?: PnlBucket;
  sort_order?: number;
}

/**
 * Per-tenant expense categories. `activeOnly` (default) filters to the set the
 * operator can currently assign; pass false in the settings editor to manage all.
 */
export function useExpenseCategories(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? true;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["expense-categories", tenant?.id, activeOnly],
    queryFn: async () => {
      let q = supabase
        .from("expense_categories")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (activeOnly) q = q.eq("is_active", true);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ExpenseCategory[];
    },
    enabled: !!tenant,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expense-categories", tenant?.id] });
  };

  const addCategory = useMutation({
    mutationFn: async (input: CategoryInput) => {
      if (!tenant?.id) throw new Error("No tenant context");
      // Place new categories after existing ones.
      const maxOrder = (query.data || []).reduce((m, c) => Math.max(m, c.sort_order), 0);
      const { data, error } = await supabase
        .from("expense_categories")
        .insert({
          tenant_id: tenant.id,
          name: input.name.trim(),
          pnl_bucket: input.pnl_bucket ?? "Expenses",
          sort_order: input.sort_order ?? maxOrder + 10,
          is_default: false,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Category added" });
    },
    onError: (e: any) => {
      const dup = e?.code === "23505" || /duplicate|unique/i.test(e?.message || "");
      toast({
        title: dup ? "Category already exists" : "Couldn't add category",
        description: dup ? "Pick a different name." : e?.message,
        variant: "destructive",
      });
    },
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<ExpenseCategory> & { id: string }) => {
      const { error } = await supabase
        .from("expense_categories")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: any) =>
      toast({ title: "Couldn't update category", description: e?.message, variant: "destructive" }),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("expense_categories")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Category deleted" });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't delete category", description: e?.message, variant: "destructive" }),
  });

  return {
    categories: query.data || [],
    isLoading: query.isLoading,
    addCategory: addCategory.mutate,
    updateCategory: updateCategory.mutate,
    deleteCategory: deleteCategory.mutate,
    isMutating:
      addCategory.isPending || updateCategory.isPending || deleteCategory.isPending,
  };
}
