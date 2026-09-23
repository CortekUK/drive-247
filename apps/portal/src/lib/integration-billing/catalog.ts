/**
 * Integration billing — the catalog as the portal reads it
 * (docs/integration-billing/build-spec.md, D4, D9, D10).
 *
 * PURE. The board card NAMES are the board's (`integrations-board.tsx`); the
 * KEYS are what `integration_catalog_v2.integration_key` holds and what the
 * edge function prices by. `supabase/functions/integration-billing/catalog.ts`
 * carries the same list, and a test pins the two equal.
 *
 * A key with no catalog row takes its DEFAULT: free and visible — the board
 * every tenant had — except the integrations in DEFAULT_PREMIUM_KEYS, which
 * carry the crown from the start. A missing table or a failed read falls back
 * to exactly those defaults.
 */

export interface BoardIntegration {
  key: string;
  /** Exactly the `name` on the board's list. */
  name: string;
}

export const INTEGRATION_KEYS: readonly BoardIntegration[] = [
  { key: 'turo_sync', name: 'Turo Sync' },
  { key: 'stripe_connect', name: 'Stripe Connect' },
  { key: 'square', name: 'Square' },
  { key: 'bonzah', name: 'Bonzah' },
  { key: 'inshur', name: 'Inshur' },
  { key: 'boldsign', name: 'BoldSign' },
  { key: 'checkmydriver', name: 'CheckMyDriver' },
  { key: 'twilio_messages', name: 'Twilio Messages' },
  { key: 'twilio_calling', name: 'Twilio Calling' },
  { key: 'tesla', name: 'Tesla' },
  { key: 'custom_domain', name: 'Custom Domain' },
  { key: 'xero', name: 'Xero' },
  { key: 'zoho', name: 'Zoho' },
];

/**
 * Integrations whose panel is still a "coming soon" preview: nothing to connect.
 * They may be marked premium (the crown and price show, as in the video's own
 * Inshur example), but cannot be SUBSCRIBED to until they launch — a monthly
 * charge for a panel that says "not available yet" is money for nothing. The
 * edge function refuses them too (supabase/functions/integration-billing/
 * catalog.ts, PREVIEW_ONLY_KEYS), and a test pins the two lists equal. Delete a
 * key here, there and in the admin page the day its panel goes live.
 */
export const PREVIEW_ONLY_KEYS: readonly string[] = ['turo_sync', 'inshur', 'checkmydriver'];

export function isPreviewOnly(key: string): boolean {
  return PREVIEW_ONLY_KEYS.includes(key);
}

export function keyForBoardName(name: string): string | null {
  return INTEGRATION_KEYS.find((i) => i.name === name)?.key ?? null;
}

export function nameForKey(key: string): string | null {
  return INTEGRATION_KEYS.find((i) => i.key === key)?.name ?? null;
}

export interface CatalogEntry {
  key: string;
  isPremium: boolean;
  /** USD cents; null unless premium. */
  monthlyPriceCents: number | null;
  currency: string;
  firstMonthFree: boolean;
  isHidden: boolean;
  isBeta: boolean;
  isUnavailable: boolean;
}

/**
 * Premium out of the box, before a super admin has saved anything: Inshur
 * ("jis tarah hamare paas ye Inshur hai — ye hamari premium integration hai"),
 * Turo Sync ("jis tarah Turo sync hamari paid ek hogi") and CheckMyDriver.
 * No price is assumed — the video's $20 is an example, not a decision — so
 * each shows "Price to be announced" until the super admin sets one, and none
 * can be bought until it has a price (and, for these three, until it launches;
 * see PREVIEW_ONLY_KEYS). A saved catalog row always wins over this default.
 * Mirrored in apps/admin/lib/integration-pricing.ts; a test pins the two equal.
 */
export const DEFAULT_PREMIUM_KEYS: readonly string[] = ['turo_sync', 'inshur', 'checkmydriver'];

export const freeEntry = (key: string): CatalogEntry => ({
  key,
  isPremium: false,
  monthlyPriceCents: null,
  currency: 'usd',
  firstMonthFree: false,
  isHidden: false,
  isBeta: false,
  isUnavailable: false,
});

/** What a key is with no catalog row: free, unless it is premium by default. */
export const defaultEntry = (key: string): CatalogEntry => ({
  ...freeEntry(key),
  isPremium: DEFAULT_PREMIUM_KEYS.includes(key),
});

/** A raw `integration_catalog_v2` row. */
export interface CatalogRow {
  integration_key: string;
  is_premium?: boolean | null;
  monthly_price_cents?: number | null;
  currency?: string | null;
  first_month_free?: boolean | null;
  is_hidden?: boolean | null;
  is_beta?: boolean | null;
  is_unavailable?: boolean | null;
}

/**
 * Rows → one entry per known key; a key with no row takes its default.
 * Unknown keys are dropped. Premium and price are separate facts: a premium
 * integration with no price yet still wears the crown and reads "Price to be
 * announced" — it simply cannot be subscribed to until it has a price.
 */
export function catalogFromRows(rows: readonly CatalogRow[] | null | undefined): Record<string, CatalogEntry> {
  const out: Record<string, CatalogEntry> = {};
  for (const { key } of INTEGRATION_KEYS) out[key] = defaultEntry(key);
  for (const row of rows ?? []) {
    if (!row || !(row.integration_key in out)) continue;
    const cents = Number(row.monthly_price_cents);
    const priced = row.monthly_price_cents != null && Number.isInteger(cents) && cents > 0;
    const premium = row.is_premium === true;
    out[row.integration_key] = {
      key: row.integration_key,
      isPremium: premium,
      monthlyPriceCents: premium && priced ? cents : null,
      currency: String(row.currency || 'usd').toLowerCase(),
      firstMonthFree: premium && row.first_month_free === true,
      isHidden: row.is_hidden === true,
      isBeta: row.is_beta === true,
      isUnavailable: row.is_unavailable === true,
    };
  }
  return out;
}

/** "$20.00", "$1,250.00". Minor units in, the currency's own formatting out. */
export function formatMoney(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

/** "−$20.00" with a real minus sign for credits; plain for charges. */
export function formatSignedMoney(cents: number, currency = 'usd'): string {
  return cents < 0 ? `−${formatMoney(-cents, currency)}` : formatMoney(cents, currency);
}

/** "Oct 15, 2026", or null. */
export function formatBillDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "$20.00/month", or "Price to be announced" while a premium integration has no price. */
export function premiumPriceLabel(entry: Pick<CatalogEntry, 'monthlyPriceCents' | 'currency'>): string {
  return entry.monthlyPriceCents ? `${formatMoney(entry.monthlyPriceCents, entry.currency)}/month` : 'Price to be announced';
}

/**
 * The line under a premium integration's price, before subscribing.
 *   "First month free. Then $20.00 a month, added to your Drive247 bill."
 *   "$20.00 a month, added to your Drive247 bill."
 *   "If you subscribe, its monthly price is added to your Drive247 bill…" (no price yet)
 */
export function premiumPitch(entry: Pick<CatalogEntry, 'monthlyPriceCents' | 'currency' | 'firstMonthFree'>): string {
  if (!entry.monthlyPriceCents) {
    return entry.firstMonthFree
      ? 'First month free. If you subscribe, its monthly price is added to your Drive247 bill as its own line.'
      : 'If you subscribe, its monthly price is added to your Drive247 bill as its own line.';
  }
  const price = formatMoney(entry.monthlyPriceCents, entry.currency);
  return entry.firstMonthFree
    ? `First month free. Then ${price} a month, added to your Drive247 bill.`
    : `${price} a month, added to your Drive247 bill.`;
}

/**
 * The sentence on the confirm step — the transcript's own "$20 will be added
 * to your next bill", with the date when there is one. The gap until that
 * date is Drive247's to absorb, so nothing is charged today.
 */
export function confirmSentence(input: {
  monthlyPriceCents: number;
  currency: string;
  firstMonthFree: boolean;
  nextBillAt: string | null | undefined;
}): string {
  const price = formatMoney(input.monthlyPriceCents, input.currency);
  const date = formatBillDate(input.nextBillAt);
  const onDate = date ? ` on ${date}` : '';
  return input.firstMonthFree
    ? `Nothing is charged today. Your first month is free: your next bill${onDate} shows ${price} and a ${price} credit. From the bill after that, ${price} will be added every month.`
    : `Nothing is charged today. ${price} will be added to your next bill${onDate}, and to every bill after that.`;
}

/** After subscribing. */
export function subscribedSentence(input: {
  name: string;
  monthlyPriceCents: number;
  currency: string;
  firstMonthFree: boolean;
  firstBillAt: string | null | undefined;
}): string {
  const price = formatMoney(input.monthlyPriceCents, input.currency);
  const date = formatBillDate(input.firstBillAt);
  const onDate = date ? ` on ${date}` : '';
  return input.firstMonthFree
    ? `You're subscribed to ${input.name}. Your first month is free, so your next bill${onDate} carries a ${price} credit for it. After that, ${price} is added every month.`
    : `You're subscribed to ${input.name}. ${price} will be added to your next bill${onDate}.`;
}

/** An existing subscription, after the dialog reopens. */
export function onYourBillSentence(input: { firstBillAt: string | null | undefined; now?: Date }): string {
  const date = formatBillDate(input.firstBillAt);
  if (!date) return "On your Drive247 bill every month, as its own line on each invoice.";
  const upcoming = new Date(input.firstBillAt!).getTime() > (input.now ?? new Date()).getTime();
  return upcoming
    ? `First on your Drive247 bill on ${date}, then every month after, as its own line on each invoice.`
    : `On your Drive247 bill every month since ${date}, as its own line on each invoice.`;
}
