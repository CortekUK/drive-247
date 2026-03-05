import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useDynamicPricing } from '@/hooks/use-dynamic-pricing';
import {
  calculateRentalPriceBreakdown,
  type DayBreakdown,
} from '@/lib/calculate-rental-price';

interface UseExtensionPricingParams {
  vehicleId?: string;
  currentEndDate?: string; // YYYY-MM-DD
  newEndDate?: string;     // YYYY-MM-DD
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
  const { holidays, vehicleOverrides, isLoading: loadingDynamic } = useDynamicPricing(vehicleId);

  // Fetch vehicle daily rate
  const { data: vehicleData, isLoading: loadingRate } = useQuery({
    queryKey: ['extension-vehicle-rate', vehicleId],
    queryFn: async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('daily_rent')
        .eq('id', vehicleId!)
        .single();
      return data?.daily_rent ?? null;
    },
    enabled: !!vehicleId,
  });

  const weekendConfig = useMemo(() => {
    if (!tenant?.weekend_surcharge_percent || tenant.weekend_surcharge_percent <= 0) return null;
    return {
      weekend_surcharge_percent: tenant.weekend_surcharge_percent,
      weekend_days: (tenant as any).weekend_days || [6, 0],
    };
  }, [tenant]);

  const result = useMemo(() => {
    const dailyRate = vehicleData ?? null;
    if (!dailyRate || !currentEndDate || !newEndDate) {
      return { extensionCost: 0, extensionDays: 0, dailyRate, dayBreakdown: [] as DayBreakdown[], hasSurcharges: false };
    }

    // Use calculateRentalPriceBreakdown with daily-only rates to force daily tier
    const priceResult = calculateRentalPriceBreakdown(
      currentEndDate,
      newEndDate,
      { daily_rent: dailyRate, weekly_rent: 0, monthly_rent: 0 },
      weekendConfig,
      holidays,
      vehicleOverrides,
      vehicleId
    );

    return {
      extensionCost: priceResult.rentalPrice,
      extensionDays: priceResult.rentalDays,
      dailyRate,
      dayBreakdown: priceResult.dayBreakdown,
      hasSurcharges: priceResult.dayBreakdown.some(d => d.type !== 'regular'),
    };
  }, [vehicleData, currentEndDate, newEndDate, weekendConfig, holidays, vehicleOverrides, vehicleId]);

  return {
    ...result,
    isLoading: loadingRate || loadingDynamic,
  };
}
