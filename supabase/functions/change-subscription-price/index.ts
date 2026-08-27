import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// change-subscription-price
// -------------------------
// Super-admin action to move a tenant's LIVE subscription onto a different plan
// price — a renegotiated rate, an upgrade, a downgrade.
//
// This exists because `manage-subscription-plans` only rewrites the
// `subscription_plans` row and mints a new Stripe Price. It deliberately does
// not touch anyone already subscribed, so an existing subscriber kept billing
// the OLD price forever while the admin UI showed the new one. Editing the plan
// was silently a no-op for the only tenant it was being edited for.
//
//   action 'preview' -> what would change, without writing anything
//   action 'apply'   -> swaps the subscription item onto the plan's current price
//
// Deliberate choices:
//   - `proration_behavior: "none"`. A price change mid-cycle otherwise raises an
//     immediate proration invoice (upgrade) or credit (downgrade). Nobody asking
//     to "change their rate to X" means "and charge them a partial amount today";
//     the new rate simply takes effect at the next renewal.
//   - The billing cycle anchor is left alone, so the renewal date does not move.
//   - Only the PLAN item is swapped. Subscriptions also carry a metered e-sign
//     usage item (attached by subscription-webhook after checkout), and blindly
//     writing items.data[0] would eventually corrupt per-signature billing.

const LIVE_STATUSES = ["active", "trialing", "past_due"];

async function verifySuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("app_users")
    .select("is_super_admin, is_active")
    .eq("auth_user_id", userId);
  return (
    Array.isArray(data) &&
    data.some((u: any) => u.is_super_admin === true && u.is_active !== false)
  );
}

/**
 * The subscription item that carries the plan, never the metered usage item.
 *
 * Preference order: the item already on the plan's known price, then the item on
 * the price the DB records for this subscription, then the single non-metered
 * licensed item. If more than one licensed item survives that, we refuse rather
 * than guess — picking wrong would silently rewrite the wrong line.
 */
function findPlanItem(items: any[], candidatePriceIds: (string | null)[]) {
  for (const priceId of candidatePriceIds) {
    if (!priceId) continue;
    const match = items.find((i: any) => i.price?.id === priceId);
    if (match) return match;
  }
  const licensed = items.filter(
    (i: any) => i.price?.recurring?.usage_type !== "metered"
  );
  return licensed.length === 1 ? licensed[0] : null;
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
    if (!isSuperAdmin) {
      return errorResponse("Only super admins can change a subscription price", 403);
    }

    const { tenantId, planId, action = "apply" } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");
    if (!planId) return errorResponse("planId is required");

    const { data: subscription } = await supabase
      .from("tenant_subscriptions")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", LIVE_STATUSES)
      .maybeSingle();

    if (!subscription?.stripe_subscription_id) {
      return errorResponse("This tenant has no live subscription to reprice", 404);
    }

    const { data: plan } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("id", planId)
      .maybeSingle();

    if (!plan) return errorResponse("Plan not found", 404);
    if (plan.tenant_id !== tenantId) {
      return errorResponse("That plan belongs to a different tenant", 400);
    }
    if (!plan.stripe_price_id) {
      return errorResponse("That plan has no Stripe price to move onto", 400);
    }

    // Bill on the account recorded on the subscription row; fall back to the
    // tenant's configured account. Mirrors apply-subscription-discount.
    const account = subscription.stripe_account === "uae"
      ? "uae"
      : subscription.stripe_account === "uk"
        ? "uk"
        : await getTenantSubscriptionAccount(supabase, tenantId);

    // A Price only exists on the account that created it. Repricing onto a plan
    // minted on the OTHER platform account would fail deep inside Stripe with an
    // opaque "No such price" — say so up front instead.
    const planAccount = plan.stripe_account === "uae" ? "uae" : "uk";
    if (planAccount !== account) {
      return errorResponse(
        `That plan's price lives on the ${planAccount.toUpperCase()} Stripe account but this subscription bills on ${account.toUpperCase()}. Re-save the plan first so its price is minted on the right account.`,
        400
      );
    }

    // Stripe cannot change the currency of an existing subscription.
    const subCurrency = (subscription.currency || "usd").toLowerCase();
    const planCurrency = (plan.currency || "usd").toLowerCase();
    if (planCurrency !== subCurrency) {
      return errorResponse(
        `Stripe cannot switch a live subscription from ${subCurrency.toUpperCase()} to ${planCurrency.toUpperCase()}. Cancel and re-subscribe to change currency.`,
        400
      );
    }

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);
    const subId = subscription.stripe_subscription_id;

    const stripeSub = await stripe.subscriptions.retrieve(subId, {
      expand: ["items.data.price"],
    });

    const items = stripeSub.items?.data ?? [];
    const { data: currentPlanRow } = subscription.plan_id
      ? await supabase
          .from("subscription_plans")
          .select("stripe_price_id")
          .eq("id", subscription.plan_id)
          .maybeSingle()
      : { data: null };

    const planItem = findPlanItem(items, [
      plan.stripe_price_id,
      currentPlanRow?.stripe_price_id ?? null,
    ]);

    if (!planItem) {
      return errorResponse(
        "Could not identify which subscription line carries the plan — resolve it in the Stripe dashboard rather than risk rewriting the wrong line.",
        409
      );
    }

    const oldAmount = planItem.price?.unit_amount ?? subscription.amount ?? 0;
    const alreadyOnPrice = planItem.price?.id === plan.stripe_price_id;

    if (action === "preview") {
      return jsonResponse({
        success: true,
        alreadyOnPrice,
        subscriptionId: subId,
        account,
        mode,
        itemId: planItem.id,
        from: { priceId: planItem.price?.id ?? null, amount: oldAmount },
        to: { priceId: plan.stripe_price_id, amount: plan.amount },
        currency: subCurrency,
        interval: plan.interval,
        nextChargeAt: subscription.current_period_end,
        otherItems: items
          .filter((i: any) => i.id !== planItem.id)
          .map((i: any) => ({ id: i.id, priceId: i.price?.id, usageType: i.price?.recurring?.usage_type })),
      });
    }

    if (action !== "apply") return errorResponse("Unknown action");

    if (!alreadyOnPrice) {
      await stripe.subscriptions.update(subId, {
        items: [{ id: planItem.id, price: plan.stripe_price_id }],
        proration_behavior: "none",
        // Keep plan identity on the subscription itself. subscription-webhook
        // resolves plan_name/plan_id from this metadata first, so a stale value
        // here would have the next sync overwrite the row with the old plan.
        metadata: {
          ...(stripeSub.metadata ?? {}),
          tenant_id: tenantId,
          plan_id: plan.id,
          plan_name: plan.name,
        },
      });
    }

    // Write through rather than waiting on customer.subscription.updated. The
    // webhook is still the source of truth and will re-sync to the same values;
    // this just means the admin screen is not lying for the seconds in between.
    const { error: rowError } = await supabase
      .from("tenant_subscriptions")
      .update({
        amount: plan.amount,
        currency: planCurrency,
        interval: plan.interval,
        plan_id: plan.id,
        plan_name: plan.name,
        updated_at: new Date().toISOString(),
        last_sync_source: "price-change",
      })
      .eq("id", subscription.id);

    if (rowError) {
      console.error("Repriced on Stripe but failed to write local row:", rowError.message);
    }

    console.log(
      `Repriced subscription ${subId} (tenant ${tenantId}, ${account}/${mode}) ` +
      `from ${oldAmount} to ${plan.amount} ${planCurrency} on item ${planItem.id}`
    );

    return jsonResponse({
      success: true,
      alreadyOnPrice,
      subscriptionId: subId,
      from: { priceId: planItem.price?.id ?? null, amount: oldAmount },
      to: { priceId: plan.stripe_price_id, amount: plan.amount },
      currency: planCurrency,
      interval: plan.interval,
      nextChargeAt: subscription.current_period_end,
    });
  } catch (error) {
    console.error("change-subscription-price error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
