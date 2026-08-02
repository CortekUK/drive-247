// =============================================================================
// signup-stripe — the Stripe surface for self-serve signup.
//
// Self-serve SaaS billing runs on the UAE platform account, always. That is not
// a preference: tenants.subscription_account DEFAULTs to 'uae', every new
// tenant is provisioned with subscription_account = 'uae', and a Price created
// on the UK account simply does not exist on the UAE one. (create-sales-
// onboarding still creates its Price on 'uk' — a live bug this path must not
// inherit.)
//
// The other thing this module fixes is Product/Price sprawl. The sales path
// passes `product_data` to prices.create, which mints a NEW Stripe Product per
// tenant. Self-serve would compound that into one Product AND one Price per
// signup. Here there is exactly ONE Product and ONE Price per plan, resolved by
// a stable `lookup_key`, reused by every tenant forever.
// =============================================================================

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getSubscriptionStripeClientForAccount } from "./subscription-stripe.ts";
import type { SignupPlanServer } from "./signup-plans.ts";

export const SIGNUP_STRIPE_ACCOUNT = "uae" as const;
export const STRIPE_PRODUCT_NAME = "Drive247 Platform Subscription";

/**
 * A missing secret must never surface as a blank card form or a spinner that
 * never resolves. This error carries the EXACT env var name so the caller can
 * return `CONFIG_MISSING { detail: { env } }` and log a line an operator can
 * act on without reading the source.
 */
export class SignupConfigError extends Error {
  readonly env: string;
  constructor(env: string) {
    super(`${env} is not set`);
    this.name = "SignupConfigError";
    this.env = env;
  }
}

/**
 * 'live' unless SIGNUP_STRIPE_MODE is exactly 'test'.
 *
 * Defaulting to LIVE is deliberate: an unset variable in production must not
 * silently take fake money and provision test tenants. Rehearsals opt in.
 */
export function getSignupStripeMode(): "test" | "live" {
  return Deno.env.get("SIGNUP_STRIPE_MODE") === "test" ? "test" : "live";
}

/** Secret-key client for the UAE account, with a named failure. */
export function getSignupStripeClient(mode: "test" | "live"): Stripe {
  const env = mode === "live" ? "STRIPE_UAE_LIVE_SECRET_KEY" : "STRIPE_UAE_TEST_SECRET_KEY";
  if (!Deno.env.get(env)) throw new SignupConfigError(env);
  // Delegates so the API version and fetch http client stay identical to every
  // other subscription-billing call site.
  return getSubscriptionStripeClientForAccount(SIGNUP_STRIPE_ACCOUNT, mode);
}

/**
 * The browser needs a publishable key to mount the Payment Element, and there
 * is no NEXT_PUBLIC one for the UAE account — the booking app's
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is the legacy UK key and will not work
 * against a UAE PaymentIntent. So the server hands the right key down.
 */
export function getSignupPublishableKey(mode: "test" | "live"): string {
  const env = mode === "live"
    ? "STRIPE_UAE_LIVE_PUBLISHABLE_KEY"
    : "STRIPE_UAE_TEST_PUBLISHABLE_KEY";
  const key = Deno.env.get(env);
  if (!key) throw new SignupConfigError(env);
  return key;
}

/**
 * One shared Product for the whole platform subscription line.
 * Mirrors create-subscription-checkout's getOrCreateProduct.
 */
export async function getOrCreateSignupProduct(stripe: Stripe): Promise<string> {
  const products = await stripe.products.search({
    query: `name:'${STRIPE_PRODUCT_NAME}' AND active:'true'`,
  });
  if (products.data.length > 0) return products.data[0].id;

  const product = await stripe.products.create(
    {
      name: STRIPE_PRODUCT_NAME,
      description: "Monthly/yearly subscription for the Drive247 rental management platform",
    },
    // Two signups racing a cold account would otherwise create two Products.
    { idempotencyKey: "d247-signup-product-v1" },
  );
  return product.id;
}

/**
 * Resolve-or-create the single Price for a plan, by `lookup_key`.
 *
 * NEVER creates a duplicate on a repeat call: the lookup happens first, and the
 * create carries the same lookup_key so a concurrent racer's create fails
 * loudly rather than silently minting a second Price at the same amount. On
 * that race we simply re-read and use the winner's Price.
 */
/**
 * Resolved prices, memoised for the life of the isolate.
 *
 * The lookup is a full Stripe round trip (~300-500ms from the edge) sitting on
 * the critical path of EVERY payment-intent request, between creating the
 * customer and creating the subscription — and it re-derives a value that is
 * immutable by construction. Stripe Prices cannot be edited: changing an amount
 * means a new Price, and this module's contract (see signup-plans.ts) is that a
 * changed price gets a NEW `lookupKey`. So a stale cache entry is not reachable
 * — a new price is a new cache key.
 *
 * Keyed by lookup_key AND the Stripe account the client is bound to: the same
 * plan resolves to different Price ids on the test and live accounts, and an
 * isolate must never hand a live subscription a test price.
 */
const priceCache = new Map<string, { priceId: string; productId: string }>();

/** Stripe clients are per-account/mode; the key must not collapse them. */
function priceCacheKey(stripe: Stripe, plan: SignupPlanServer): string {
  // The secret key's prefix distinguishes live from test without logging or
  // storing the key itself.
  const mode = (stripe as unknown as { _api?: { key?: string } })._api?.key?.startsWith("sk_live")
    ? "live"
    : "test";
  return `${mode}:${plan.lookupKey}`;
}

export async function getOrCreateSignupPrice(
  stripe: Stripe,
  plan: SignupPlanServer,
): Promise<{ priceId: string; productId: string }> {
  const cacheKey = priceCacheKey(stripe, plan);
  const cached = priceCache.get(cacheKey);
  if (cached) return cached;

  const found = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
    expand: ["data.product"],
  });
  const existing = found.data[0];
  if (existing) {
    const productId = typeof existing.product === "string"
      ? existing.product
      : (existing.product as { id: string }).id;
    const resolved = { priceId: existing.id, productId };
    priceCache.set(cacheKey, resolved);
    return resolved;
  }

  const productId = await getOrCreateSignupProduct(stripe);

  try {
    const price = await stripe.prices.create(
      {
        product: productId,
        unit_amount: plan.amountCents,
        currency: plan.currency,
        recurring: { interval: plan.interval },
        lookup_key: plan.lookupKey,
        nickname: `Drive247 ${plan.name} (self-serve)`,
        metadata: { d247_signup_plan: plan.id, plan_name: plan.name },
      },
      { idempotencyKey: `d247-signup-price-${plan.lookupKey}` },
    );
    const resolved = { priceId: price.id, productId };
    priceCache.set(cacheKey, resolved);
    return resolved;
  } catch (e) {
    // `lookup_key` is unique per account: a racer created it between our list
    // and our create. Re-read rather than transferring the key (which would
    // deactivate the winner's Price and orphan any subscription pointing at it).
    const retry = await stripe.prices.list({
      lookup_keys: [plan.lookupKey],
      active: true,
      limit: 1,
    });
    const winner = retry.data[0];
    if (winner) {
      const winnerProduct = typeof winner.product === "string"
        ? winner.product
        : (winner.product as { id: string }).id;
      const resolved = { priceId: winner.id, productId: winnerProduct };
      priceCache.set(cacheKey, resolved);
      return resolved;
    }
    throw e;
  }
}

/** ISO string from a Stripe unix seconds field, or null. Never throws. */
function toIsoOrNull(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * `current_period_start` / `current_period_end`.
 *
 * Stripe REMOVED these from the Subscription object in API version 2025-03-31
 * and moved them onto the subscription ITEMS. We pin 2023-10-16, so the
 * subscription-level fields are normally present — but reading them unguarded
 * is exactly what once threw `RangeError: Invalid time value` and 500'd every
 * subscription webhook. Read both shapes, and return nulls rather than throwing
 * so callers can OMIT the columns instead of writing null over good values.
 */
export function resolveSubscriptionPeriod(sub: any): { start: string | null; end: string | null } {
  const item = sub?.items?.data?.[0];
  const start = toIsoOrNull(sub?.current_period_start) ?? toIsoOrNull(item?.current_period_start);
  const end = toIsoOrNull(sub?.current_period_end) ?? toIsoOrNull(item?.current_period_end);
  return { start, end };
}

/** Spread-able patch that never clobbers a stored period with null. */
export function periodPatch(period: { start: string | null; end: string | null }) {
  return {
    ...(period.start ? { current_period_start: period.start } : {}),
    ...(period.end ? { current_period_end: period.end } : {}),
  };
}

export type ResolvedCard = {
  brand?: string;
  last4?: string;
  exp_month?: number;
  exp_year?: number;
};

/**
 * Best-effort card details for the portal's billing screen.
 *
 * `subscription.default_payment_method` is empty for most healthy
 * subscriptions — 19 of 26 live subscriptions stored no card at all because
 * that was the only field the webhook read, and the portal then told paying
 * tenants they had "No payment method on file". Checked in the order Stripe
 * itself resolves them.
 *
 * Returns null rather than a blank object so the caller OMITS the columns
 * instead of blanking a card it already had.
 */
export async function resolveCard(stripe: Stripe, sub: any): Promise<ResolvedCard | null> {
  const fromPm = (pm: any): ResolvedCard | null =>
    pm?.card
      ? {
        brand: pm.card.brand,
        last4: pm.card.last4,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
      }
      : null;

  const direct = fromPm(sub?.default_payment_method);
  if (direct) return direct;

  const customerId = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
  if (!customerId) return null;

  try {
    const customer: any = await stripe.customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer?.deleted) return null;
    const fromCustomer = fromPm(customer?.invoice_settings?.default_payment_method);
    if (fromCustomer) return fromCustomer;

    const latestInvoiceId = typeof sub?.latest_invoice === "string"
      ? sub.latest_invoice
      : sub?.latest_invoice?.id;
    if (latestInvoiceId) {
      const inv: any = await stripe.invoices.retrieve(latestInvoiceId, {
        expand: ["payment_intent.payment_method"],
      });
      const fromInvoice = fromPm(inv?.payment_intent?.payment_method);
      if (fromInvoice) return fromInvoice;
    }

    const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    const fromList = fromPm(pms?.data?.[0]);
    if (fromList) return fromList;
  } catch (e) {
    console.warn(`[signup-stripe] could not resolve card for ${sub?.id}:`, (e as any)?.message ?? e);
  }
  return null;
}
