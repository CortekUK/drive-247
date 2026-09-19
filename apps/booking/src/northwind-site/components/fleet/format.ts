/**
 * Presentation formatting for the fleet surfaces.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 *  - the currency ALWAYS comes from `tenants.currency_code`. The prototype
 *    printed a literal `$`, which is wrong for every non-USD operator on the
 *    platform and cannot be spotted from a screenshot.
 *  - the locale is pinned. `/fleet` renders its first paint on the server and
 *    hydrates in the browser; with an implicit locale those two run under
 *    different ICU defaults and React reports a hydration mismatch on every
 *    price. A fixed locale makes both sides emit the same bytes.
 */

const MONEY_LOCALE = 'en-US';
const DEFAULT_CURRENCY = 'USD';

/**
 * A price, in the tenant's currency.
 *
 * Whole amounts lose the `.00` — the seeded fleet is priced at 50 / 89 / 650,
 * and "$650.00" on a card is noise. Anything with real cents keeps both digits.
 */
export function formatMoney(
  amount: number | null | undefined,
  currencyCode: string | null | undefined,
): string {
  if (amount == null || !Number.isFinite(amount)) return '—';

  const currency = (currencyCode ?? DEFAULT_CURRENCY).trim().toUpperCase();
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;

  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    // `Intl` throws a RangeError on a currency code that is not ISO-4217.
    // A tenant with a typo in the column gets a readable price, not a crash.
    return `${currency} ${amount.toFixed(fractionDigits)}`;
  }
}

/** A plain integer with thousands separators — "3,000". */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(MONEY_LOCALE, { maximumFractionDigits: 0 }).format(value);
}

/**
 * Short form of `tenants.distance_unit`, for card chips where the full word
 * does not fit. Unknown units are passed through rather than guessed at.
 */
export function distanceUnitAbbrev(unit: string | null | undefined): string {
  const value = (unit ?? '').trim().toLowerCase();
  if (value === '' || value.startsWith('mi')) return 'mi';
  if (value.startsWith('km') || value.startsWith('kilo')) return 'km';
  return value;
}

/**
 * A mileage allowance. `null` is the domain layer's spelling of "unlimited"
 * (no cap set on that tier), so it is rendered as such rather than as "0".
 */
export function formatMileage(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return 'Unlimited';
  return `${formatNumber(value)} ${distanceUnitAbbrev(unit)}`;
}

/** "6 of 10 vehicles" / "1 of 10 vehicles" — the result count, pluralised. */
export function formatResultCount(shown: number, total: number): string {
  const noun = total === 1 ? 'vehicle' : 'vehicles';
  if (shown === total) return `${total} ${noun}`;
  return `${shown} of ${total} ${noun}`;
}
