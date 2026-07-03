import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
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
    const account = await getTenantSubscriptionAccount(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    // The stored customer id may belong to the other platform account (e.g.
    // right after a uk→uae migration). Verify it, and fall back to the active
    // subscription row's customer id if the stored one isn't on this account.
    let customerId = tenant.stripe_subscription_customer_id;
    try {
      await stripe.customers.retrieve(customerId);
    } catch (_e) {
      const { data: activeSub } = await supabase
        .from("tenant_subscriptions")
        .select("stripe_customer_id")
        .eq("tenant_id", tenantId)
        .in("status", ["active", "trialing", "past_due"])
        .maybeSingle();
      if (activeSub?.stripe_customer_id && activeSub.stripe_customer_id !== customerId) {
        customerId = activeSub.stripe_customer_id;
      } else {
        return errorResponse("No subscription customer found on the billing account", 404);
      }
    }

    // Create a portal configuration that only allows payment method updates
    // Cancellation is handled via support email, not self-service
    const configuration = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: "Manage your payment method",
      },
      features: {
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
        invoice_history: { enabled: true },
      },
    });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      configuration: configuration.id,
    });

    console.log(`Created billing portal session for tenant ${tenantId} (account: ${account}, mode: ${mode})`);

    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error("Error creating portal session:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
