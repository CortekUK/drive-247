import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface ActiveRental {
  rental_id: string;
  customer_id: string;
  customer_name: string;
  vehicle_id: string;
  vehicle_reg: string;
  vehicle_make: string;
  vehicle_model: string;
}

export const useActiveRentals = () => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["active-rentals", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          customer_id,
          vehicle_id,
          customers!rentals_customer_id_fkey(id, name),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model)
        `)
        .eq("tenant_id", tenant.id)
        .eq("status", "Active")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Filter out rentals with missing customer or vehicle
      return data
        .filter(rental => rental.customers && rental.vehicles)
        .map(rental => ({
          rental_id: rental.id,
          customer_id: rental.customer_id,
          customer_name: (rental.customers as any).name,
          vehicle_id: rental.vehicle_id,
          vehicle_reg: (rental.vehicles as any).reg,
          vehicle_make: (rental.vehicles as any).make,
          vehicle_model: (rental.vehicles as any).model,
        })) as ActiveRental[];
    },
    enabled: !!tenant,
  });
};