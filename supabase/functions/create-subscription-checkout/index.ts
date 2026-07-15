import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";

const STRIPE_PRODUCT_NAME = "Drive247 Platform Subscription";

async function getOrCreateProduct(stripe: Stripe): Promise<string> {
  const products = await stripe.products.search({
    query: `name:'${STRIPE_PRODUCT_NAME}' AND active:'true'`,
  });
  if (products.data.length > 0) return products.data[0].id;
  const product = await stripe.products.create({
    name: STRIPE_PRODUCT_NAME,
    description: "Monthly/yearly subscription for the Drive247 rental management platform",
  });
  return product.id;
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

    const { tenantId, planId, successUrl, cancelUrl } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");
    if (!planId) return errorResponse("planId is required");
    if (!successUrl) return errorResponse("successUrl is required");
    if (!cancelUrl) return errorResponse("cancelUrl is required");

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, company_name, contact_email, stripe_subscription_customer_id, subscription_plan, subscription_billing_anchor")
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
      .select("id, name, stripe_price_id, stripe_product_id, tenant_id, is_active, trial_days, amount, currency, interval, billing_model, stripe_account")
      .eq("id", planId)
      .single();

    if (planError || !plan) return errorResponse("Plan not found", 404);
    if (plan.tenant_id !== tenantId) return errorResponse("Plan does not belong to this tenant", 403);
    if (!plan.is_active) return errorResponse("Plan is no longer active", 400);
    if (!plan.stripe_price_id) return errorResponse("Plan has no Stripe price configured", 500);

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    const account = await getTenantSubscriptionAccount(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);
    let priceId = plan.stripe_price_id;

    // The plan's price must live on the tenant's subscription account. If the
    // plan row was created on the other platform account (e.g. tenant migrated
    // uk→uae after the plan was created), never reuse the foreign price id.
    const planAccount = plan.stripe_account === "uae" ? "uae" : "uk";
    let priceValid = planAccount === account;

    // Verify the price exists on the current Stripe account (handles test→live mode switch)
    if (priceValid) {
      try {
        await stripe.prices.retrieve(priceId);
      } catch (_e) {
        priceValid = false;
      }
    }

    if (!priceValid) {
      console.log(`Price ${priceId} not usable on ${account}/${mode} Stripe account, recreating`);
      const productId = await getOrCreateProduct(stripe);
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: plan.amount || 0,
        currency: (plan.currency || "usd").toLowerCase(),
        recurring: { interval: (plan.interval || "month") as "month" | "year" },
        metadata: { tenant_id: tenantId, plan_name: plan.name },
      });
      priceId = newPrice.id;
      await supabase
        .from("subscription_plans")
        .update({ stripe_price_id: newPrice.id, stripe_product_id: productId, stripe_account: account })
        .eq("id", planId);
      console.log(`Created new Stripe Price ${newPrice.id} on ${account}/${mode} account for plan ${planId}`);
    }

    // We intentionally do NOT bind a fixed `customer` to the Checkout session.
    // When Stripe Checkout is given a `customer`, it renders the email field
    // read-only, so tenants couldn't change/correct the billing email (e.g. use
    // a finance inbox instead of their login email). Passing `customer_email`
    // instead PREFILLS the address but keeps it editable. Stripe creates the
    // Customer only when checkout completes, and the subscription webhook
    // captures that real customer id (subscription.customer) into
    // tenants.stripe_subscription_customer_id — so no orphan customers are made
    // for abandoned sessions. This function only ever runs for never-subscribed
    // tenants (the active-subscription guard above returns 409 otherwise), so
    // there is never an existing customer to reuse here.

    // Determine how long until the first real charge.
    // - "trial": classic free trial of plan.trial_days days.
    // - "upfront_monthly" (new model): no free trial framing. Card is entered
    //   now; the first payment is taken EXACTLY one calendar month after the
    //   tenant went live. We still ride Stripe's trial primitive so nothing is
    //   charged for the plan until then, but the UI never calls it a trial.
    //
    // The anchor for that first charge is `tenants.subscription_billing_anchor`
    // (the go-live date, since month 1 was paid outside the platform). When it's
    // NULL we fall back to "today + 1 month" so nothing breaks for tenants that
    // never had an anchor set. We use Stripe's exact `trial_end` timestamp rather
    // than a rounded day count so the charge lands on the correct calendar day.
    const isUpfrontMonthly = plan.billing_model === "upfront_monthly";
    let trialDays = plan.trial_days || 0;
    let trialEndTs: number | null = null;
    if (isUpfrontMonthly) {
      const now = new Date();
      const anchor = tenant.subscription_billing_anchor
        ? new Date(`${tenant.subscription_billing_anchor}T00:00:00Z`)
        : now;
      const firstCharge = new Date(anchor);
      firstCharge.setUTCMonth(firstCharge.getUTCMonth() + 1); // same day, next month
      // If the anchored first-charge date is already in the past (card entered
      // late), Stripe can't set a past trial_end — charge on the next monthly
      // cycle instead of billing for elapsed months up front.
      while (firstCharge.getTime() <= now.getTime() + 60_000) {
        firstCharge.setUTCMonth(firstCharge.getUTCMonth() + 1);
      }
      trialEndTs = Math.floor(firstCharge.getTime() / 1000);
      console.log(
        `Upfront billing: anchor=${tenant.subscription_billing_anchor ?? "(none/today)"}, first charge ${firstCharge.toISOString()}`,
      );
    }

    // Build line items: fixed plan price + optional metered e-sign price + $1 card verification
    const lineItems: Array<any> = [
      { price: priceId, quantity: 1 },
    ];
    // Metered price ids are account-specific: never attach the UK price id to a
    // UAE checkout (it doesn't exist on that account and the session would fail).
    const meteredPriceId = account === "uae"
      ? (mode === "live"
          ? Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_LIVE")
          : Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_TEST"))
      : (mode === "live"
          ? Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_LIVE")
          : (Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_TEST") || Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID")));
    if (meteredPriceId) {
      lineItems.push({ price: meteredPriceId }); // no quantity for metered
    }

    // Add a one-time $1 card verification fee ONLY when the plan's first real charge
    // is deferred (a free trial or upfront_monthly). Stripe bills one-time items
    // immediately even during a trial, so this validates the card while $0 of the plan
    // is due today (some banks reject the $0 auth on trial subs). It is auto-refunded by
    // the subscription webhook on checkout.session.completed.
    //
    // For a charge-now plan (no trial, not upfront) the full plan amount is billed today,
    // which already validates the card — so we must NOT add the $1. If we did, it would
    // ride the SAME first-invoice payment_intent as the plan charge, and the webhook's
    // setup-fee refund would return the whole invoice (plan + $1) → $0 collected. Mirrors
    // create-uae-subscription-capture's `hasTrial` gating.
    const chargesDeferredToday = !!trialEndTs || trialDays > 0;
    if (chargesDeferredToday) {
      lineItems.push({
        price_data: {
          currency: (plan.currency || "usd").toLowerCase(),
          product_data: { name: "Card verification (refunded automatically)" },
          unit_amount: 100, // $1.00
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Prefilled but EDITABLE email (see note above). Do not switch this back
      // to `customer:` — that locks the email field in Stripe Checkout.
      customer_email: tenant.contact_email,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // setup_fee flags the webhook to auto-refund the $1 verification. Only set it
      // when the $1 was actually added (deferred-charge plans); a charge-now plan has
      // no $1 to refund and must keep its full first-period charge.
      metadata: { tenant_id: tenantId, plan_id: planId, plan_name: plan.name, source: "platform_subscription", ...(chargesDeferredToday ? { setup_fee: "true" } : {}) },
      subscription_data: {
        metadata: { tenant_id: tenantId, plan_id: planId, plan_name: plan.name, billing_model: plan.billing_model || "trial" },
        // Exact anchored date for upfront_monthly; a positive rounded day count for a
        // real free trial. A 0-day "trial" plan (trial_days=0, not upfront) must send
        // NEITHER key: Stripe rejects trial_period_days:0 (minimum is 1) with a 400 that
        // previously surfaced as a generic "non-2xx" and blocked checkout entirely.
        // Omitting both starts the subscription and charges the first period immediately
        // on completion — the $1 card-verification line item still validates the card.
        ...(trialEndTs
          ? { trial_end: trialEndTs }
          : trialDays > 0
            ? { trial_period_days: trialDays }
            : {}),
      },
    });

    console.log(`Created subscription checkout session ${session.id} for tenant ${tenantId} (account: ${account}, mode: ${mode})`);

    return jsonResponse({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("Error creating subscription checkout:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
