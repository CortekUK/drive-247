/**
 * Money as the operator portal prints it. Moved from
 * apps/portal/src/lib/format-utils.ts, which re-exports it, so the shared
 * rentals timeline prints prices the same in both portals.
 */

export const CURRENCY_LOCALE_MAP: Record<string, string> = {
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'en-IE',
};

/**
 * Format a number as currency using the tenant's currency code.
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = 'USD',
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  const code = currencyCode?.toUpperCase() || 'USD';
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
