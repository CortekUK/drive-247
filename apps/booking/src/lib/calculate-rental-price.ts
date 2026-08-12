/**
 * ⚠️  DUPLICATED FILE — KEEP IN SYNC ⚠️
 * This exact file exists twice: apps/booking/src/lib/calculate-rental-price.ts
 * and apps/portal/src/lib/calculate-rental-price.ts.
 * Any change to one MUST be mirrored to the other or the customer
 * (booking) and staff (portal) prices will silently disagree. The two files
 * must remain byte-identical: `diff apps/booking/src/lib/calculate-rental-price.ts
 * apps/portal/src/lib/calculate-rental-price.ts` should print nothing.
 * TODO: extract into a shared workspace package (packages/pricing) to remove
 * this duplication for good.
 *
 * Dynamic Pricing Calculation Utility
 *
 * Centralizes rental pricing logic with support for weekend/holiday surcharges.
 * Weekend/holiday surcharges apply across ALL tiers (daily, weekly, monthly).
 * Each tier computes a per-day equivalent rate (daily = daily_rent,
 * weekly = weekly_rent / 7, monthly = monthly_rent / monthlyTierDays), then
 * surcharges are applied per-day only on the days that fall in a weekend/holiday.
 * Non-surcharge days keep the tier's discounted per-day rate, so weekly/monthly
 * discounts are preserved — only the special days cost extra.
 */

export interface VehicleRates {
  daily_rent: number;
  weekly_rent: number;
  monthly_rent: number;
}

export interface TenantWeekendConfig {
  weekend_surcharge_percent: number;
  weekend_days: number[]; // JS day numbers: 0=Sun, 1=Mon, ..., 6=Sat
  // When true, all applicable surcharges stack additively (see calculateRentalPriceBreakdown).
  stack_surcharges?: boolean;
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

// Turo-style per-day manual price: an operator-set price for a specific vehicle
// on a specific calendar day. When present it overrides every surcharge/tier rate.
export interface VehicleDailyPrice {
  date: string; // YYYY-MM-DD
  price: number;
}

export interface DayBreakdown {
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  type: 'regular' | 'weekend' | 'holiday' | 'manual';
  holidayName?: string;
  baseRate: number;
  surchargePercent: number;
  effectiveRate: number;
  // When surcharge stacking is enabled, the individual surcharges applied to this
  // day (weekend + each matching holiday). Empty/undefined in the default
  // (non-stacking) path. surchargePercent is their sum in stacking mode.
  appliedSurcharges?: { label: string; percent: number }[];
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
  vehicleId?: string,
  stackSurcharges: boolean = false,
  dailyPriceMap?: Record<string, number>
): DayBreakdown {
  const dayOfWeek = date.getDay();
  const dateStr = formatDate(date);

  // ── MANUAL PER-DAY PRICE (Turo mode) ──────────────────────────────────────
  // An operator-set price for this exact calendar day wins absolutely over every
  // surcharge/tier rate. Skipped entirely when no manual price is set for the day,
  // so all pricing paths below are byte-for-byte unchanged for existing rentals.
  if (dailyPriceMap) {
    const manual = dailyPriceMap[dateStr];
    if (manual != null) {
      return {
        date: dateStr,
        dayOfWeek,
        type: 'manual',
        baseRate,
        surchargePercent: 0,
        effectiveRate: manual,
        appliedSurcharges: [],
      };
    }
  }

  // ── STACKING MODE ─────────────────────────────────────────────────────────
  // When enabled, EVERY applicable surcharge applies additively (not by priority):
  //   effectiveRate = base * (1 + sum(weekend% + each holiday%)/100).
  // A fixed_price override is absolute and cannot stack (holiday wins over weekend).
  // 'excluded' overrides drop that rule. This whole branch is skipped when the
  // toggle is off, so the default pricing path below is byte-for-byte unchanged.
  if (stackSurcharges) {
    const applied: { label: string; percent: number }[] = [];
    let type: DayBreakdown['type'] = 'regular';
    let holidayName: string | undefined;

    const stackHoliday = findMatchingHoliday(date, holidays, vehicleId);
    const stackHolidayOv = stackHoliday
      ? overrides.find(o => o.rule_type === 'holiday' && o.holiday_id === stackHoliday.id)
      : undefined;
    const stackWeekendMatch = !!(
      weekendConfig &&
      weekendConfig.weekend_surcharge_percent > 0 &&
      weekendConfig.weekend_days?.includes(dayOfWeek)
    );
    const stackWeekendOv = stackWeekendMatch
      ? overrides.find(o => o.rule_type === 'weekend')
      : undefined;

    // Fixed-price overrides are absolute → they win the day, no stacking (holiday first).
    if (stackHoliday && stackHolidayOv?.override_type === 'fixed_price' && stackHolidayOv.fixed_price != null) {
      return { date: dateStr, dayOfWeek, type: 'holiday', holidayName: stackHoliday.name, baseRate, surchargePercent: 0, effectiveRate: stackHolidayOv.fixed_price, appliedSurcharges: [] };
    }
    if (stackWeekendMatch && stackWeekendOv?.override_type === 'fixed_price' && stackWeekendOv.fixed_price != null) {
      return { date: dateStr, dayOfWeek, type: 'weekend', baseRate, surchargePercent: 0, effectiveRate: stackWeekendOv.fixed_price, appliedSurcharges: [] };
    }

    // Holiday percentage (skip if excluded).
    if (stackHoliday && stackHolidayOv?.override_type !== 'excluded') {
      const pct = (stackHolidayOv?.override_type === 'custom_percent' && stackHolidayOv.custom_percent != null)
        ? stackHolidayOv.custom_percent
        : stackHoliday.surcharge_percent;
      type = 'holiday';
      holidayName = stackHoliday.name;
      if (pct) applied.push({ label: stackHoliday.name, percent: pct });
    }

    // Weekend percentage (skip if excluded/fixed).
    if (stackWeekendMatch && weekendConfig && stackWeekendOv?.override_type !== 'excluded' && stackWeekendOv?.override_type !== 'fixed_price') {
      const pct = (stackWeekendOv?.override_type === 'custom_percent' && stackWeekendOv.custom_percent != null)
        ? stackWeekendOv.custom_percent
        : weekendConfig.weekend_surcharge_percent;
      if (type === 'regular') type = 'weekend';
      if (pct) applied.push({ label: 'Weekend', percent: pct });
    }

    const totalPct = applied.reduce((s, a) => s + a.percent, 0);
    return {
      date: dateStr,
      dayOfWeek,
      type,
      holidayName,
      baseRate,
      surchargePercent: totalPct,
      effectiveRate: Math.round(baseRate * (1 + totalPct / 100) * 100) / 100,
      appliedSurcharges: applied,
    };
  }
  // ── DEFAULT (highest/priority wins) — unchanged ───────────────────────────

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
 * Weekend/holiday surcharges apply across ALL tiers. Each tier runs the same
 * per-day loop using its per-day equivalent rate:
 *   - daily   (< 7 days)              → daily_rent
 *   - weekly  (7 to monthlyTierDays-1)→ weekly_rent / 7
 *   - monthly (>= monthlyTierDays)    → monthly_rent / monthlyTierDays
 * Non-surcharge days keep the tier rate, so weekly/monthly discounts are
 * preserved; only weekend/holiday days carry the surcharge.
 */
export function calculateRentalPriceBreakdown(
  pickupDate: string,
  dropoffDate: string,
  rates: VehicleRates,
  weekendConfig?: TenantWeekendConfig | null,
  holidays?: Holiday[],
  overrides?: VehicleOverride[],
  vehicleId?: string,
  monthlyTierDays: number = 30,
  // When true, all weekend/holiday surcharges are ignored and every day uses the
  // flat tier base rate. Used for auto-extend ("set price") rentals, where the
  // operator advertises a fixed rate and the seasonal markups should apply to
  // short-term rentals only.
  skipSurcharges: boolean = false,
  // When true, all applicable weekend/holiday surcharges stack additively on a day
  // instead of only the highest/priority one applying. Off by default.
  stackSurcharges: boolean = false,
  // Turo-style per-day manual prices for this vehicle. A price set for a given
  // calendar day overrides the tier rate AND all surcharges for that day.
  dailyPrices?: VehicleDailyPrice[]
): RentalPriceResult {
  const pickup = parseDateString(pickupDate);
  const dropoff = parseDateString(dropoffDate);
  const rentalDays = Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)));

  const dailyRent = rates.daily_rent || 0;
  const weeklyRent = rates.weekly_rent || 0;
  const monthlyRent = rates.monthly_rent || 0;

  // Blanking the surcharge inputs makes every day resolve to the plain tier rate.
  const effectiveWeekendConfig = skipSurcharges ? null : (weekendConfig || null);
  const safeHolidays = skipSurcharges ? [] : (holidays || []);
  const safeOverrides = skipSurcharges ? [] : (overrides || []);

  // Stacking can be turned on either explicitly (param) or via the tenant's
  // weekend config (stack_surcharges) so callers that already pass weekendConfig
  // don't each need a new argument.
  const stack = stackSurcharges || Boolean(weekendConfig?.stack_surcharges);

  // Build a date→manual-price lookup. Manual prices are the operator's explicit
  // per-day intent, so — like surcharges — they are skipped on auto-extend
  // ("set price") rentals where a flat advertised rate applies. Passing undefined
  // when empty keeps getDayRate's manual branch a strict no-op.
  const safeDailyPrices = skipSurcharges ? [] : (dailyPrices || []);
  const dailyPriceMap: Record<string, number> = {};
  // Coerce with Number(): Postgres numeric columns arrive as JSON strings over
  // PostgREST, and string prices would corrupt the total via `+` concatenation.
  for (const dp of safeDailyPrices) dailyPriceMap[dp.date] = Number(dp.price);
  const dailyPriceLookup = safeDailyPrices.length > 0 ? dailyPriceMap : undefined;

  // Run the per-day surcharge loop for any tier given its per-day base rate.
  // Non-surcharge days cost `perDayRate`; weekend/holiday days carry the surcharge.
  const runDayLoop = (perDayRate: number): { rentalPrice: number; dayBreakdown: DayBreakdown[] } => {
    const breakdown: DayBreakdown[] = [];
    let totalPrice = 0;
    for (let i = 0; i < rentalDays; i++) {
      const currentDate = new Date(pickup);
      currentDate.setDate(currentDate.getDate() + i);

      const dayInfo = getDayRate(
        currentDate,
        perDayRate,
        effectiveWeekendConfig,
        safeHolidays,
        safeOverrides,
        vehicleId,
        stack,
        dailyPriceLookup
      );

      breakdown.push(dayInfo);
      totalPrice += dayInfo.effectiveRate;
    }
    return { rentalPrice: Math.round(totalPrice * 100) / 100, dayBreakdown: breakdown };
  };

  // Monthly tier (>= monthlyTierDays) — surcharges on the per-day equivalent
  if (rentalDays >= monthlyTierDays && monthlyRent > 0) {
    return { ...runDayLoop(monthlyRent / monthlyTierDays), rentalDays, pricingTier: 'monthly' };
  }

  // Weekly tier (7 to monthlyTierDays-1 days) — surcharges on the per-day equivalent
  if (rentalDays >= 7 && rentalDays < monthlyTierDays && weeklyRent > 0) {
    return { ...runDayLoop(weeklyRent / 7), rentalDays, pricingTier: 'weekly' };
  }

  // Daily tier (< 7 days)
  if (dailyRent > 0) {
    return { ...runDayLoop(dailyRent), rentalDays, pricingTier: 'daily' };
  }

  // Fallbacks when daily rate is missing
  if (weeklyRent > 0) {
    return { ...runDayLoop(weeklyRent / 7), rentalDays, pricingTier: 'weekly' };
  }
  if (monthlyRent > 0) {
    return { ...runDayLoop(monthlyRent / monthlyTierDays), rentalDays, pricingTier: 'monthly' };
  }

  return {
    rentalPrice: 0,
    rentalDays,
    pricingTier: 'daily',
    dayBreakdown: [],
  };
}
