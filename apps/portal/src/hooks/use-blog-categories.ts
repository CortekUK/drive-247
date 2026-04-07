import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import type { BlogCategory, BlogCategoryWithCount } from "@/types/blog";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export function useBlogCategories() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const {
    data: categories = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["blog-categories", tenant?.id],
    queryFn: async () => {
      // Fetch categories with post counts
      const { data, error } = await (supabase as any)
        .from("blog_categories")
        .select("*, blog_posts(count)")
        .eq("tenant_id", tenant!.id)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;

      return (data || []).map((cat: any) => ({
        ...cat,
        post_count: cat.blog_posts?.[0]?.count ?? 0,
        blog_posts: undefined,
      })) as BlogCategoryWithCount[];
    },
    enabled: !!tenant?.id,
  });

  const createCategory = useMutation({
    mutationFn: async (input: {
      name: string;
      slug?: string;
      description?: string;
      display_order?: number;
    }) => {
      const slug = input.slug || generateSlug(input.name);
      if (!slug) throw new Error("Category name must produce a valid slug");

      const { data, error } = await (supabase as any)
        .from("blog_categories")
        .insert({
          tenant_id: tenant!.id,
          name: input.name,
          slug,
          description: input.description || null,
          display_order: input.display_order ?? 0,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("A category with this slug already exists");
        }
        throw error;
      }

      logAction({
        action: "blog_category_created",
        entityType: "blog_category",
        entityId: data.id,
        details: { name: input.name, slug },
      });

      return data as BlogCategory;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["blog-categories", tenant?.id],
      });
      toast({ title: "Category created" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create category",
        variant: "destructive",
      });
    },
  });

  const updateCategory = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      slug?: string;
      description?: string;
      display_order?: number;
    }) => {
      const updates: Record<string, any> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.slug !== undefined) updates.slug = input.slug;
      if (input.description !== undefined) updates.description = input.description;
      if (input.display_order !== undefined) updates.display_order = input.display_order;

      const { data, error } = await (supabase as any)
        .from("blog_categories")
        .update(updates)
        .eq("id", input.id)
        .eq("tenant_id", tenant!.id)
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("A category with this slug already exists");
        }
        throw error;
      }

      logAction({
        action: "blog_category_updated",
        entityType: "blog_category",
        entityId: input.id,
        details: updates,
      });

      return data as BlogCategory;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["blog-categories", tenant?.id],
      });
      toast({ title: "Category updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update category",
        variant: "destructive",
      });
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("blog_categories")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenant!.id);

      if (error) throw error;

      logAction({
        action: "blog_category_deleted",
        entityType: "blog_category",
        entityId: id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["blog-categories", tenant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["blog-posts", tenant?.id],
      });
      toast({ title: "Category deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete category",
        variant: "destructive",
      });
    },
  });

  return {
    categories,
    isLoading,
    error,
    createCategory: createCategory.mutateAsync,
    updateCategory: updateCategory.mutateAsync,
    deleteCategory: deleteCategory.mutateAsync,
    isCreating: createCategory.isPending,
    isUpdating: updateCategory.isPending,
    isDeleting: deleteCategory.isPending,
  };
}
