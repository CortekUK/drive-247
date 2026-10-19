import type { Vehicle } from '@nw/lib/vehicles/types';

import type { QuoteVehicle } from './types';

/**
 * A loaded vehicle as the quote engine reads it. The ONE mapping: the booking
 * page and the v2 quick book dialog both price through this, so a car can never
 * cost one thing on a card and another at checkout.
 */
export function toQuoteVehicle(vehicle: Vehicle): QuoteVehicle {
  return {
    id: vehicle.id,
    daily_rent: vehicle.dailyRent,
    weekly_rent: vehicle.weeklyRent,
    monthly_rent: vehicle.monthlyRent,
    security_deposit: vehicle.securityDeposit,
    daily_mileage: vehicle.dailyMileage,
    weekly_mileage: vehicle.weeklyMileage,
    monthly_mileage: vehicle.monthlyMileage,
    excess_mileage_rate: vehicle.excessMileageRate,
    unlimited_mileage_available: vehicle.unlimitedMileageAvailable,
    unlimited_mileage_price_daily: vehicle.unlimitedMileagePrices.daily,
    unlimited_mileage_price_weekly: vehicle.unlimitedMileagePrices.weekly,
    unlimited_mileage_price_monthly: vehicle.unlimitedMileagePrices.monthly,
  };
}
