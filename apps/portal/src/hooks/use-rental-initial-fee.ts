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
        .maybeSingle();

      if (error) {
        console.error("Error fetching initial fee:", error);
        return null;
      }

      return data;
    },
    enabled: !!rentalId && !!tenant?.id,
  });
};