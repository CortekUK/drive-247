import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Returns true when the current tenant has at least one active FAQ.
 *
 * Used to conditionally surface a direct "FAQ" link in the navigation and
 * footer — we only link to /faq when there is content to show, so tenants
 * without FAQs don't get a dead link to an empty page.
 */
export function useHasFaqs(): boolean {
  const { tenant } = useTenant();

  const { data } = useQuery({
    queryKey: ["has-faqs", tenant?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("faqs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant!.id)
        .eq("is_active", true);

      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
  });

  return data ?? false;
}
