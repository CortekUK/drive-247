import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeClient,
  getSubscriptionStripeMode,
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

    // Get tenant's Stripe mode and customer ID
    const mode = await getSubscriptionStripeMode(supabaseAdmin, tenantId);
    const stripe = getSubscriptionStripeClient(mode);

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("stripe_subscription_customer_id, name")
      .eq("id", tenantId)
      .single();

    // Create or reuse Stripe customer
    let customerId = tenant?.stripe_subscription_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: tenant?.name || undefined,
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
        },
      },
    });

    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error("create-credit-checkout error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
