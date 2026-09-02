import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  calculateExtensionPrice,
  type WeekendConfig,
  type Holiday,
  type VehicleOverride,
  type VehicleDailyPrice,
  type DayBreakdown,
} from '@/lib/calculate-extension-price';

interface UseExtensionPricingParams {
  vehicleId?: string;
  currentEndDate?: string; // YYYY-MM-DD — extension starts from this date
  newEndDate?: string;     // YYYY-MM-DD — extension ends at this date
  rentalPeriodType?: 'Daily' | 'Weekly' | 'Monthly' | string; // use same rate tier as original rental
  /**
   * The rental's promo code, when it has one. Supplying it makes a manual
   * extension honour the same discount the original booking was given — which
   * the auto-extend cron already does and the signed agreement already states.
   * Omitted => list price, exactly as before.
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
 * Derive an effective daily rate from the EXTENSION's own length — NOT the
 * original rental's period type. A 7-day extension should get the weekly rate
 * even if the original booking was a short daily rental (operators expect the
 * weekly/monthly discount to kick in by duration, like a fresh booking). The
 * tier the customer originally booked under is irrelevant to how long they're
 * now extending for.
 *
 * ≥ monthlyTierDays → monthly_rent / monthlyTierDays
 * ≥ 7 days          → weekly_rent / 7
 * otherwise         → daily_rent
 * Falls back to a smaller tier (and finally daily_rent) when a tier rate is missing.
 */
function getEffectiveDailyRateForDuration(
  extensionDays: number,
  dailyRent: number | null,
  weeklyRent: number | null,
  monthlyRent: number | null,
  monthlyTierDays: number = 30
): number | null {
  if (extensionDays >= monthlyTierDays && monthlyRent && monthlyRent > 0) {
    return Math.round((monthlyRent / monthlyTierDays) * 100) / 100;
  }
  if (extensionDays >= 7 && weeklyRent && weeklyRent > 0) {
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

  // Resolve the discount from the PROMO, not from rentals.discount_applied.
  //
  // discount_applied is a frozen currency amount, and deriving a ratio from it
  // ((gross - discount) / gross) silently assumes it was a percentage of
  // monthly_amount. That holds for 9 of the 11 discounted rentals in production
  // and is false for the other 2 — a fixed-amount promo, and a rental whose
  // monthly_amount was later overwritten with its own post-discount figure.
  // Reading the promo's declared type is immune to both.
  //
  // Only 'percentage' promos scale a per-day rate. A fixed-amount promo was a
  // one-off reduction on the original booking total and must NOT be re-applied
  // per extension day, so it deliberately leaves the factor at 1.
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
    // Refuse anything out of band rather than zeroing or inverting a charge.
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 1;
    return 1 - pct / 100;
  })();

  // Fetch vehicle rates (all tiers) + tenant weekend config in one query
  const { data: pricingData, isLoading: loadingPricing } = useQuery({
    queryKey: ['extension-pricing-base-v2', tenant?.id, vehicleId],
    queryFn: async () => {
      const [vehicleRes, tenantRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('daily_rent, weekly_rent, monthly_rent')
          .eq('id', vehicleId!)
          .single(),
        (supabase as any)
          .from('tenants')
          .select('weekend_surcharge_percent, weekend_days, stack_surcharges')
          .eq('id', tenant!.id)
          .single(),
      ]);

      return {
        dailyRent: (vehicleRes.data?.daily_rent as number) ?? null,
        weeklyRent: (vehicleRes.data?.weekly_rent as number) ?? null,
        monthlyRent: (vehicleRes.data?.monthly_rent as number) ?? null,
        weekendConfig: tenantRes.data?.weekend_surcharge_percent > 0
          ? {
              weekend_surcharge_percent: tenantRes.data.weekend_surcharge_percent,
              weekend_days: tenantRes.data.weekend_days || [6, 0],
              stack_surcharges: tenantRes.data.stack_surcharges ?? false,
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
      const [holidaysRes, overridesRes, dailyPricesRes] = await Promise.all([
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
        vehicleId
          ? (supabase as any)
              .from('vehicle_daily_prices')
              .select('date, price')
              .eq('vehicle_id', vehicleId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      return {
        holidays: (holidaysRes.data || []) as Holiday[],
        overrides: (overridesRes.data || []) as VehicleOverride[],
        dailyPrices: ((dailyPricesRes.data || []) as { date: string; price: number }[])
          .map(d => ({ date: d.date, price: Number(d.price) })) as VehicleDailyPrice[],
      };
    },
    enabled: !!tenant?.id && !!vehicleId,
    staleTime: 60_000,
  });

  const result = useMemo(() => {
    const mtd = tenant?.monthly_tier_days ?? 30;
    // Length of THIS extension (inclusive day-count is handled in
    // calculateExtensionPrice; here we just need a tier selector).
    const extensionDays = currentEndDate && newEndDate
      ? Math.max(0, Math.round(
          (new Date(`${newEndDate}T00:00:00`).getTime() - new Date(`${currentEndDate}T00:00:00`).getTime()) / 86_400_000
        ))
      : 0;
    const effectiveDailyRate = getEffectiveDailyRateForDuration(
      extensionDays,
      pricingData?.dailyRent ?? null,
      pricingData?.weeklyRent ?? null,
      pricingData?.monthlyRent ?? null,
      mtd
    );
    if (!effectiveDailyRate || !currentEndDate || !newEndDate) {
      return { extensionCost: 0, extensionDays: 0, dailyRate: effectiveDailyRate, dayBreakdown: [], hasSurcharges: false };
    }

    // Scale the tier rate, don't subtract a lump sum — a per-day rate must stay a
    // per-day rate so weekend/holiday surcharges and per-vehicle overrides still
    // compose correctly downstream. contractFactor is exactly 1 when there is no
    // percentage promo, making this a literal no-op for every other rental.
    const contractedDailyRate = contractFactor === 1
      ? effectiveDailyRate
      : Math.round(effectiveDailyRate * contractFactor * 100) / 100;

    const priceResult = calculateExtensionPrice(
      currentEndDate,
      newEndDate,
      contractedDailyRate,
      pricingData?.weekendConfig,
      dynamicData?.holidays,
      dynamicData?.overrides,
      vehicleId,
      dynamicData?.dailyPrices, // Turo-style per-day manual prices apply to extensions too
    );

    return {
      extensionCost: priceResult.totalCost,
      extensionDays: priceResult.days,
      dailyRate: contractedDailyRate,
      dayBreakdown: priceResult.dayBreakdown,
      hasSurcharges: priceResult.hasSurcharges,
    };
  }, [pricingData, dynamicData, currentEndDate, newEndDate, vehicleId, rentalPeriodType, contractFactor]);

  return {
    ...result,
    isLoading: loadingPricing || loadingDynamic,
  };
}
