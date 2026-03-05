import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface CustomerInsurancePolicy {
  id: string;
  rental_id: string | null;
  policy_type: string;
  coverage_types: any;
  trip_start_date: string;
  trip_end_date: string;
  premium_amount: number;
  status: string;
  policy_issued_at: string | null;
  created_at: string | null;
}

export function useRentalInsurancePolicies(rentalId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['rental-insurance-policies', rentalId, tenant?.id],
    queryFn: async () => {
      if (!rentalId) return [];

      const { data, error } = await supabase
        .from('bonzah_insurance_policies')
        .select('id, rental_id, policy_type, coverage_types, trip_start_date, trip_end_date, premium_amount, status, policy_issued_at, created_at')
        .eq('rental_id', rentalId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching rental insurance policies:', error);
        return [];
      }

      return (data || []) as CustomerInsurancePolicy[];
    },
    enabled: !!rentalId && !!tenant,
  });
}
