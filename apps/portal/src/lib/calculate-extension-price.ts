/**
 * Extension Pricing Calculation
 *
 * Calculates extension cost with weekend/holiday surcharges.
 * Extensions always use daily-tier pricing (day-by-day iteration).
 *
 * Logic mirrors apps/booking/src/lib/calculate-rental-price.ts
 */

export interface WeekendConfig {
  weekend_surcharge_percent: number;
  weekend_days: number[]; // JS day numbers: 0=Sun, 1=Mon, ..., 6=Sat
}

export interface Holiday {
  id: string;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
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

export interface ExtensionPriceResult {
  totalCost: number;
  days: number;
  dayBreakdown: DayBreakdown[];
  hasSurcharges: boolean;
}

function parseDateString(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function findMatchingHoliday(
  date: Date,
  holidays: Holiday[],
  vehicleId?: string
): Holiday | null {
  const dateStr = formatDate(date);
  const month = date.getMonth() + 1;
  const day = date.getDate();

  for (const holiday of holidays) {
    if (vehicleId && holiday.excluded_vehicle_ids?.includes(vehicleId)) {
      continue;
    }

    if (holiday.recurs_annually) {
      const start = parseDateString(holiday.start_date);
      const end = parseDateString(holiday.end_date);
      const startMonth = start.getMonth() + 1;
      const startDay = start.getDate();
      const endMonth = end.getMonth() + 1;
      const endDay = end.getDate();

      if (startMonth === endMonth) {
        if (month === startMonth && day >= startDay && day <= endDay) {
          return holiday;
        }
      } else {
        if (
          (month === startMonth && day >= startDay) ||
          (month === endMonth && day <= endDay) ||
          (month > startMonth && month < endMonth)
        ) {
          return holiday;
        }
      }
    } else {
      if (dateStr >= holiday.start_date && dateStr <= holiday.end_date) {
        return holiday;
      }
    }
  }

  return null;
}

function getDayRate(
  date: Date,
  baseRate: number,
  weekendConfig: WeekendConfig | null,
  holidays: Holiday[],
  overrides: VehicleOverride[],
  vehicleId?: string
): DayBreakdown {
  const dayOfWeek = date.getDay();
  const dateStr = formatDate(date);

  // 1. Check for holiday match
  const holiday = findMatchingHoliday(date, holidays, vehicleId);
  if (holiday) {
    const override = overrides.find(
      o => o.rule_type === 'holiday' && o.holiday_id === holiday.id
    );

    if (override) {
      if (override.override_type === 'excluded') {
        return { date: dateStr, dayOfWeek, type: 'regular', baseRate, surchargePercent: 0, effectiveRate: baseRate };
      }
      if (override.override_type === 'fixed_price' && override.fixed_price != null) {
        return { date: dateStr, dayOfWeek, type: 'holiday', holidayName: holiday.name, baseRate, surchargePercent: 0, effectiveRate: override.fixed_price };
      }
      if (override.override_type === 'custom_percent' && override.custom_percent != null) {
        const effectiveRate = baseRate * (1 + override.custom_percent / 100);
        return { date: dateStr, dayOfWeek, type: 'holiday', holidayName: holiday.name, baseRate, surchargePercent: override.custom_percent, effectiveRate: Math.round(effectiveRate * 100) / 100 };
      }
    }

    const effectiveRate = baseRate * (1 + holiday.surcharge_percent / 100);
    return { date: dateStr, dayOfWeek, type: 'holiday', holidayName: holiday.name, baseRate, surchargePercent: holiday.surcharge_percent, effectiveRate: Math.round(effectiveRate * 100) / 100 };
  }

  // 2. Check for weekend match
  const isWeekend = weekendConfig &&
    weekendConfig.weekend_surcharge_percent > 0 &&
    weekendConfig.weekend_days?.includes(dayOfWeek);

  if (isWeekend && weekendConfig) {
    const override = overrides.find(o => o.rule_type === 'weekend');

    if (override) {
      if (override.override_type === 'excluded') {
        return { date: dateStr, dayOfWeek, type: 'regular', baseRate, surchargePercent: 0, effectiveRate: baseRate };
      }
      if (override.override_type === 'fixed_price' && override.fixed_price != null) {
        return { date: dateStr, dayOfWeek, type: 'weekend', baseRate, surchargePercent: 0, effectiveRate: override.fixed_price };
      }
      if (override.override_type === 'custom_percent' && override.custom_percent != null) {
        const effectiveRate = baseRate * (1 + override.custom_percent / 100);
        return { date: dateStr, dayOfWeek, type: 'weekend', baseRate, surchargePercent: override.custom_percent, effectiveRate: Math.round(effectiveRate * 100) / 100 };
      }
    }

    const effectiveRate = baseRate * (1 + weekendConfig.weekend_surcharge_percent / 100);
    return { date: dateStr, dayOfWeek, type: 'weekend', baseRate, surchargePercent: weekendConfig.weekend_surcharge_percent, effectiveRate: Math.round(effectiveRate * 100) / 100 };
  }

  // 3. Regular day
  return { date: dateStr, dayOfWeek, type: 'regular', baseRate, surchargePercent: 0, effectiveRate: baseRate };
}

/**
 * Calculate extension price with dynamic pricing.
 * Always uses daily-tier iteration regardless of extension length.
 */
export function calculateExtensionPrice(
  startDate: string, // current end date (extension starts day after)
  endDate: string,   // new end date
  dailyRate: number,
  weekendConfig?: WeekendConfig | null,
  holidays?: Holiday[],
  overrides?: VehicleOverride[],
  vehicleId?: string
): ExtensionPriceResult {
  const start = parseDateString(startDate);
  const end = parseDateString(endDate);
  const days = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

  if (days <= 0 || dailyRate <= 0) {
    return { totalCost: 0, days, dayBreakdown: [], hasSurcharges: false };
  }

  const safeHolidays = holidays || [];
  const safeOverrides = overrides || [];
  const breakdown: DayBreakdown[] = [];
  let totalCost = 0;

  for (let i = 0; i < days; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(currentDate.getDate() + i);

    const dayInfo = getDayRate(
      currentDate,
      dailyRate,
      weekendConfig || null,
      safeHolidays,
      safeOverrides,
      vehicleId
    );

    breakdown.push(dayInfo);
    totalCost += dayInfo.effectiveRate;
  }

  const hasSurcharges = breakdown.some(d => d.type !== 'regular');

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    days,
    dayBreakdown: breakdown,
    hasSurcharges,
  };
}
