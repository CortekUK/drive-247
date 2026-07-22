// Super-admin-only: start a UK→UAE subscription migration for one tenant.
//
// Creates a Stripe Checkout session (mode: subscription) on the UAE platform
// account for the given plan. If the tenant has an active UK subscription, the
// UAE subscription starts with trial_end = the UK subscription's
// current_period_end, so the first UAE charge lands exactly when the already-
// paid UK period ends — zero double-billing. If the UK period end is less than
// 48 hours away (Stripe Checkout's minimum trial_end) or the tenant has no
// active UK subscription, UAE billing starts immediately with no trial.
//
// Nothing is stored prematurely: the subscription-webhook (on
// checkout.session.completed with metadata.migration === 'uae-capture') flips
// tenants.subscription_account to 'uae' and sets the old UK subscription to
// cancel_at_period_end.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getSubscriptionStripeMode,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";

const STRIPE_PRODUCT_NAME = "Drive247 Platform Subscription";

// Stripe Checkout requires subscription_data.trial_end to be at least 48 hours
// in the future.
const MIN_TRIAL_END_MS = 48 * 60 * 60 * 1000;

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

async function verifySuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("app_users")
    .select("is_super_admin")
    .eq("auth_user_id", userId)
    .single();

  return data?.is_super_admin === true;
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

    const body = await req.json();
    const { successUrl, cancelUrl } = body;
    let { tenantId, planId } = body;

    // Authorization: a super admin may act for any tenant; a tenant's own
    // head_admin/admin may act ONLY for their own tenant (this is what lets the
    // operator self-serve "Confirm payment details" from the migration prompt).
    const isSuperAdmin = await verifySuperAdmin(supabase, user.id);
    if (!isSuperAdmin) {
      const { data: appUser } = await supabase
        .from("app_users")
        .select("tenant_id, role")
        .eq("auth_user_id", user.id)
        .single();
      const canSelfServe =
        appUser?.tenant_id &&
        (appUser.role === "head_admin" || appUser.role === "admin") &&
        (!tenantId || tenantId === appUser.tenant_id);
      if (!canSelfServe) {
        return errorResponse("Not authorized to start a subscription migration for this tenant", 403);
      }
      // Never trust a caller-supplied tenantId for a non-super-admin.
      tenantId = appUser.tenant_id;
    }

    if (!tenantId) return errorResponse("tenantId is required");

    // Auto-mirror: when no plan is given (operator self-serve), reuse the plan
    // the tenant is already on so their price never changes during migration.
    if (!planId) {
      const { data: activeSub } = await supabase
        .from("tenant_subscriptions")
        .select("plan_id")
        .eq("tenant_id", tenantId)
        .in("status", ["active", "trialing", "past_due"])
        .maybeSingle();
      planId = activeSub?.plan_id ?? null;

      if (!planId) {
        // No live subscription to mirror — fall back to the tenant's single
        // active configured plan, if unambiguous.
        const { data: plans } = await supabase
          .from("subscription_plans")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true);
        if (plans?.length === 1) planId = plans[0].id;
      }
      if (!planId) {
        return errorResponse(
          "Could not determine which plan to use for this tenant — a super admin must generate the link with an explicit plan.",
          400
        );
      }
    }

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, slug, company_name, contact_email, stripe_subscription_customer_id, subscription_account")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) return errorResponse("Tenant not found", 404);
    if (tenant.subscription_account === "uae") {
      return errorResponse("Tenant already bills on the UAE account", 409);
    }

    const { data: plan, error: planError } = await supabase
      .from("subscription_plans")
      .select("id, name, stripe_price_id, stripe_product_id, tenant_id, is_active, amount, currency, interval, billing_model, stripe_account")
      .eq("id", planId)
      .single();

    if (planError || !plan) return errorResponse("Plan not found", 404);
    if (plan.tenant_id !== tenantId) return errorResponse("Plan does not belong to this tenant", 403);
    if (!plan.is_active) return errorResponse("Plan is no longer active", 400);

    const mode = await getSubscriptionStripeMode(supabase, tenantId);

    // ------------------------------------------------------------------
    // 1. Find the tenant's current UK subscription and its live period end
    // ------------------------------------------------------------------
    const { data: ukSubRow } = await supabase
      .from("tenant_subscriptions")
      .select("id, stripe_subscription_id, stripe_account, status, current_period_end")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    let ukPeriodEndMs: number | null = null;
    if (ukSubRow?.stripe_subscription_id && ukSubRow.stripe_account !== "uae") {
      try {
        const ukStripe = getSubscriptionStripeClientForAccount("uk", mode);
        const ukSub = await ukStripe.subscriptions.retrieve(ukSubRow.stripe_subscription_id);
        if (["active", "trialing"].includes(ukSub.status) && ukSub.current_period_end) {
          ukPeriodEndMs = ukSub.current_period_end * 1000;
        }
      } catch (ukErr) {
        console.warn(`Could not retrieve UK subscription ${ukSubRow.stripe_subscription_id}, falling back to DB period end:`, ukErr.message);
        if (ukSubRow.current_period_end) {
          ukPeriodEndMs = new Date(ukSubRow.current_period_end).getTime();
        }
      }
    }

    // Trial only if the UK paid period ends far enough out for Stripe's
    // 48-hour trial_end minimum; otherwise start UAE billing immediately.
    const now = Date.now();
    const hasTrial = ukPeriodEndMs !== null && ukPeriodEndMs - now >= MIN_TRIAL_END_MS;
    const trialEndUnix = hasTrial ? Math.floor((ukPeriodEndMs as number) / 1000) : null;

    // ------------------------------------------------------------------
    // 2. Ensure the plan's price exists on the UAE account
    // ------------------------------------------------------------------
    const stripe = getSubscriptionStripeClientForAccount("uae", mode);

    let priceId = plan.stripe_price_id;
    let priceValid = plan.stripe_account === "uae" && !!priceId;
    if (priceValid) {
      try {
        await stripe.prices.retrieve(priceId);
      } catch (_e) {
        priceValid = false;
      }
    }

    if (!priceValid) {
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
        .update({ stripe_price_id: newPrice.id, stripe_product_id: productId, stripe_account: "uae" })
        .eq("id", planId);
      console.log(`Created UAE Stripe Price ${newPrice.id} (mode: ${mode}) for plan ${planId}`);
    }

    // ------------------------------------------------------------------
    // 3. Resolve/create the Stripe customer on the UAE account
    // ------------------------------------------------------------------
    let stripeCustomerId = tenant.stripe_subscription_customer_id;
    if (stripeCustomerId) {
      try {
        await stripe.customers.retrieve(stripeCustomerId);
      } catch (_e) {
        // Stored customer belongs to the UK account — create a fresh UAE one.
        stripeCustomerId = null;
      }
    }
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: tenant.contact_email,
        name: tenant.company_name,
        metadata: { tenant_id: tenantId, source: "platform_subscription", migration: "uae-capture" },
      });
      stripeCustomerId = customer.id;
      console.log(`Created UAE Stripe customer ${customer.id} for tenant ${tenantId} (mode: ${mode})`);
      // Not persisted here: the subscription webhook stores the final customer
      // id on checkout.session.completed.
    }

    // ------------------------------------------------------------------
    // 4. Create the UAE Checkout session
    // ------------------------------------------------------------------
    const lineItems: Array<any> = [{ price: priceId, quantity: 1 }];

    const meteredPriceId = mode === "live"
      ? Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_LIVE")
      : Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_TEST");
    if (meteredPriceId) {
      lineItems.push({ price: meteredPriceId }); // no quantity for metered
    }

    // When deferring the first charge to the UK period end, add the $1 card
    // verification item (charged immediately, auto-refunded by the webhook) so
    // the card is properly validated despite the deferred first invoice.
    if (hasTrial) {
      lineItems.push({
        price_data: {
          currency: (plan.currency || "usd").toLowerCase(),
          product_data: { name: "Card verification (refunded automatically)" },
          unit_amount: 100, // $1.00
        },
        quantity: 1,
      });
    }

    const portalBase = `https://${tenant.slug}.portal.drive-247.com`;
    const finalSuccessUrl = successUrl || `${portalBase}/subscription?status=success`;
    const finalCancelUrl = cancelUrl || `${portalBase}/subscription?status=canceled`;

    const sessionMetadata: Record<string, string> = {
      tenant_id: tenantId,
      plan_id: planId,
      plan_name: plan.name,
      source: "platform_subscription",
      migration: "uae-capture",
    };
    if (hasTrial) sessionMetadata.setup_fee = "true";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: lineItems,
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
      metadata: sessionMetadata,
      subscription_data: {
        metadata: {
          tenant_id: tenantId,
          plan_id: planId,
          plan_name: plan.name,
          billing_model: plan.billing_model || "trial",
          migration: "uae-capture",
        },
        ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
      },
    });

    const startsBillingAt = trialEndUnix
      ? new Date(trialEndUnix * 1000).toISOString()
      : new Date().toISOString();

    console.log(
      `Created UAE migration checkout session ${session.id} for tenant ${tenantId} ` +
      `(mode: ${mode}, first charge: ${startsBillingAt}${hasTrial ? "" : " — immediate, no UK period to honour"})`
    );

    return jsonResponse({ url: session.url, sessionId: session.id, startsBillingAt });
  } catch (error) {
    console.error("Error creating UAE subscription capture session:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
