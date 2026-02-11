import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface SubscriptionPlan {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  features: string[];
  amount: number;
  currency: string;
  interval: string;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  is_active: boolean;
  sort_order: number;
  trial_days: number;
  created_at: string;
  updated_at: string;
}

export const useSubscriptionPlans = () => {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["subscription-plans", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("subscription_plans")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as SubscriptionPlan[];
    },
    enabled: !!tenant,
    staleTime: 60_000,
  });
};
