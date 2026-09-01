// Where a customer-facing booking link points.
//
// WHY THIS IS SHARED CODE AND NOT A ONE-LINER PER FUNCTION
//
// Every function that emails a customer a link has to answer the same question,
// and getting it wrong is invisible until a real customer clicks a host they
// cannot resolve. The precedent is installment-pay-link/index.ts:174-193, which
// works out the origin correctly and then keeps it as a closure. This is that
// resolution, lifted verbatim so the outbox, the settlement path and
// booking-documents-link all agree on one answer.
//
// DO NOT copy create-ai-verification-session's buildQRUrl (index.ts:44-48)
// instead. That one reads a single global BOOKING_APP_URL with a
// {slug}.drive-247.com fallback, so a link minted on STAGING points at v1
// PRODUCTION. Our flow takes only its qrToken and ignores its qrUrl entirely,
// which is why that function needs no change.

/**
 * Resolve the public origin (scheme + host, no trailing slash) for a tenant's
 * booking site.
 *
 * Precedence, highest first:
 *   1. BOOKING_BASE_URL      — full override, wins outright. Single-domain QA
 *                              and staging set this and nothing else matters.
 *   2. https://{slug}.{BOOKING_BASE_DOMAIN ?? drive-247.com}
 *                            — the always-correct multi-tenant subdomain.
 *   3. the request's Origin header, when present and NOT localhost — so an
 *      operator testing in dev stays in dev, while a real customer email never
 *      lands on a host only that operator can reach.
 *   4. BOOKING_APP_URL       — legacy single-host env, last resort.
 *   then 'https://drive-247.com'.
 *
 * `req` is optional on purpose: the settlement path runs from a Stripe webhook
 * and has no meaningful caller origin, so it passes none and step 3 is skipped.
 */
export function deriveBookingOrigin(tenantSlug: string | null, req?: Request): string {
  const fullOverride = Deno.env.get('BOOKING_BASE_URL');
  if (fullOverride) return fullOverride.replace(/\/+$/, '');

  const baseDomain = Deno.env.get('BOOKING_BASE_DOMAIN') || 'drive-247.com';
  if (tenantSlug) return `https://${tenantSlug}.${baseDomain}`;

  const callerOrigin = req?.headers.get('origin') ?? '';
  const callerIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|.*\.localhost)(:|\/|$)/i.test(callerOrigin);
  if (callerOrigin && !callerIsLocal) return callerOrigin.replace(/\/+$/, '');

  return (Deno.env.get('BOOKING_APP_URL') || 'https://drive-247.com').replace(/\/+$/, '');
}

/**
 * The one and only shape of a documents-upload URL.
 *
 * Must stay in step with the page route at
 * v2/apps/web/src/app/(booking)/booking/documents/[token]/page.tsx. Kept here
 * rather than inlined at each call site so a route rename is one edit, not a
 * hunt through the senders.
 */
export function buildDocumentsUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/booking/documents/${token}`;
}
