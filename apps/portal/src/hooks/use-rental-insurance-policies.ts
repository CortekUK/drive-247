import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface InsurancePolicy {
  id: string;
  rental_id: string;
  tenant_id: string;
  customer_id: string;
  policy_type: 'original' | 'extension';
  quote_id: string;
  quote_no: string | null;
  payment_id: string | null;
  policy_id: string | null;
  policy_no: string | null;
  coverage_types: any;
  trip_start_date: string;
  trip_end_date: string;
  pickup_state: string;
  premium_amount: number;
  renter_details: any;
  status: string;
  policy_issued_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export function useRentalInsurancePolicies(rentalId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['rental-insurance-policies', rentalId, tenant?.id],
    queryFn: async () => {
      if (!rentalId) return [];

      const { data, error } = await supabase
        .from('bonzah_insurance_policies')
        .select('*')
        .eq('rental_id', rentalId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching rental insurance policies:', error);
        throw error;
      }

      return (data || []) as InsurancePolicy[];
    },
    enabled: !!rentalId && !!tenant,
    // Poll every 5s if any policy is in a pending state
    refetchInterval: (query) => {
      const policies = query.state.data;
      if (!policies) return false;
      const hasPending = policies.some(
        (p) => p.status === 'quoted' || p.status === 'payment_pending'
      );
      return hasPending ? 5000 : false;
    },
  });
}
