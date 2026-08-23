// end-test-subscription — end a TEST-MODE subscription so the flow can be
// re-tested from the top.
//
// Why this exists: once a tenant is subscribed, generating a subscription link
// is (correctly) refused — a second live subscription is physically
// unrepresentable. So there was no way to rehearse the sales flow twice against
// the same tenant without hand-editing the database, which would put our row and
// Stripe's out of step and make the next test meaningless.
//
// This cancels at STRIPE and then lets customer.subscription.deleted arrive
// through the normal webhook, so the end state is produced by exactly the same
// path a real cancellation takes. Nothing is faked.
//
// THREE GUARDS, and the middle one is the important one:
//   1. super admin only;
//   2. the tenant's subscription_stripe_mode must be 'test' — a LIVE tenant is
//      refused outright, so this can never end a paying operator's billing;
//   3. it acts only on the subscription id recorded for that tenant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: userError } =
      await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: appUser } = await supabase
      .from("app_users").select("id, is_active, is_super_admin")
      .eq("auth_user_id", user.id).maybeSingle();
    if (!appUser?.is_active || appUser?.is_super_admin !== true) {
      return errorResponse("Only super admins can end a test subscription", 403);
    }

    const { tenantId } = await req.json().catch(() => ({}));
    if (!tenantId) return errorResponse("tenantId is required", 400);

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    if (mode !== "test") {
      // The whole safety of this endpoint rests here. Refuse loudly.
      return jsonResponse({
        error: "This tenant bills in LIVE mode. Ending a live subscription is not something this endpoint will do.",
        code: "live_mode_refused",
      }, 403);
    }

    const { data: sub } = await supabase
      .from("tenant_subscriptions")
      .select("id, stripe_subscription_id, status")
      .eq("tenant_id", tenantId)
      .not("status", "in", "(canceled,incomplete_expired)")
      .maybeSingle();

    if (!sub?.stripe_subscription_id) {
      return jsonResponse({ error: "This tenant has no live subscription to end.", code: "no_live_subscription" }, 409);
    }

    const account = await getTenantSubscriptionAccount(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    let stripeStatus: string | null = null;
    try {
      const cancelled = await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      stripeStatus = cancelled.status;
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      // Already gone at Stripe: fall through so our row can still be squared up.
      if (!/No such subscription|resource_missing/i.test(msg)) {
        return errorResponse(`Stripe refused the cancellation: ${msg}`, 502);
      }
      stripeStatus = "already_gone";
    }

    // customer.subscription.deleted will do this too; doing it here as well
    // means the admin screen is correct immediately rather than after the
    // webhook round-trip. The webhook write is idempotent.
    await supabase
      .from("tenant_subscriptions")
      .update({ status: "canceled", canceled_at: new Date().toISOString(), ended_at: new Date().toISOString() })
      .eq("id", sub.id);

    await supabase.from("audit_logs").insert({
      action: "subscription_test_ended",
      tenant_id: tenantId,
      entity_type: "tenant_subscription",
      entity_id: sub.id,
      actor_id: appUser.id,
      is_super_admin_action: true,
      details: { stripe_subscription_id: sub.stripe_subscription_id, previous_status: sub.status, mode, account },
    });

    return jsonResponse({
      success: true,
      stripeStatus,
      subscriptionId: sub.stripe_subscription_id,
      message: "Test subscription ended. You can generate a new subscription link for this tenant now.",
    });
  } catch (err) {
    console.error("[end-test-subscription] failed:", err);
    return errorResponse((err as { message?: string })?.message ?? "Failed", 500);
  }
});
