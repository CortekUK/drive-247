import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { CREDIT_CONFIG } from "../_shared/credit-config.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization", 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the user
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const { credits, tenantId, successUrl, cancelUrl } = await req.json();
    if (!credits || !tenantId)
      return errorResponse("credits and tenantId are required");

    const creditAmount = parseInt(credits, 10);
    if (isNaN(creditAmount) || creditAmount < 1 || creditAmount > 10000)
      return errorResponse("credits must be between 1 and 10,000");

    const priceCents = Math.round(creditAmount * CREDIT_CONFIG.CREDIT_PRICE_USD * 100); // $0.20/credit

    // Get tenant's Stripe mode + platform account (UK legacy vs UAE).
    // Credits are platform billing — same account as subscriptions.
    const mode = await getSubscriptionStripeMode(supabaseAdmin, tenantId);
    const account = await getTenantSubscriptionAccount(supabaseAdmin, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("stripe_subscription_customer_id, company_name")
      .eq("id", tenantId)
      .single();
    // Was previously selecting a non-existent column ("name"), which errored
    // silently → tenant null → a brand-new Stripe customer created and
    // stripe_subscription_customer_id overwritten on EVERY purchase, severing
    // invoice→tenant resolution in the subscription webhook.
    if (tenantErr || !tenant) {
      return errorResponse(`Tenant not found: ${tenantErr?.message ?? tenantId}`, 404);
    }

    // Create or reuse Stripe customer. Customer IDs are account-specific:
    // tenants.stripe_subscription_customer_id was originally created on the UK
    // account, so for a migrated ('uae') tenant — or after a test→live mode
    // switch — the stored ID may not exist on the target account. Verify it
    // and create a fresh customer if not (same pattern as
    // create-subscription-checkout).
    let customerId = tenant?.stripe_subscription_customer_id;
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if ((existing as { deleted?: boolean }).deleted) customerId = null;
      } catch (_e) {
        console.log(
          `Stored customer ${customerId} not found on ${account}/${mode} Stripe account, creating new one`
        );
        customerId = null;
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: tenant?.company_name || undefined,
        metadata: { tenant_id: tenantId },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("tenants")
        .update({ stripe_subscription_customer_id: customerId })
        .eq("id", tenantId);
    }

    // Create a one-time Stripe Price for this amount
    const price = await stripe.prices.create({
      unit_amount: priceCents,
      currency: "usd",
      product_data: {
        name: `Drive247 Credits (${creditAmount})`,
      },
    });

    // Create checkout session (one-time payment)
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        type: "credit_purchase",
        tenant_id: tenantId,
        package_name: `${creditAmount} Credits`,
        credits: String(creditAmount),
        platform_account: account,
      },
      success_url:
        successUrl || `${req.headers.get("origin")}/credits?status=success`,
      cancel_url:
        cancelUrl || `${req.headers.get("origin")}/credits?status=cancelled`,
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: {
          type: "credit_purchase",
          tenant_id: tenantId,
          platform_account: account,
        },
      },
    });

    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error("create-credit-checkout error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
