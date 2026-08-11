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

  // ── Which Stripe test card to mint. ───────────────────────────────────────
  // The chain's RECOVERY path — a card that stops working partway through a
  // long rental and later starts working again — is the half of this system
  // that only ever runs when something has gone wrong, and it cannot be
  // exercised at all with a card that always succeeds.
  //
  // Allow-list only: these are Stripe's own documented test tokens, they exist
  // solely in test mode, and the tenant guard above already refuses to run
  // outside it. An arbitrary caller-supplied string could name a real saved
  // payment method.
  // NOTE ON WHICH DECLINE TOKEN: `pm_card_chargeDeclined` (4000...0002) is
  // rejected by Stripe at ATTACH time, so it cannot represent a card that
  // worked when the rental started and stopped working mid-chain — which is the
  // only decline shape this system actually has to survive. `chargeCustomerFail`
  // (4000...0341) attaches cleanly and then fails every off-session charge,
  // which is exactly a reissued/frozen card. `swap` mode therefore needs THAT
  // one; the attach-time declines are kept only for testing initial placement.
  const TEST_CARDS: Record<string, string> = {
    visa: "pm_card_visa",                                // always succeeds
    declined: "pm_card_chargeCustomerFail",              // attaches, then declines off-session
    declined_at_attach: "pm_card_chargeDeclined",        // fails immediately on attach
    insufficient: "pm_card_chargeDeclinedInsufficientFunds",
    expired: "pm_card_chargeDeclinedExpiredCard",
    auth_required: "pm_card_authenticationRequired",     // SCA
  };
  const cardKey = typeof body?.card === "string" ? body.card : "visa";
  const paymentMethodToken = TEST_CARDS[cardKey];
  if (!paymentMethodToken) {
    return json({
      success: false,
      error: `sandbox: unknown card '${cardKey}'. Allowed: ${Object.keys(TEST_CARDS).join(", ")}`,
    }, 400);
  }

  // Attach a (possibly different) card to an EXISTING customer and make it the
  // default, instead of minting a whole new fixture. This is how a mid-chain
  // card change is simulated: the rental keeps its hold and its history, and
  // only the card behind it changes — exactly what happens when a renter's card
  // is reissued, expires, or starts declining.
  const swapCustomerId = typeof body?.swap_customer_id === "string" ? body.swap_customer_id.trim() : "";

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

    // ── SWAP MODE: change the card behind an existing customer. ──────────────
    // Used to simulate a card going bad (and later coming good) partway through
    // a chain. resolvePaymentMethod in the refresh engine reads
    // invoice_settings.default_payment_method FIRST, so setting it here is what
    // makes the next link pick the new card up.
    if (swapCustomerId) {
      const swapped = await stripe.paymentMethods.attach(
        paymentMethodToken,
        { customer: swapCustomerId },
        opts,
      );
      await stripe.customers.update(
        swapCustomerId,
        { invoice_settings: { default_payment_method: swapped.id } },
        opts,
      );
      return json({
        success: true,
        swapped: true,
        platformAccount,
        connectAccountId,
        customerId: swapCustomerId,
        card: cardKey,
        paymentMethodId: swapped.id,
      });
    }

    // 1. Test customer on the SAME account the charge paths target.
    const customer = await stripe.customers.create({
      email: "sandbox-fixture@drive247.test",
      name: "Sandbox Fixture (Time Machine)",
      metadata: { purpose: "drive247_time_machine_fixture", tenant_id: SANDBOX_TENANT },
    }, opts);

    // 2. Attach the chosen test card and make it the customer default, so the
    //    refresh engine's resolvePaymentMethod finds it first.
    const pm = await stripe.paymentMethods.attach(paymentMethodToken, { customer: customer.id }, opts);
    await stripe.customers.update(
      customer.id,
      { invoice_settings: { default_payment_method: pm.id } },
      opts,
    );

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
