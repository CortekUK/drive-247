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
  /**
   * The rental's promo code, when it has one. Makes a manual extension honour the
   * same discount the original booking was given, matching the auto-extend cron
   * and the signed agreement. Omitted => list price, exactly as before.
   */
  promoCode?: string | null;
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
  promoCode,
}: UseExtensionPricingParams): ExtensionPricingResult {
  const { tenant } = useTenant();

  // Resolve the discount from the PROMO's declared type, not from
  // rentals.discount_applied. That column is a frozen currency amount, and
  // deriving a ratio from it assumes it was a percentage of monthly_amount —
  // true for 9 of 11 discounted rentals in production, false for 2.
  // Only 'percentage' promos scale a per-day rate; a fixed-amount promo was a
  // one-off reduction on the original booking and must not repeat per day.
  const { data: promo } = useQuery({
    queryKey: ['extension-pricing-promo', tenant?.id, promoCode],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('promocodes')
        .select('type, value')
        .eq('tenant_id', tenant!.id)
        .eq('code', promoCode!)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!tenant?.id && !!promoCode,
    staleTime: 60_000,
  });

  const contractFactor = (() => {
    if (!promo || promo.type !== 'percentage') return 1;
    const pct = Number(promo.value);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 1;
    return 1 - pct / 100;
  })();
  const { holidays, vehicleOverrides, dailyPrices, isLoading: loadingDynamic } = useDynamicPricing(vehicleId);

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
      stack_surcharges: (tenant as any).stack_surcharges ?? false,
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

    // Scale the tier rate rather than subtracting a lump sum, so surcharges and
    // per-vehicle overrides still compose. Exactly 1 without a percentage promo,
    // making this a literal no-op for every other rental.
    const contractedRate = contractFactor === 1
      ? effectiveRate
      : Math.round(effectiveRate * contractFactor * 100) / 100;

    // Use calculateRentalPriceBreakdown with the contracted rate as the daily rate
    const priceResult = calculateRentalPriceBreakdown(
      currentEndDate,
      newEndDate,
      { daily_rent: contractedRate, weekly_rent: 0, monthly_rent: 0 },
      weekendConfig,
      holidays,
      vehicleOverrides,
      vehicleId,
      mtd,
      false, // skipSurcharges
      false, // stackSurcharges resolved from weekendConfig
      dailyPrices, // Turo-style per-day manual prices apply to extensions too
    );

    return {
      extensionCost: priceResult.rentalPrice,
      extensionDays: priceResult.rentalDays,
      dailyRate: contractedRate,
      dayBreakdown: priceResult.dayBreakdown,
      hasSurcharges: priceResult.dayBreakdown.some(d => d.type !== 'regular'),
    };
  }, [vehicleData, currentEndDate, newEndDate, weekendConfig, holidays, vehicleOverrides, dailyPrices, vehicleId, rentalPeriodType, contractFactor]);

  return {
    ...result,
    isLoading: loadingRate || loadingDynamic,
  };
}
