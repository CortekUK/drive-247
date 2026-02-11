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

    const { tenantId, returnUrl } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");
    if (!returnUrl) return errorResponse("returnUrl is required");

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("stripe_subscription_customer_id")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant?.stripe_subscription_customer_id) {
      return errorResponse("No subscription customer found for this tenant", 404);
    }

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    const stripe = getSubscriptionStripeClient(mode);

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_subscription_customer_id,
      return_url: returnUrl,
    });

    console.log(`Created billing portal session for tenant ${tenantId} (mode: ${mode})`);

    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error("Error creating portal session:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
