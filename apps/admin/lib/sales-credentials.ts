/**
 * Sales onboarding credentials — client-side mirror of the
 * `create-sales-onboarding` edge function.
 *
 * ⚠️  THIS FILE MUST STAY IN LOCKSTEP WITH
 *     supabase/functions/create-sales-onboarding/index.ts
 *
 * The Sales tab needs to re-show a client's credentials long after the
 * onboarding ran, but the plaintext password is deliberately NEVER persisted —
 * `sales_onboarding_submissions` has no password column and must not gain one.
 * The password is instead *recomputed* here from the slug, using the exact same
 * derivation the edge function used when the tenant was provisioned
 * (`capitalizeFirst(slugAlnum) + "123!"`, see index.ts §5).
 *
 * Consequence: if the derivation, the message template, the currency symbols or
 * the URL shapes ever change on the server, they MUST be changed here too —
 * otherwise George hands a client a password or a link that does not work.
 *
 * Because `must_change_password = true`, the recomputed value is only the
 * INITIAL password: a client who has already logged in has changed it. Every UI
 * that surfaces it must say so.
 */

/** Uppercase the first char, leave the rest untouched. Mirrors capitalizeFirst() in index.ts. */
const capitalizeFirst = (s: string): string => (s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The first-login password handed to the client, derived from their slug.
 *
 * Mirrors index.ts §5 exactly:
 *   const slugAlnum = slug.replace(/[^a-z0-9]/g, "");
 *   const password  = capitalizeFirst(slugAlnum) + "123!";
 *
 * (The edge function already lower-cases the slug in normalizeSlug(); we
 * lower-case here too so a stored slug with stray capitals still resolves to the
 * same password.)
 *
 * e.g. "metal-fleet" → "Metalfleet123!"
 */
export const derivePasswordFromSlug = (slug: string): string =>
  capitalizeFirst((slug || '').toLowerCase().replace(/[^a-z0-9]/g, '')) + '123!';

/** Symbol/prefix for a subscription amount. Mirrors currencySymbol() in index.ts. */
export const currencySymbolFor = (currency: string | null | undefined): string => {
  switch ((currency || 'usd').toLowerCase()) {
    case 'usd':
      return '$';
    case 'gbp':
      return '£';
    case 'eur':
      return '€';
    case 'aed':
      return 'AED ';
    default:
      return (currency || '').toUpperCase() + ' ';
  }
};

/**
 * Dollars from cents for the *client message*, dropping a trailing ".00".
 * Byte-for-byte identical to formatDollars() in index.ts — deliberately WITHOUT
 * thousands separators, because the message must match what the edge function
 * produced. Do not "improve" this; use formatAmount() for UI chrome instead.
 */
const formatDollarsForMessage = (amountCents: number): string => {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
};

/**
 * Human-readable subscription amount for UI display: "$299", "$1,250.50".
 * Grouped with thousands separators (matching the Sales table), and a trailing
 * ".00" is dropped. NOTE: the client message uses the ungrouped edge-function
 * form — see formatDollarsForMessage().
 */
export const formatAmount = (amountCents: number | null | undefined, currency: string | null | undefined): string => {
  if (amountCents == null || !Number.isFinite(amountCents)) return '—';
  const dollars = amountCents / 100;
  // minimumFractionDigits must follow the value, not be pinned to 0: pinning it
  // drops a SIGNIFICANT trailing zero, so $1,250.50 rendered as "$1,250.5".
  return `${currencySymbolFor(currency)}${dollars.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

/** Portal (staff) subdomain for a tenant. Mirrors index.ts: `https://${slug}.portal.drive-247.com`. */
export const portalUrlFor = (slug: string): string => `https://${slug}.portal.drive-247.com`;

/** Booking (customer) subdomain for a tenant. Mirrors index.ts: `https://${slug}.drive-247.com`. */
export const bookingUrlFor = (slug: string): string => `https://${slug}.drive-247.com`;

export interface ClientMessageArgs {
  /** Client's first name; blank/null falls back to "there", as the edge fn does. */
  firstName?: string | null;
  companyName: string;
  email: string;
  password: string;
  portalUrl: string;
  bookingUrl: string;
  /**
   * Subscription amount in CENTS (as stored on sales_onboarding_submissions).
   * `null` means it was never recorded — the subscription sentence is then
   * OMITTED rather than rendered as "$0/month". The column is nullable and the
   * submission insert is best-effort, so this case is genuinely reachable.
   */
  amountCents: number | null;
  currency: string;
}

/**
 * The "send to client" message.
 *
 * Copied character-for-character from index.ts §14 (including the 🎉 / 🔑 / 🖥️ /
 * 🚗 emoji and the DOUBLE space after 🖥️ and 🚗). Any edit here must be made on
 * the server too, or a re-sent message will not match the original.
 */
export const buildClientMessage = (args: ClientMessageArgs): string => {
  // Never quote a price we do not actually have. Emitting "$0/month" here would
  // put a written "we will charge you nothing" commitment into the message a
  // sales person copies and sends to a real client, so when the amount is
  // unknown the sentence is dropped entirely instead.
  const subscriptionLine =
    args.amountCents == null
      ? ''
      : `When you first log in you'll activate your subscription ` +
        `(${currencySymbolFor(args.currency)}${formatDollarsForMessage(args.amountCents)}/month) ` +
        `to unlock your dashboard.\n\n`;

  return (
    `Hi ${args.firstName || 'there'},\n\n` +
    `Your ${args.companyName} portal is ready! 🎉\n\n` +
    `🔑 Login details\n` +
    `Email: ${args.email}\n` +
    `Password: ${args.password}\n` +
    `(You'll set your own password on first login.)\n\n` +
    `🖥️  Admin portal (log in here): ${args.portalUrl}\n` +
    `🚗  Your booking site: ${args.bookingUrl}\n\n` +
    subscriptionLine +
    `Any questions, just reply here!`
  );
};
