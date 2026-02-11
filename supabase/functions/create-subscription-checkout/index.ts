import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function getSubscriptionStripe() {
  const key = Deno.env.get("STRIPE_SUBSCRIPTION_SECRET_KEY");
  if (!key) throw new Error("Missing STRIPE_SUBSCRIPTION_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const { tenantId, successUrl, cancelUrl } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");
    if (!successUrl) return errorResponse("successUrl is required");
    if (!cancelUrl) return errorResponse("cancelUrl is required");

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, company_name, contact_email, stripe_subscription_customer_id, subscription_plan")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) return errorResponse("Tenant not found", 404);

    const { data: existingSub } = await supabase
      .from("tenant_subscriptions")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (existingSub) {
      return errorResponse("Tenant already has an active subscription", 409);
    }

    const stripe = getSubscriptionStripe();
    const priceId = Deno.env.get("STRIPE_SUBSCRIPTION_PRICE_ID");
    if (!priceId) return errorResponse("Subscription price not configured", 500);

    let stripeCustomerId = tenant.stripe_subscription_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: tenant.contact_email,
        name: tenant.company_name,
        metadata: { tenant_id: tenantId, source: "platform_subscription" },
      });
      stripeCustomerId = customer.id;

      await supabase
        .from("tenants")
        .update({ stripe_subscription_customer_id: customer.id })
        .eq("id", tenantId);

      console.log(`Created Stripe customer ${customer.id} for tenant ${tenantId}`);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tenant_id: tenantId, source: "platform_subscription" },
      subscription_data: { metadata: { tenant_id: tenantId } },
    });

    console.log(`Created subscription checkout session ${session.id} for tenant ${tenantId}`);

    return jsonResponse({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("Error creating subscription checkout:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
