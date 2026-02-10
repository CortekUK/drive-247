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
