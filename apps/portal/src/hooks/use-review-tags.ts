import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export function useReviewTags() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["review-tags", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("review_tags")
        .select("id, name")
        .eq("tenant_id", tenant!.id)
        .order("name");

      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: !!tenant,
  });
}

export function useCreateReviewTag() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await (supabase as any)
        .from("review_tags")
        .insert({ tenant_id: tenant!.id, name: name.trim() })
        .select("id, name")
        .single();

      if (error) throw error;
      return data as { id: string; name: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-tags", tenant?.id] });
    },
  });
}
