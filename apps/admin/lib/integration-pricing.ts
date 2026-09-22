/**
 * Premium integration pricing, as the super admin types it
 * (/admin/integrations; docs/integration-billing/build-spec.md, D4, D12).
 *
 * PURE. Prices are typed in dollars and stored in cents — parsed as TEXT, never
 * through floating point, so "20.20" is 2020 cents and not 2019.9999.
 */

/** The integrations on the operator's board, by the key the catalog stores. Mirrors the portal's INTEGRATION_KEYS. */
export const ADMIN_INTEGRATIONS: ReadonlyArray<{ key: string; name: string; category: string }> = [
  { key: 'turo_sync', name: 'Turo Sync', category: 'Fleet' },
  { key: 'stripe_connect', name: 'Stripe Connect', category: 'Payments' },
  { key: 'square', name: 'Square', category: 'Payments' },
  { key: 'bonzah', name: 'Bonzah', category: 'Insurance' },
  { key: 'inshur', name: 'Inshur', category: 'Insurance' },
  { key: 'boldsign', name: 'BoldSign', category: 'Documents' },
  { key: 'checkmydriver', name: 'CheckMyDriver', category: 'Verification' },
  { key: 'twilio_messages', name: 'Twilio Messages', category: 'Messaging' },
  { key: 'twilio_calling', name: 'Twilio Calling', category: 'Calling' },
  { key: 'tesla', name: 'Tesla', category: 'Fleet' },
  { key: 'custom_domain', name: 'Custom Domain', category: 'Website' },
  { key: 'xero', name: 'Xero', category: 'Accounting' },
  { key: 'zoho', name: 'Zoho', category: 'Accounting' },
];

/**
 * Still a "coming soon" preview on the operator's board: can be priced (the
 * crown and price show) but cannot be subscribed to until it launches.
 * Mirrors PREVIEW_ONLY_KEYS in the portal and the edge function.
 */
export const PREVIEW_ONLY_KEYS: readonly string[] = ['turo_sync', 'inshur', 'checkmydriver'];

/**
 * Premium by default, before anything is saved: Inshur, Turo Sync and
 * CheckMyDriver. Mirrors DEFAULT_PREMIUM_KEYS in
 * apps/portal/src/lib/integration-billing/catalog.ts (pinned by a test).
 */
export const DEFAULT_PREMIUM_KEYS: readonly string[] = ['turo_sync', 'inshur', 'checkmydriver'];

/** Stripe's smallest USD charge, and a ceiling that catches a typo'd extra zero. */
export const MIN_PRICE_CENTS = 50;
export const MAX_PRICE_CENTS = 1_000_000;

/**
 * "20", "20.2", "20.20", "$1,250.00" → cents; anything else → null.
 * At most two decimals: "20.205" is refused rather than rounded, because a
 * price that silently changes on save is worse than one the form refuses.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = cleaned.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const fraction = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return whole * 100 + fraction;
}

/** 2020 → "20.20" (for the input box). */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '';
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/**
 * Why a premium price cannot be saved, or null when it can. A BLANK price is
 * allowed: the integration shows "Price to be announced" and cannot be
 * subscribed to until a price is set.
 */
export function premiumPriceProblem(input: string): string | null {
  if (input.trim() === '') return null;
  const cents = parseDollarsToCents(input);
  if (cents === null) return 'Type the monthly price in dollars, like 20 or 20.20.';
  if (cents < MIN_PRICE_CENTS) return 'The monthly price must be at least $0.50 (Stripe’s smallest charge).';
  if (cents > MAX_PRICE_CENTS) return 'The monthly price must be $10,000 or less.';
  return null;
}
