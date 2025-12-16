import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CustomerVehicleHistory {
  rental_id: string;
  vehicle_id: string;
  vehicle_reg: string;
  vehicle_make: string;
  vehicle_model: string;
  start_date: string;
  end_date: string | null;
  status: string;
  monthly_amount: number;
}

export const useCustomerVehicleHistory = (customerId: string) => {
  return useQuery({
    queryKey: ["customer-vehicle-history", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          vehicle_id,
          start_date,
          end_date,
          status,
          monthly_amount,
          vehicles!inner(id, reg, make, model)
        `)
        .eq("customer_id", customerId)
        .order("start_date", { ascending: false });
      
      if (error) throw error;
      
      return data.map(rental => ({
        rental_id: rental.id,
        vehicle_id: rental.vehicle_id,
        vehicle_reg: (rental.vehicles as any).reg,
        vehicle_make: (rental.vehicles as any).make,
        vehicle_model: (rental.vehicles as any).model,
        start_date: rental.start_date,
        end_date: rental.end_date,
        status: rental.status,
        monthly_amount: rental.monthly_amount
      })) as CustomerVehicleHistory[];
    },
    enabled: !!customerId,
  });
};