import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getSubscriptionStripeMode,
  getSubscriptionStripeClient,
} from "../_shared/subscription-stripe.ts";

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

    const { tenantId, planId, successUrl, cancelUrl } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");
    if (!planId) return errorResponse("planId is required");
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

    // Look up the plan from DB
    const { data: plan, error: planError } = await supabase
      .from("subscription_plans")
      .select("id, name, stripe_price_id, tenant_id, is_active, trial_days")
      .eq("id", planId)
      .single();

    if (planError || !plan) return errorResponse("Plan not found", 404);
    if (plan.tenant_id !== tenantId) return errorResponse("Plan does not belong to this tenant", 403);
    if (!plan.is_active) return errorResponse("Plan is no longer active", 400);
    if (!plan.stripe_price_id) return errorResponse("Plan has no Stripe price configured", 500);

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    const stripe = getSubscriptionStripeClient(mode);
    const priceId = plan.stripe_price_id;

    let stripeCustomerId = tenant.stripe_subscription_customer_id;

    // Verify the stored customer exists on the current Stripe account (handles test→live mode switch)
    if (stripeCustomerId) {
      try {
        await stripe.customers.retrieve(stripeCustomerId);
      } catch (_e) {
        console.log(`Stored customer ${stripeCustomerId} not found on ${mode} Stripe account, creating new one`);
        stripeCustomerId = null;
      }
    }

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

      console.log(`Created Stripe customer ${customer.id} for tenant ${tenantId} (mode: ${mode})`);
    }

    // Always enforce a minimum 2-day (48h) trial so the card is captured
    // but no charge happens until 48 hours after setup, as promised in the UI.
    // If the plan has a longer trial configured, use that instead.
    const trialDays = Math.max(2, plan.trial_days || 0);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tenant_id: tenantId, plan_id: planId, plan_name: plan.name, source: "platform_subscription" },
      subscription_data: {
        metadata: { tenant_id: tenantId, plan_id: planId, plan_name: plan.name },
        trial_period_days: trialDays,
      },
    });

    console.log(`Created subscription checkout session ${session.id} for tenant ${tenantId} (mode: ${mode})`);

    return jsonResponse({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("Error creating subscription checkout:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
