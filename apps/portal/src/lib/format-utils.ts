export type DistanceUnit = 'km' | 'miles';

const CURRENCY_LOCALE_MAP: Record<string, string> = {
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'en-IE',
};

/**
 * Format a number as currency using the tenant's currency code.
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = 'GBP',
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  const code = currencyCode?.toUpperCase() || 'GBP';
  const locale = CURRENCY_LOCALE_MAP[code] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: options?.minimumFractionDigits ?? 2,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

/**
 * Get the symbol for a currency code.
 */
export function getCurrencySymbol(currencyCode: string = 'GBP'): string {
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
