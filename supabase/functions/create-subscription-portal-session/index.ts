import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { authorizeTenantAccess } from "../_shared/tenant-auth.ts";

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

    // The caller must belong to this tenant. Authenticating the JWT alone is not
    // enough — see _shared/tenant-auth.ts.
    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("stripe_subscription_customer_id")
      .eq("id", tenantId)
      .single();

    if (tenantError) {
      return errorResponse("Could not load tenant", 500);
    }

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    const account = await getTenantSubscriptionAccount(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    // WHICH CUSTOMER OWES US? The live subscription row is authoritative, and
    // the tenants column is only a hint.
    //
    // This used to read the tenants column and fall back to the subscription
    // ONLY when stripe.customers.retrieve THREW. That fallback cannot fire for
    // the case that actually occurs: a stale id that is a perfectly valid
    // customer on the same account, just not the one holding the subscription.
    // Six tenants are in exactly that state, one of them past_due — so
    // "Update Payment Method" opened a billing portal for a customer with no
    // subscription. The tenant saved a good card, was told it worked, and the
    // next dunning retry still failed on the old card. Silent, and it ends in a
    // hard paywall over a card they believe they fixed.
    const { data: liveSub } = await supabase
      .from("tenant_subscriptions")
      .select("stripe_customer_id")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    let customerId: string | null = liveSub?.stripe_customer_id || null;
    let source = "subscription";

    if (!customerId) {
      customerId = tenant?.stripe_subscription_customer_id || null;
      source = "tenant";
    }
    if (!customerId) {
      return errorResponse("No subscription customer found for this tenant", 404);
    }

    // Still verify it exists on THIS account — a pre-migration id would 404 at
    // Stripe and surface as an opaque 500.
    try {
      const c = await stripe.customers.retrieve(customerId);
      if ((c as any)?.deleted) throw new Error("customer deleted");
    } catch (_e) {
      const alternate =
        source === "subscription" ? tenant?.stripe_subscription_customer_id : liveSub?.stripe_customer_id;
      if (!alternate || alternate === customerId) {
        return errorResponse("No subscription customer found on the billing account", 404);
      }
      try {
        await stripe.customers.retrieve(alternate);
        customerId = alternate;
        source = source === "subscription" ? "tenant" : "subscription";
      } catch (_e2) {
        return errorResponse("No subscription customer found on the billing account", 404);
      }
    }

    // Self-heal the hint so every other customer-id lookup agrees from now on.
    if (source === "subscription" && tenant?.stripe_subscription_customer_id !== customerId) {
      await supabase
        .from("tenants")
        .update({ stripe_subscription_customer_id: customerId })
        .eq("id", tenantId);
      console.log(`Repaired tenants.stripe_subscription_customer_id for ${tenantId} -> ${customerId}`);
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
