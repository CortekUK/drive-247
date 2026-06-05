import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

export type CategoryType = "business" | "vehicle";

export interface ExpenseCategory {
  id: string;
  tenant_id: string;
  name: string;
  category_type: CategoryType;
  is_default: boolean;
  sort_order: number;
}

export interface CategoryInput {
  name: string;
  category_type: CategoryType;
}

/**
 * Per-tenant expense categories, tagged business or vehicle. The Add Expense
 * dialog filters this list by the chosen type.
 */
export function useExpenseCategories() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["expense-categories", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id, tenant_id, name, category_type, is_default, sort_order")
        .eq("tenant_id", tenant!.id)
        .order("category_type", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ExpenseCategory[];
    },
    enabled: !!tenant,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["expense-categories", tenant?.id] });

  /** How many expenses currently reference this category name (for safe delete). */
  const getUsageCount = async (name: string): Promise<number> => {
    const { count, error } = await supabase
      .from("vehicle_expenses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant!.id)
      .eq("category", name);
    if (error) throw error;
    return count ?? 0;
  };

  const addCategory = useMutation({
    mutationFn: async (input: CategoryInput) => {
      if (!tenant?.id) throw new Error("No tenant context");
      const maxOrder = (query.data || []).reduce((m, c) => Math.max(m, c.sort_order), 0);
      const { data, error } = await supabase
        .from("expense_categories")
        .insert({
          tenant_id: tenant.id,
          name: input.name.trim(),
          category_type: input.category_type,
          sort_order: maxOrder + 10,
          is_default: false,
          is_active: true,
        } as any)
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
    getUsageCount,
    addCategory: addCategory.mutate,
    deleteCategory: deleteCategory.mutate,
    isMutating: addCategory.isPending || deleteCategory.isPending,
  };
}
