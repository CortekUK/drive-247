/**
 * Dynamic Pricing Calculation Utility
 *
 * Centralizes rental pricing logic with support for weekend/holiday surcharges.
 * Dynamic pricing only applies to the daily tier (< 7 days).
 * Weekly and monthly tiers remain unchanged.
 */

export interface VehicleRates {
  daily_rent: number;
  weekly_rent: number;
  monthly_rent: number;
}

export interface TenantWeekendConfig {
  weekend_surcharge_percent: number;
  weekend_days: number[]; // JS day numbers: 0=Sun, 1=Mon, ..., 6=Sat
}

export interface Holiday {
  id: string;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  surcharge_percent: number;
  excluded_vehicle_ids: string[];
  recurs_annually: boolean;
}

export interface VehicleOverride {
  id: string;
  vehicle_id: string;
  rule_type: 'weekend' | 'holiday';
  holiday_id: string | null;
  override_type: 'fixed_price' | 'custom_percent' | 'excluded';
  fixed_price: number | null;
  custom_percent: number | null;
}

export interface DayBreakdown {
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  type: 'regular' | 'weekend' | 'holiday';
  holidayName?: string;
  baseRate: number;
  surchargePercent: number;
  effectiveRate: number;
}

export type PricingTier = 'daily' | 'weekly' | 'monthly';

export interface RentalPriceResult {
  rentalPrice: number;
  rentalDays: number;
  pricingTier: PricingTier;
  dayBreakdown: DayBreakdown[];
}

/**
 * Safari-safe date parser for YYYY-MM-DD strings.
 * Safari doesn't support new Date("YYYY-MM-DD") format reliably.
 */
export function parseDateString(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a Date as YYYY-MM-DD string
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check if a given date falls within a holiday period.
 * For recurring holidays, compares month/day only.
 */
function findMatchingHoliday(
  date: Date,
  holidays: Holiday[],
  vehicleId?: string
): Holiday | null {
  const dateStr = formatDate(date);
  const month = date.getMonth() + 1;
  const day = date.getDate();

  for (const holiday of holidays) {
    // Check if vehicle is excluded from this holiday
    if (vehicleId && holiday.excluded_vehicle_ids?.includes(vehicleId)) {
      continue;
    }

    if (holiday.recurs_annually) {
      // Compare month/day only for recurring holidays
      const start = parseDateString(holiday.start_date);
      const end = parseDateString(holiday.end_date);
      const startMonth = start.getMonth() + 1;
      const startDay = start.getDate();
      const endMonth = end.getMonth() + 1;
      const endDay = end.getDate();

      // Simple case: same month range or single day
      if (startMonth === endMonth) {
        if (month === startMonth && day >= startDay && day <= endDay) {
          return holiday;
        }
      } else {
        // Spans multiple months
        if (
          (month === startMonth && day >= startDay) ||
          (month === endMonth && day <= endDay) ||
          (month > startMonth && month < endMonth)
        ) {
          return holiday;
        }
      }
    } else {
      // Exact date range comparison
      if (dateStr >= holiday.start_date && dateStr <= holiday.end_date) {
        return holiday;
      }
    }
  }

  return null;
}

/**
 * Get the effective rate for a single day in the daily tier.
 *
 * Priority:
 * 1. Holiday match (vehicle not excluded) → holiday surcharge or vehicle override
 * 2. Weekend match → weekend surcharge or vehicle override
 * 3. Regular → base daily rate
 */
function getDayRate(
  date: Date,
  baseRate: number,
  weekendConfig: TenantWeekendConfig | null,
  holidays: Holiday[],
  overrides: VehicleOverride[],
  vehicleId?: string
): DayBreakdown {
  const dayOfWeek = date.getDay();
  const dateStr = formatDate(date);

  // 1. Check for holiday match
  const holiday = findMatchingHoliday(date, holidays, vehicleId);
  if (holiday) {
    // Check for vehicle-specific holiday override
    const override = overrides.find(
      o => o.rule_type === 'holiday' && o.holiday_id === holiday.id
    );

    if (override) {
      if (override.override_type === 'excluded') {
        // Vehicle excluded from this holiday via override — use base rate
        return {
          date: dateStr,
          dayOfWeek,
          type: 'regular',
          baseRate,
          surchargePercent: 0,
          effectiveRate: baseRate,
        };
      }
      if (override.override_type === 'fixed_price' && override.fixed_price != null) {
        return {
          date: dateStr,
          dayOfWeek,
          type: 'holiday',
          holidayName: holiday.name,
          baseRate,
          surchargePercent: 0,
          effectiveRate: override.fixed_price,
        };
      }
      if (override.override_type === 'custom_percent' && override.custom_percent != null) {
        const effectiveRate = baseRate * (1 + override.custom_percent / 100);
        return {
          date: dateStr,
          dayOfWeek,
          type: 'holiday',
          holidayName: holiday.name,
          baseRate,
          surchargePercent: override.custom_percent,
          effectiveRate: Math.round(effectiveRate * 100) / 100,
        };
      }
    }

    // Use global holiday surcharge
    const effectiveRate = baseRate * (1 + holiday.surcharge_percent / 100);
    return {
      date: dateStr,
      dayOfWeek,
      type: 'holiday',
      holidayName: holiday.name,
      baseRate,
      surchargePercent: holiday.surcharge_percent,
      effectiveRate: Math.round(effectiveRate * 100) / 100,
    };
  }

  // 2. Check for weekend match
  const isWeekend = weekendConfig &&
    weekendConfig.weekend_surcharge_percent > 0 &&
    weekendConfig.weekend_days?.includes(dayOfWeek);

  if (isWeekend && weekendConfig) {
    // Check for vehicle-specific weekend override
    const override = overrides.find(o => o.rule_type === 'weekend');

    if (override) {
      if (override.override_type === 'excluded') {
        return {
          date: dateStr,
          dayOfWeek,
          type: 'regular',
          baseRate,
          surchargePercent: 0,
          effectiveRate: baseRate,
        };
      }
      if (override.override_type === 'fixed_price' && override.fixed_price != null) {
        return {
          date: dateStr,
          dayOfWeek,
          type: 'weekend',
          baseRate,
          surchargePercent: 0,
          effectiveRate: override.fixed_price,
        };
      }
      if (override.override_type === 'custom_percent' && override.custom_percent != null) {
        const effectiveRate = baseRate * (1 + override.custom_percent / 100);
        return {
          date: dateStr,
          dayOfWeek,
          type: 'weekend',
          baseRate,
          surchargePercent: override.custom_percent,
          effectiveRate: Math.round(effectiveRate * 100) / 100,
        };
      }
    }

    // Use global weekend surcharge
    const effectiveRate = baseRate * (1 + weekendConfig.weekend_surcharge_percent / 100);
    return {
      date: dateStr,
      dayOfWeek,
      type: 'weekend',
      baseRate,
      surchargePercent: weekendConfig.weekend_surcharge_percent,
      effectiveRate: Math.round(effectiveRate * 100) / 100,
    };
  }

  // 3. Regular day
  return {
    date: dateStr,
    dayOfWeek,
    type: 'regular',
    baseRate,
    surchargePercent: 0,
    effectiveRate: baseRate,
  };
}

/**
 * Calculate the full rental price with dynamic pricing support.
 *
 * Dynamic pricing only applies to the daily tier (< 7 days).
 * Weekly (7-30 days) and monthly (> 30 days) use standard pro-rata rates.
 */
export function calculateRentalPriceBreakdown(
  pickupDate: string,
  dropoffDate: string,
  rates: VehicleRates,
  weekendConfig?: TenantWeekendConfig | null,
  holidays?: Holiday[],
  overrides?: VehicleOverride[],
  vehicleId?: string
): RentalPriceResult {
  const pickup = parseDateString(pickupDate);
  const dropoff = parseDateString(dropoffDate);
  const rentalDays = Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)));

  const dailyRent = rates.daily_rent || 0;
  const weeklyRent = rates.weekly_rent || 0;
  const monthlyRent = rates.monthly_rent || 0;

  // Monthly tier (> 30 days) — no dynamic pricing
  if (rentalDays > 30 && monthlyRent > 0) {
    return {
      rentalPrice: (rentalDays / 30) * monthlyRent,
      rentalDays,
      pricingTier: 'monthly',
      dayBreakdown: [],
    };
  }

  // Weekly tier (7-30 days) — no dynamic pricing
  if (rentalDays >= 7 && rentalDays <= 30 && weeklyRent > 0) {
    return {
      rentalPrice: (rentalDays / 7) * weeklyRent,
      rentalDays,
      pricingTier: 'weekly',
      dayBreakdown: [],
    };
  }

  // Daily tier (< 7 days) — apply dynamic pricing
  if (dailyRent > 0) {
    const safeHolidays = holidays || [];
    const safeOverrides = overrides || [];
    const breakdown: DayBreakdown[] = [];
    let totalPrice = 0;

    for (let i = 0; i < rentalDays; i++) {
      const currentDate = new Date(pickup);
      currentDate.setDate(currentDate.getDate() + i);

      const dayInfo = getDayRate(
        currentDate,
        dailyRent,
        weekendConfig || null,
        safeHolidays,
        safeOverrides,
        vehicleId
      );

      breakdown.push(dayInfo);
      totalPrice += dayInfo.effectiveRate;
    }

    return {
      rentalPrice: Math.round(totalPrice * 100) / 100,
      rentalDays,
      pricingTier: 'daily',
      dayBreakdown: breakdown,
    };
  }

  // Fallbacks when daily rate is missing
  if (weeklyRent > 0) {
    return {
      rentalPrice: (rentalDays / 7) * weeklyRent,
      rentalDays,
      pricingTier: 'weekly',
      dayBreakdown: [],
    };
  }
  if (monthlyRent > 0) {
    return {
      rentalPrice: (rentalDays / 30) * monthlyRent,
      rentalDays,
      pricingTier: 'monthly',
      dayBreakdown: [],
    };
  }

  return {
    rentalPrice: 0,
    rentalDays,
    pricingTier: 'daily',
    dayBreakdown: [],
  };
}
