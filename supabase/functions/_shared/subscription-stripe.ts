import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

/**
 * Reads the subscription Stripe mode ('test' | 'live') for a specific tenant.
 * Requires a service_role Supabase client.
 */
export async function getSubscriptionStripeMode(
  supabase: any,
  tenantId: string
): Promise<"test" | "live"> {
  const { data } = await supabase
    .from("tenants")
    .select("subscription_stripe_mode")
    .eq("id", tenantId)
    .single();
  return data?.subscription_stripe_mode || "test";
}

/**
 * Returns a Stripe client configured for the given mode.
 * Fallback chain:
 *   test: STRIPE_SUBSCRIPTION_TEST_SECRET_KEY → STRIPE_SUBSCRIPTION_SECRET_KEY → STRIPE_TEST_SECRET_KEY
 *   live: STRIPE_SUBSCRIPTION_LIVE_SECRET_KEY → STRIPE_LIVE_SECRET_KEY
 */
export function getSubscriptionStripeClient(mode: "test" | "live") {
  let key: string | undefined;

  if (mode === "live") {
    key =
      Deno.env.get("STRIPE_SUBSCRIPTION_LIVE_SECRET_KEY") ||
      Deno.env.get("STRIPE_LIVE_SECRET_KEY");
  } else {
    key =
      Deno.env.get("STRIPE_SUBSCRIPTION_TEST_SECRET_KEY") ||
      Deno.env.get("STRIPE_SUBSCRIPTION_SECRET_KEY") ||
      Deno.env.get("STRIPE_TEST_SECRET_KEY");
  }

  if (!key) throw new Error(`No Stripe secret key found for mode: ${mode}`);
  return new Stripe(key, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Returns the webhook signing secret for the given mode.
 * Fallback chain:
 *   test: STRIPE_SUBSCRIPTION_TEST_WEBHOOK_SECRET → STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
 *   live: STRIPE_SUBSCRIPTION_LIVE_WEBHOOK_SECRET
 */
export function getSubscriptionWebhookSecret(mode: "test" | "live") {
  if (mode === "live") {
    return Deno.env.get("STRIPE_SUBSCRIPTION_LIVE_WEBHOOK_SECRET");
  }
  return (
    Deno.env.get("STRIPE_SUBSCRIPTION_TEST_WEBHOOK_SECRET") ||
    Deno.env.get("STRIPE_SUBSCRIPTION_WEBHOOK_SECRET")
  );
}
