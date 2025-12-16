import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface CustomerFine {
  id: string;
  type: string;
  reference_no: string | null;
  amount: number;
  issue_date: string;
  due_date: string;
  status: string;
  liability: string;
  notes: string | null;
  created_at: string;
  vehicle: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
}

export const useCustomerFines = (customerId: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-fines", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("fines")
        .select(`
          id,
          type,
          reference_no,
          amount,
          issue_date,
          due_date,
          status,
          liability,
          notes,
          created_at,
          vehicles!inner(id, reg, make, model)
        `)
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .order("issue_date", { ascending: false });
      
      if (error) throw error;
      
      return data.map(fine => ({
        ...fine,
        vehicle: fine.vehicles as any
      })) as CustomerFine[];
    },
    enabled: !!tenant && !!customerId,
  });
};

export const useCustomerFineStats = (customerId: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-fine-stats", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("fines")
        .select("amount, status")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId);
      
      if (error) throw error;
      
      const openFines = data.filter(fine => fine.status === 'Open');
      const totalFines = data.length;
      const openFineAmount = openFines.reduce((sum, fine) => sum + Number(fine.amount), 0);
      
      return {
        totalFines,
        openFines: openFines.length,
        openFineAmount
      };
    },
    enabled: !!tenant && !!customerId,
  });
};