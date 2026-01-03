import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface CustomerRental {
  id: string;
  start_date: string;
  end_date: string | null;
  monthly_amount: number;
  status: string;
  schedule: string;
  created_at: string;
  vehicle: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
}

export const useCustomerRentals = (customerId: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-rentals", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          start_date,
          end_date,
          monthly_amount,
          status,
          schedule,
          created_at,
          vehicles(id, reg, make, model)
        `)
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Filter out rentals with missing vehicle
      return data
        .filter(rental => rental.vehicles)
        .map(rental => ({
          ...rental,
          vehicle: rental.vehicles as any
        })) as CustomerRental[];
    },
    enabled: !!tenant && !!customerId,
  });
};