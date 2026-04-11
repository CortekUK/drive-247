import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface CustomerBonzahPolicy {
  id: string;
  rental_id: string | null;
  customer_id: string;
  policy_type: string | null;
  coverage_types: Record<string, boolean>;
  trip_start_date: string;
  trip_end_date: string;
  premium_amount: number;
  status: string;
  policy_no: string | null;
  policy_id: string | null;
  policy_issued_at: string | null;
  created_at: string | null;
  rentals: {
    id: string;
    rental_number: string;
    status: string;
    vehicles: {
      make: string | null;
      model: string | null;
      reg: string;
    } | null;
  } | null;
}

export function useCustomerInsurancePolicies() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-insurance-policies', customerUser?.customer_id],
    queryFn: async () => {
      if (!customerUser?.customer_id) return [];

      const { data, error } = await supabase
        .from('bonzah_insurance_policies')
        .select(`
          id, rental_id, customer_id, policy_type, coverage_types,
          trip_start_date, trip_end_date, premium_amount, status,
          policy_no, policy_id, policy_issued_at, created_at,
          rentals!bonzah_insurance_policies_rental_id_fkey(
            id, rental_number, status,
            vehicles(make, model, reg)
          )
        `)
        .eq('customer_id', customerUser.customer_id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching customer insurance policies:', error);
        return [];
      }

      return (data || []) as CustomerBonzahPolicy[];
    },
    enabled: !!customerUser?.customer_id,
  });
}
