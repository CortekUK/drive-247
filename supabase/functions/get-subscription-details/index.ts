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

    const { tenantId } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");

    const { data: subscription, error: subError } = await supabase
      .from("tenant_subscriptions")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (!subscription) {
      return jsonResponse({ subscription: null, stripeSubscription: null });
    }

    let stripeSubscription = null;
    try {
      const stripe = getSubscriptionStripe();
      stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id,
        { expand: ["default_payment_method", "latest_invoice"] }
      );
    } catch (err) {
      console.error("Error fetching from Stripe:", err.message);
    }

    return jsonResponse({ subscription, stripeSubscription });
  } catch (error) {
    console.error("Error getting subscription details:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
