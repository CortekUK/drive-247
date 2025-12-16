import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useRentalInitialFee = (rentalId: string | undefined) => {
  return useQuery({
    queryKey: ["rental-initial-fee", rentalId],
    queryFn: async () => {
      if (!rentalId) return null;
      
      const { data, error } = await supabase
        .from("payments")
        .select("amount, payment_date")
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
    enabled: !!rentalId,
  });
};