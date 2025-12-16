import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface CustomerPayment {
  id: string;
  amount: number;
  payment_date: string;
  method: string;
  payment_type: string;
  status: string;
  remaining_amount: number;
  created_at: string;
  vehicle: {
    id: string;
    reg: string;
  } | null;
  rental: {
    id: string;
  } | null;
}

export const useCustomerPayments = (customerId: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-payments", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("payments")
        .select(`
          id,
          amount,
          payment_date,
          method,
          payment_type,
          status,
          remaining_amount,
          created_at,
          vehicles(id, reg),
          rentals(id)
        `)
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .order("payment_date", { ascending: false });
      
      if (error) throw error;
      
      return data.map(payment => ({
        ...payment,
        vehicle: payment.vehicles as any,
        rental: payment.rentals as any
      })) as CustomerPayment[];
    },
    enabled: !!tenant && !!customerId,
  });
};

export const useCustomerPaymentStats = (customerId: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-payment-stats", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("ledger_entries")
        .select("amount, type")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .eq("type", "Payment");
      
      if (error) throw error;
      
      const totalPayments = data.reduce((sum, entry) => sum + Number(entry.amount), 0);
      const paymentCount = data.length;
      
      return {
        totalPayments,
        paymentCount
      };
    },
    enabled: !!tenant && !!customerId,
  });
};