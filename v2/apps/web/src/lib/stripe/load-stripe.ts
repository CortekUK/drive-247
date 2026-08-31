import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";

/**
 * Getting a Stripe.js instance that can actually confirm OUR client secrets.
 *
 * THE POINT OF THIS FILE is the `stripeAccount` option. Drive247 takes booking
 * money as Stripe Connect DIRECT charges: the PaymentIntent is created ON the
 * connected account, so its client secret exists only in that account's
 * namespace. A `loadStripe(pk)` with no `stripeAccount` produces an instance
 * bound to the PLATFORM account, and `confirmPayment` with it fails with "No
 * such payment_intent" — the secret is real, it is simply not visible from
 * where you are standing.
 *
 * `apps/booking/src/config/stripe.ts` (v1) omits the option. That is safe there
 * only because v1 never confirms anything client-side; it redirects to Stripe's
 * hosted checkout, which resolves the account server-side. Do not copy it.
 *
 * ── WHY `/pure` ─────────────────────────────────────────────────────────────
 * The default `@stripe/stripe-js` entry point injects `js.stripe.com` the
 * moment the MODULE is imported, not when `loadStripe` is called. Since the
 * payment panel is mounted (closed) on every booking page, that meant four
 * requests to Stripe — including `m.stripe.com/6`, their fraud-signal beacon —
 * for every visitor who only ever looked at a car. Measured on this page, not
 * assumed. `/pure` exports the same `loadStripe` with the side effect removed,
 * so Stripe.js is fetched on the first real call: after the customer has asked
 * to pay and the server has minted an intent.
 *
 * The publishable key and the account id both come from the server with the
 * client secret, in one response — the mode (test/live) and the account are the
 * tenant's, resolved by `_shared/stripe-client.ts`, and a key hardcoded in the
 * bundle would be the wrong one for half the tenants.
 */

/**
 * One promise per (key, account) pair.
 *
 * `loadStripe` injects and reuses ONE <script> for the whole page, but each
 * call still constructs a fresh `Stripe` object. Caching here means remounting
 * the payment panel — closing the dialog and reopening it — reuses the instance
 * instead of building a new one on every open.
 */
const instances = new Map<string, Promise<Stripe | null>>();

export function getStripeForAccount(
  publishableKey: string,
  /** The connected account the intent lives on. Null only for platform charges. */
  connectAccountId: string | null,
): Promise<Stripe | null> {
  const cacheKey = `${publishableKey}::${connectAccountId ?? "platform"}`;

  const cached = instances.get(cacheKey);
  if (cached) return cached;

  const created =
    connectAccountId === null
      ? loadStripe(publishableKey)
      : loadStripe(publishableKey, { stripeAccount: connectAccountId });

  instances.set(cacheKey, created);
  return created;
}
