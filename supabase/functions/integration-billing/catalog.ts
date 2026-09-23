/**
 * The integrations on the portal's board, by stable key, and how each one is
 * named on a Stripe bill. The key list is the portal's
 * `INTEGRATION_KEYS` (apps/portal/src/lib/integration-billing/catalog.ts);
 * a test pins the two equal.
 */
export interface IntegrationInfo {
  key: string;
  name: string;
}

export const INTEGRATIONS: readonly IntegrationInfo[] = [
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
 * Integrations whose portal panel is still a "coming soon" preview — nothing
 * to connect. They may be priced (the crown shows), but subscribing is refused
 * until they launch: a monthly charge for a panel that says "not available yet"
 * is money for nothing. Mirrors PREVIEW_ONLY_KEYS in
 * apps/portal/src/lib/integration-billing/catalog.ts (pinned by a test).
 */
export const PREVIEW_ONLY_KEYS: readonly string[] = ['turo_sync', 'inshur', 'checkmydriver'];

export function integrationByKey(key: unknown): IntegrationInfo | null {
  if (typeof key !== 'string') return null;
  return INTEGRATIONS.find((i) => i.key === key) ?? null;
}

/** The Stripe Product every price of this integration hangs off (one per account and mode). */
export function productIdFor(key: string): string {
  return `d247_integration_${key}`;
}

/** What the bill calls it: "Inshur subscription" (the transcript's own words). */
export function productNameFor(info: IntegrationInfo): string {
  return `${info.name} subscription`;
}

/**
 * The Price's lookup key. The amount is part of it, so a super admin changing
 * the price mints a NEW Price for new subscribers and never re-prices anyone
 * already subscribed (they keep the item they agreed to).
 */
export function lookupKeyFor(key: string, currency: string, cents: number): string {
  return `d247_integration_${key}_${currency.toLowerCase()}_${cents}_month`;
}

/** The integration a Stripe product id belongs to, or null. */
export function keyFromProductId(productId: unknown): string | null {
  if (typeof productId !== 'string') return null;
  const m = productId.match(/^d247_integration_([a-z][a-z0-9_]{1,40})$/);
  return m && integrationByKey(m[1]) ? m[1] : null;
}
