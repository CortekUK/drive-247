import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export const useCustomerActiveRentals = (customerId: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-active-rentals", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("rentals")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .eq("status", "Active")
        .lte("start_date", new Date().toISOString().split('T')[0])
        .or(`end_date.is.null,end_date.gte.${new Date().toISOString().split('T')[0]}`);
      
      if (error) throw error;
      
      return data.length;
    },
    enabled: !!tenant && !!customerId,
  });
};