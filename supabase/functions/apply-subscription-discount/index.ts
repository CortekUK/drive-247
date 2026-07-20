import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// apply-subscription-discount
// ---------------------------
// Super-admin action to give a tenant a ONE-TIME discount on their NEXT platform
// subscription invoice, WITHOUT changing their plan. Implemented as a Stripe coupon
// with duration:'once' attached to the subscription — Stripe applies it to exactly the
// next invoice and then drops it, so billing auto-reverts to the normal amount. No cron,
// no plan change, no manual cleanup.
//   action 'get'    -> returns the subscription's current discount (source of truth = Stripe)
//   action 'apply'  -> { discountType:'percent'|'amount', value } creates the coupon + attaches it
//   action 'remove' -> deletes the pending discount from the subscription

async function verifySuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("app_users")
    .select("is_super_admin")
    .eq("auth_user_id", userId);
  return Array.isArray(data) && data.some((u: any) => u.is_super_admin === true);
}

function summarizeDiscount(discount: any) {
  if (!discount || !discount.coupon) return null;
  const c = discount.coupon;
  return {
    percentOff: c.percent_off ?? null,
    amountOff: c.amount_off != null ? c.amount_off / 100 : null,
    currency: c.currency ?? null,
    duration: c.duration ?? null,
    name: c.name ?? null,
  };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const isSuperAdmin = await verifySuperAdmin(supabase, user.id);
    if (!isSuperAdmin) return errorResponse("Only super admins can adjust subscription discounts", 403);

    const { tenantId, action, discountType, value } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");

    const { data: subscription } = await supabase
      .from("tenant_subscriptions")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (!subscription?.stripe_subscription_id) {
      return errorResponse("This tenant has no active subscription to discount", 404);
    }

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    // Bill on the account recorded on the row; fall back to the tenant's configured account.
    const account = subscription.stripe_account === "uae"
      ? "uae"
      : subscription.stripe_account === "uk"
        ? "uk"
        : await getTenantSubscriptionAccount(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);
    const subId = subscription.stripe_subscription_id;

    if (action === "get") {
      const sub = await stripe.subscriptions.retrieve(subId);
      return jsonResponse({ discount: summarizeDiscount(sub.discount) });
    }

    if (action === "remove") {
      try {
        await stripe.subscriptions.deleteDiscount(subId);
      } catch (_e) {
        // No discount to remove — treat as success (idempotent).
      }
      return jsonResponse({ success: true, discount: null });
    }

    if (action === "apply") {
      const type = discountType === "amount" ? "amount" : "percent";
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return errorResponse("A positive discount value is required");
      }

      let coupon;
      if (type === "percent") {
        if (num > 100) return errorResponse("Percentage cannot exceed 100");
        coupon = await stripe.coupons.create({
          percent_off: num,
          duration: "once",
          max_redemptions: 1,
          name: `One-time ${num}% off`,
        });
      } else {
        const cur = (subscription.currency || "usd").toLowerCase();
        coupon = await stripe.coupons.create({
          amount_off: Math.round(num * 100),
          currency: cur,
          duration: "once",
          max_redemptions: 1,
          name: `One-time ${num} ${cur.toUpperCase()} off`,
        });
      }

      // Attaching a duration:'once' coupon discounts ONLY the next invoice.
      let updated;
      try {
        updated = await stripe.subscriptions.update(subId, { coupon: coupon.id });
      } catch (attachErr) {
        // Don't leave an orphaned coupon behind if the attach fails.
        try { await stripe.coupons.del(coupon.id); } catch { /* best effort */ }
        throw attachErr;
      }
      return jsonResponse({ success: true, discount: summarizeDiscount(updated.discount) });
    }

    return errorResponse("Unknown action");
  } catch (error) {
    console.error("apply-subscription-discount error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
