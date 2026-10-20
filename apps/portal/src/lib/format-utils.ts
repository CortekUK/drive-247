export type DistanceUnit = 'km' | 'miles';

// Lives in shared/portal-v2/money.ts (the shared rentals timeline prints money too).
export { formatCurrency } from "../../../../shared/portal-v2/money";

/**
 * Get the symbol for a currency code.
 */
export function getCurrencySymbol(currencyCode: string = 'USD'): string {
  const symbols: Record<string, string> = {
    USD: '$',
    GBP: '\u00a3',
    EUR: '\u20ac',
  };
  return symbols[currencyCode?.toUpperCase()] || currencyCode;
}

/**
 * Format a distance value with short unit label (e.g., "25 km" or "25 mi").
 */
export function formatDistance(value: number, unit: DistanceUnit = 'miles'): string {
  return `${value.toLocaleString()} ${unit === 'miles' ? 'mi' : 'km'}`;
}

/**
 * Format a distance value with long unit label (e.g., "25 km" or "25 miles").
 */
export function formatDistanceLong(value: number, unit: DistanceUnit = 'miles'): string {
  return `${value.toLocaleString()} ${unit === 'miles' ? 'miles' : 'km'}`;
}

/**
 * Get Earth's radius in the specified unit (for Haversine calculations).
 */
export function getEarthRadius(unit: DistanceUnit = 'miles'): number {
  return unit === 'miles' ? 3958.8 : 6371;
}

/**
 * Convert meters to the specified distance unit.
 */
export function metersToUnit(meters: number, unit: DistanceUnit = 'miles'): number {
  return unit === 'miles' ? meters / 1609.34 : meters / 1000;
}

/**
 * Convert a distance value to meters.
 */
export function unitToMeters(value: number, unit: DistanceUnit = 'miles'): number {
  return unit === 'miles' ? value * 1609.34 : value * 1000;
}

/**
 * Get the short unit label ("mi" or "km").
 */
export function getDistanceUnitShort(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'mi' : 'km';
}

/**
 * Get the long unit label ("miles" or "km").
 */
export function getDistanceUnitLong(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'miles' : 'km';
}

/**
 * Get per-month label ("mi/mo" or "km/mo").
 */
export function getPerMonthLabel(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'mi/mo' : 'km/mo';
}

/**
 * Get per-month long label ("mi/month" or "km/month").
 */
export function getPerMonthLabelLong(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'mi/month' : 'km/month';
}

/**
 * Get "Unlimited miles" or "Unlimited km" label.
 */
export function getUnlimitedLabel(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'Unlimited miles' : 'Unlimited km';
}

/**
 * Get per-day label ("mi/day" or "km/day").
 */
export function getPerDayLabel(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'mi/day' : 'km/day';
}

/**
 * Get per-day long label ("mi/day" or "km/day").
 */
export function getPerDayLabelLong(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'mi/day' : 'km/day';
}

/**
 * Get per-week label ("mi/wk" or "km/wk").
 */
export function getPerWeekLabel(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'mi/wk' : 'km/wk';
}

/**
 * Get per-week long label ("mi/week" or "km/week").
 */
export function getPerWeekLabelLong(unit: DistanceUnit = 'miles'): string {
  return unit === 'miles' ? 'mi/week' : 'km/week';
}

/**
 * Get mileage tier label for display.
 */
export function getMileageTierLabel(tier: 'daily' | 'weekly' | 'monthly', unit: DistanceUnit = 'miles'): string {
  switch (tier) {
    case 'daily': return getPerDayLabel(unit);
    case 'weekly': return getPerWeekLabel(unit);
    case 'monthly': return getPerMonthLabel(unit);
  }
}

/**
 * Convert km (DB storage unit for radius) to the tenant's display unit.
 */
export function kmToDisplayUnit(km: number, unit: DistanceUnit = 'miles'): number {
  return unit === 'miles' ? Math.round(km * 0.621371 * 10) / 10 : km;
}

/**
 * Convert from the tenant's display unit back to km (for radius storage).
 */
export function displayUnitToKm(value: number, unit: DistanceUnit = 'miles'): number {
  return unit === 'miles' ? Math.round(value / 0.621371 * 10) / 10 : value;
}
