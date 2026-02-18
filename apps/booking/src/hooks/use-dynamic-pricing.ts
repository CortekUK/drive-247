import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import type { Holiday, VehicleOverride } from '@/lib/calculate-rental-price';

export const useDynamicPricing = (vehicleId?: string) => {
  const { tenant } = useTenant();

  const { data, isLoading } = useQuery({
    queryKey: ['dynamic-pricing', tenant?.id, vehicleId],
    queryFn: async (): Promise<{ holidays: Holiday[]; vehicleOverrides: VehicleOverride[] }> => {
      if (!tenant?.id) return { holidays: [], vehicleOverrides: [] };

      // Fetch holidays and vehicle overrides in parallel
      const [holidaysRes, overridesRes] = await Promise.all([
        (supabase as any)
          .from('tenant_holidays')
          .select('*')
          .eq('tenant_id', tenant.id)
          .order('start_date', { ascending: true }),
        vehicleId
          ? (supabase as any)
              .from('vehicle_pricing_overrides')
              .select('*')
              .eq('vehicle_id', vehicleId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (holidaysRes.error) throw holidaysRes.error;
      if (overridesRes.error) throw overridesRes.error;

      return {
        holidays: (holidaysRes.data || []) as Holiday[],
        vehicleOverrides: (overridesRes.data || []) as VehicleOverride[],
      };
    },
    enabled: !!tenant?.id,
    staleTime: 60_000,
  });

  return {
    holidays: data?.holidays || [],
    vehicleOverrides: data?.vehicleOverrides || [],
    isLoading,
  };
};
