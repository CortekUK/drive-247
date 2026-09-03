/**
 * Warms the network path to Stripe.js before anything needs it.
 *
 * THE PROBLEM THIS SOLVES. The payment step's dependency chain is entirely
 * serial, and two of its links are pure network latency that need not be on the
 * critical path at all:
 *
 *   signup-payment-intent  (cold start + stripe.customers.create +
 *                           stripe.subscriptions.create, all sequential)
 *     -> returns publishableKey
 *       -> loadStripe(key)  DNS + TLS + ~200KB script download from js.stripe.com
 *         -> <Elements> mounts
 *           -> PaymentElement's iframe fetches its own assets
 *
 * The browser cannot start step 2 until step 1 returns, because the publishable
 * key is served from the edge function rather than baked into the bundle (there
 * is no NEXT_PUBLIC key for the UAE platform account). So the user watches a
 * skeleton for the SUM of both, when the download could have happened during
 * the subscription creation.
 *
 * `loadStripe` does not need to be the thing that downloads the script — it
 * reuses whatever is already in the HTTP cache. So we start the fetch the moment
 * the dialog OPENS, which is typically 30+ seconds before the user finishes the
 * account form and reaches the payment step. By then the script is cached and
 * `loadStripe` resolves nearly instantly.
 *
 * Why this is not in the root layout: preloading a 200KB script for every
 * visitor to a marketing page — most of whom never click Subscribe — is exactly
 * the kind of speculative download that makes a landing page slow. Only the
 * `preconnect` is cheap enough to consider doing globally, and even that is
 * deferred to dialog-open here so the page's own critical path keeps every
 * connection slot.
 */

const STRIPE_JS_ORIGIN = "https://js.stripe.com";

/**
 * The EXACT url `@stripe/stripe-js` injects. It is NOT `/v3`.
 *
 * The SDK builds its script src from an internal release train:
 *   node_modules/@stripe/stripe-js/dist/index.mjs
 *     var RELEASE_TRAIN = 'clover';
 *     var STRIPE_JS_URL = ORIGIN + "/" + RELEASE_TRAIN + "/stripe.js";
 *
 * A preload whose URL does not byte-match the eventual <script src> is worse
 * than no preload at all: the browser fetches ~200KB that nothing consumes,
 * then fetches the real file anyway, and logs "was preloaded using link preload
 * but not used". The first version of this file preloaded `/v3` and did exactly
 * that.
 *
 * IF YOU UPGRADE @stripe/stripe-js, re-check RELEASE_TRAIN. If it no longer
 * matches, delete the preload rather than guessing — `preconnect` below is
 * train-agnostic and carries most of the benefit on a cold connection.
 */
const STRIPE_JS_SRC = `${STRIPE_JS_ORIGIN}/clover/stripe.js`;

/** Idempotent across every dialog open in a page session. */
let prewarmed = false;

function appendOnce(rel: string, href: string, as?: string): void {
  // A duplicate <link> is harmless but re-triggers the fetch in some browsers,
  // so match on rel+href rather than trusting the module-level flag alone —
  // React StrictMode double-invokes effects in development.
  const selector = `link[rel="${rel}"][href="${href}"]`;
  if (document.head.querySelector(selector)) return;

  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  if (as) link.as = as;
  // crossOrigin is set ONLY on preconnect. The <script> the SDK injects is a
  // plain, un-credentialed tag, and a preload whose CORS mode differs from the
  // eventual request is discarded by the browser — the same "preloaded but not
  // used" waste the wrong URL used to cause.
  if (rel === "preconnect") link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

/**
 * Call when the signup dialog opens. Safe to call repeatedly, and safe during
 * SSR (it no-ops without a document).
 */
export function prewarmStripeJs(): void {
  if (prewarmed || typeof document === "undefined") return;
  prewarmed = true;

  // preconnect does DNS + TCP + TLS up front; on a cold connection that alone is
  // often 200-400ms off the critical path.
  appendOnce("preconnect", STRIPE_JS_ORIGIN);
  // preload actually pulls the script into the HTTP cache.
  appendOnce("preload", STRIPE_JS_SRC, "script");
}
