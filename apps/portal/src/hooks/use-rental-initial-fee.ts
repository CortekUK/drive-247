import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export const useRentalInitialFee = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-initial-fee", rentalId, tenant?.id],
    queryFn: async () => {
      if (!rentalId || !tenant?.id) return null;

      const { data, error } = await supabase
        .from("payments")
        .select("amount, payment_date")
        .eq("tenant_id", tenant.id)
        .eq("rental_id", rentalId)
        .eq("payment_type", "InitialFee")
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No initial fee found
          return null;
        }
        throw error;
      }

      return data;
    },
    enabled: !!rentalId && !!tenant?.id,
  });
};