import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface CustomerReviewSummary {
  id: string;
  customer_id: string;
  tenant_id: string;
  summary: string | null;
  average_rating: number | null;
  total_reviews: number;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export const useCustomerReviewSummary = (customerId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-review-summary", tenant?.id, customerId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customer_review_summaries")
        .select("*")
        .eq("customer_id", customerId)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();

      if (error) throw error;
      return data as CustomerReviewSummary | null;
    },
    enabled: !!tenant && !!customerId,
  });
};
