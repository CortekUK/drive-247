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

/** Stripe.js is only ever served from this origin, and it is not versioned. */
const STRIPE_JS_ORIGIN = "https://js.stripe.com";
const STRIPE_JS_SRC = `${STRIPE_JS_ORIGIN}/v3`;

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
  // Stripe.js is served cross-origin and is not a credentialed request; without
  // this the preload is fetched in a different mode than the later <script> and
  // the browser discards it, warning "preloaded but not used".
  link.crossOrigin = "anonymous";
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
