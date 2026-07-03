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

// ---------------------------------------------------------------------------
// Multi-account subscription billing (UAE migration).
// A tenant's SaaS subscription is billed on tenants.subscription_account:
//   'uk'  — legacy account (existing tenants until migrated)
//   'uae' — new self-owned account (new tenants + migrated tenants)
// ---------------------------------------------------------------------------

export type SubscriptionAccount = "uk" | "uae";

/** Which platform account bills this tenant's subscription. Defaults to 'uk'. */
export async function getTenantSubscriptionAccount(
  supabase: any,
  tenantId: string
): Promise<SubscriptionAccount> {
  const { data } = await supabase
    .from("tenants")
    .select("subscription_account")
    .eq("id", tenantId)
    .single();
  return data?.subscription_account === "uae" ? "uae" : "uk";
}

/**
 * Stripe client for subscription billing on a specific platform account.
 * 'uk' preserves the legacy key fallback chain exactly; 'uae' uses the new
 * account's keys (subscriptions live on the same UAE account as Own Stripe).
 */
export function getSubscriptionStripeClientForAccount(
  account: SubscriptionAccount,
  mode: "test" | "live"
) {
  if (account === "uk") return getSubscriptionStripeClient(mode);

  const key = Deno.env.get(
    mode === "live" ? "STRIPE_UAE_LIVE_SECRET_KEY" : "STRIPE_UAE_TEST_SECRET_KEY"
  );
  if (!key) throw new Error(`No UAE Stripe secret key for mode: ${mode}`);
  return new Stripe(key, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * All signing secrets the subscription webhook should try, in order — the same
 * endpoint URL is registered on both platform accounts during the migration.
 * Returns [secret, account] pairs so the handler knows which account verified.
 */
export function getSubscriptionWebhookSecretCandidates(
  mode: "test" | "live"
): Array<{ secret: string; account: SubscriptionAccount }> {
  const out: Array<{ secret: string; account: SubscriptionAccount }> = [];
  const uk = getSubscriptionWebhookSecret(mode);
  if (uk) out.push({ secret: uk, account: "uk" });
  const uae = Deno.env.get(
    mode === "live"
      ? "STRIPE_UAE_SUBSCRIPTION_LIVE_WEBHOOK_SECRET"
      : "STRIPE_UAE_SUBSCRIPTION_TEST_WEBHOOK_SECRET"
  );
  if (uae) out.push({ secret: uae, account: "uae" });
  return out;
}
