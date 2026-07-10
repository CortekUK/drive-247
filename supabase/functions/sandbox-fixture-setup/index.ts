import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getChargePlatformAccount,
  getStripeClientForAccount,
  getConnectAccountId,
  type StripeMode,
} from "../_shared/stripe-client.ts";

/**
 * SANDBOX fixture setup — Dev Panel "Time Machine" ONLY.
 *
 * Mints the Stripe TEST objects the money fixtures need (customer, saved card,
 * requires_capture deposit hold) **on the exact account the charge paths use**,
 * by resolving the tenant's Stripe context with the SAME _shared helpers as
 * process-installment-payment / auto-extend-rentals / refresh-deposit-holds.
 * This removes all guessing about platform (uk/uae) + shared Connect routing.
 *
 * Guards: only operates on the SANDBOX_TEST_TENANT_ID tenant, and refuses
 * unless that tenant is in Stripe TEST mode. Creates test objects only.
 */

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const SANDBOX_TENANT = Deno.env.get("SANDBOX_TEST_TENANT_ID") || null;
  if (!SANDBOX_TENANT) {
    return json({ success: false, error: "sandbox: SANDBOX_TEST_TENANT_ID is not configured" }, 412);
  }

  let body: any = null;
  try { body = await req.json(); } catch { /* defaults below */ }
  const depositAmount = Number(body?.deposit_amount) > 0 ? Math.round(Number(body.deposit_amount) * 100) : 10000;

  try {
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("id, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
      .eq("id", SANDBOX_TENANT)
      .single();
    if (tErr || !tenant) throw new Error(`tenant lookup failed: ${tErr?.message}`);
    if (tenant.stripe_mode !== "test") {
      return json({ success: false, error: "sandbox: designated tenant is not in Stripe test mode" }, 412);
    }

    const mode: StripeMode = "test";
    const platformAccount = getChargePlatformAccount(tenant as any);
    const stripe = getStripeClientForAccount(platformAccount, mode);
    const connectAccountId = getConnectAccountId(tenant as any);
    const opts = connectAccountId ? { stripeAccount: connectAccountId } : undefined;
    const currency = (tenant.currency_code || "USD").toLowerCase();

    // 1. Test customer on the SAME account the charge paths target.
    const customer = await stripe.customers.create({
      email: "sandbox-fixture@drive247.test",
      name: "Sandbox Fixture (Time Machine)",
      metadata: { purpose: "drive247_time_machine_fixture", tenant_id: SANDBOX_TENANT },
    }, opts);

    // 2. Attach the always-succeeds test card.
    const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id }, opts);

    // 3. A real requires_capture deposit hold.
    const pi = await stripe.paymentIntents.create({
      amount: depositAmount,
      currency,
      capture_method: "manual",
      customer: customer.id,
      payment_method: pm.id,
      off_session: true,
      confirm: true,
      description: "Sandbox deposit-hold fixture (Time Machine)",
      metadata: { purpose: "drive247_time_machine_fixture", tenant_id: SANDBOX_TENANT },
    }, opts);

    return json({
      success: true,
      platformAccount,
      connectAccountId,
      currency,
      customerId: customer.id,
      paymentMethodId: pm.id,
      depositPaymentIntentId: pi.id,
      depositPaymentIntentStatus: pi.status,
    });
  } catch (error: any) {
    console.error("[SandboxFixtureSetup] error:", error);
    return json({ success: false, error: error?.message ?? String(error) }, 500);
  }
});
