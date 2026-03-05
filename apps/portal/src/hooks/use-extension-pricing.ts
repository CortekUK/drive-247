import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  calculateExtensionPrice,
  type WeekendConfig,
  type Holiday,
  type VehicleOverride,
  type DayBreakdown,
} from '@/lib/calculate-extension-price';

interface UseExtensionPricingParams {
  vehicleId?: string;
  currentEndDate?: string; // YYYY-MM-DD — extension starts from this date
  newEndDate?: string;     // YYYY-MM-DD — extension ends at this date
}

interface ExtensionPricingResult {
  extensionCost: number;
  extensionDays: number;
  dailyRate: number | null;
  dayBreakdown: DayBreakdown[];
  hasSurcharges: boolean;
  isLoading: boolean;
}

export function useExtensionPricing({
  vehicleId,
  currentEndDate,
  newEndDate,
}: UseExtensionPricingParams): ExtensionPricingResult {
  const { tenant } = useTenant();

  // Fetch vehicle daily rate + tenant weekend config in one query
  const { data: pricingData, isLoading: loadingPricing } = useQuery({
    queryKey: ['extension-pricing-base', tenant?.id, vehicleId],
    queryFn: async () => {
      const [vehicleRes, tenantRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('daily_rent')
          .eq('id', vehicleId!)
          .single(),
        (supabase as any)
          .from('tenants')
          .select('weekend_surcharge_percent, weekend_days')
          .eq('id', tenant!.id)
          .single(),
      ]);

      return {
        dailyRate: (vehicleRes.data?.daily_rent as number) ?? null,
        weekendConfig: tenantRes.data?.weekend_surcharge_percent > 0
          ? {
              weekend_surcharge_percent: tenantRes.data.weekend_surcharge_percent,
              weekend_days: tenantRes.data.weekend_days || [6, 0],
            } as WeekendConfig
          : null,
      };
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  // Fetch holidays + vehicle overrides
  const { data: dynamicData, isLoading: loadingDynamic } = useQuery({
    queryKey: ['extension-pricing-dynamic', tenant?.id, vehicleId],
    queryFn: async () => {
      const [holidaysRes, overridesRes] = await Promise.all([
        (supabase as any)
          .from('tenant_holidays')
          .select('*')
          .eq('tenant_id', tenant!.id),
        vehicleId
          ? (supabase as any)
              .from('vehicle_pricing_overrides')
              .select('*')
              .eq('vehicle_id', vehicleId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      return {
        holidays: (holidaysRes.data || []) as Holiday[],
        overrides: (overridesRes.data || []) as VehicleOverride[],
      };
    },
    enabled: !!tenant?.id && !!vehicleId,
    staleTime: 60_000,
  });

  const result = useMemo(() => {
    const dailyRate = pricingData?.dailyRate ?? null;
    if (!dailyRate || !currentEndDate || !newEndDate) {
      return { extensionCost: 0, extensionDays: 0, dailyRate, dayBreakdown: [], hasSurcharges: false };
    }

    const priceResult = calculateExtensionPrice(
      currentEndDate,
      newEndDate,
      dailyRate,
      pricingData?.weekendConfig,
      dynamicData?.holidays,
      dynamicData?.overrides,
      vehicleId
    );

    return {
      extensionCost: priceResult.totalCost,
      extensionDays: priceResult.days,
      dailyRate,
      dayBreakdown: priceResult.dayBreakdown,
      hasSurcharges: priceResult.hasSurcharges,
    };
  }, [pricingData, dynamicData, currentEndDate, newEndDate, vehicleId]);

  return {
    ...result,
    isLoading: loadingPricing || loadingDynamic,
  };
}
