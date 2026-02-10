import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CURRENCY_LOCALE_MAP: Record<string, string> = {
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'en-IE',
};

/**
 * Format a number as currency using Intl.NumberFormat.
 * Defaults to GBP as the platform's base currency.
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
