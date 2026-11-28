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

    const { tenantId } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");

    // Membership check — a valid JWT is not authorisation to read this tenant's
    // billing. See _shared/tenant-auth.ts.
    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

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
    let nextInvoice: { amount_due: number; currency: string; next_payment_attempt: number | null } | null = null;
    try {
      const mode = await getSubscriptionStripeMode(supabase, tenantId);
      // The Stripe subscription lives on the account recorded on the row
      // (rows created before the UAE migration default to 'uk'); fall back
      // to the tenant's configured subscription account.
      const account = subscription.stripe_account === "uae"
        ? "uae"
        : subscription.stripe_account === "uk"
          ? "uk"
          : await getTenantSubscriptionAccount(supabase, tenantId);
      const stripe = getSubscriptionStripeClientForAccount(account, mode);
      stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id,
        { expand: ["default_payment_method", "latest_invoice"] }
      );
      // The next bill as Stripe will charge it, discounts included. The row's
      // `amount` is the list price, so the trial banner said $129 for a BF30
      // signup whose first charge is $90.30 (feat-001 review 1).
      try {
        const upcoming = await stripe.invoices.retrieveUpcoming({
          subscription: subscription.stripe_subscription_id,
        });
        nextInvoice = {
          amount_due: upcoming.amount_due,
          currency: upcoming.currency,
          next_payment_attempt: upcoming.next_payment_attempt,
        };
      } catch (err) {
        console.warn("No upcoming invoice:", err.message);
      }
    } catch (err) {
      console.error("Error fetching from Stripe:", err.message);
    }

    return jsonResponse({ subscription, stripeSubscription, nextInvoice });
  } catch (error) {
    console.error("Error getting subscription details:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
