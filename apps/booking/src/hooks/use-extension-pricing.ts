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
  rentalPeriodType?: string; // 'Daily' | 'Weekly' | 'Monthly' — use same rate tier as original rental
}

interface ExtensionPricingResult {
  extensionCost: number;
  extensionDays: number;
  dailyRate: number | null;
  dayBreakdown: DayBreakdown[];
  hasSurcharges: boolean;
  isLoading: boolean;
}

/**
 * Derive an effective daily rate from the rental's period type.
 * Monthly → monthly_rent / monthlyTierDays, Weekly → weekly_rent / 7, Daily → daily_rent.
 * Falls back to daily_rent if the tier rate is missing.
 */
function getEffectiveDailyRate(
  rentalPeriodType: string | undefined,
  dailyRent: number | null,
  weeklyRent: number | null,
  monthlyRent: number | null,
  monthlyTierDays: number = 30
): number | null {
  const type = (rentalPeriodType || '').toLowerCase();
  if (type === 'monthly' && monthlyRent && monthlyRent > 0) {
    return Math.round((monthlyRent / monthlyTierDays) * 100) / 100;
  }
  if (type === 'weekly' && weeklyRent && weeklyRent > 0) {
    return Math.round((weeklyRent / 7) * 100) / 100;
  }
  return dailyRent;
}

export function useExtensionPricing({
  vehicleId,
  currentEndDate,
  newEndDate,
  rentalPeriodType,
}: UseExtensionPricingParams): ExtensionPricingResult {
  const { tenant } = useTenant();
  const { holidays, vehicleOverrides, isLoading: loadingDynamic } = useDynamicPricing(vehicleId);

  // Fetch vehicle rates (all tiers)
  const { data: vehicleData, isLoading: loadingRate } = useQuery({
    queryKey: ['extension-vehicle-rate-v2', vehicleId],
    queryFn: async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('daily_rent, weekly_rent, monthly_rent')
        .eq('id', vehicleId!)
        .single();
      return data;
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
    const mtd = tenant?.monthly_tier_days ?? 30;
    const effectiveRate = vehicleData
      ? getEffectiveDailyRate(rentalPeriodType, vehicleData.daily_rent, vehicleData.weekly_rent, vehicleData.monthly_rent, mtd)
      : null;

    if (!effectiveRate || !currentEndDate || !newEndDate) {
      return { extensionCost: 0, extensionDays: 0, dailyRate: effectiveRate, dayBreakdown: [] as DayBreakdown[], hasSurcharges: false };
    }

    // Use calculateRentalPriceBreakdown with the effective rate as the daily rate
    const priceResult = calculateRentalPriceBreakdown(
      currentEndDate,
      newEndDate,
      { daily_rent: effectiveRate, weekly_rent: 0, monthly_rent: 0 },
      weekendConfig,
      holidays,
      vehicleOverrides,
      vehicleId
    );

    return {
      extensionCost: priceResult.rentalPrice,
      extensionDays: priceResult.rentalDays,
      dailyRate: effectiveRate,
      dayBreakdown: priceResult.dayBreakdown,
      hasSurcharges: priceResult.dayBreakdown.some(d => d.type !== 'regular'),
    };
  }, [vehicleData, currentEndDate, newEndDate, weekendConfig, holidays, vehicleOverrides, vehicleId, rentalPeriodType]);

  return {
    ...result,
    isLoading: loadingRate || loadingDynamic,
  };
}
