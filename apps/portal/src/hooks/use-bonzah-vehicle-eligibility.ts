'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

interface UseBonzahVehicleEligibilityParams {
  vehicleMake: string | null;
  vehicleModel: string | null;
  enabled?: boolean;
}

interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

export function useBonzahVehicleEligibility({
  vehicleMake,
  vehicleModel,
  enabled = true,
}: UseBonzahVehicleEligibilityParams) {
  const { tenant } = useTenant();

  const query = useQuery<EligibilityResult>({
    queryKey: ['bonzah-vehicle-eligibility', vehicleMake, vehicleModel],
    queryFn: async (): Promise<EligibilityResult> => {
      const { data, error } = await supabase.functions.invoke('bonzah-check-vehicle-eligibility', {
        body: {
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
        },
      });

      if (error) {
        console.error('[useBonzahVehicleEligibility] Error:', error);
        // Fail-open: never block insurance due to technical failure
        return { eligible: true };
      }

      return data as EligibilityResult;
    },
    enabled: enabled && !!vehicleMake && !!vehicleModel && !!tenant?.integration_bonzah,
    staleTime: 10 * 60 * 1000,  // 10 minutes — vehicle eligibility is static
    gcTime: 30 * 60 * 1000,     // 30 minutes
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return {
    isEligible: query.data?.eligible ?? true,  // fail-open default
    isLoading: query.isLoading && query.fetchStatus !== 'idle',
    reason: query.data?.reason,
  };
}
