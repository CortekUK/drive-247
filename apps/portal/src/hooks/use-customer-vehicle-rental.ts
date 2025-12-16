import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useCustomerVehicleRental = (customerId: string, vehicleId: string) => {
  return useQuery({
    queryKey: ["customer-vehicle-rental", customerId, vehicleId],
    queryFn: async () => {
      if (!customerId || !vehicleId) return null;
      
      const { data, error } = await supabase
        .from("rentals")
        .select("id")
        .eq("customer_id", customerId)
        .eq("vehicle_id", vehicleId)
        .eq("status", "Active")
        .lte("start_date", new Date().toISOString().split('T')[0])
        .or(`end_date.is.null,end_date.gte.${new Date().toISOString().split('T')[0]}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      
      return data?.id || null;
    },
    enabled: !!customerId && !!vehicleId,
  });
};