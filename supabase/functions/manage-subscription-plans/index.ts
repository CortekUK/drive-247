import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
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

  if (products.data.length > 0) {
    return products.data[0].id;
  }

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

    const isSuperAdmin = await verifySuperAdmin(supabase, user.id);
    if (!isSuperAdmin) return errorResponse("Only super admins can manage subscription plans", 403);

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create":
        return await handleCreate(supabase, body);
      case "update":
        return await handleUpdate(supabase, body);
      case "deactivate":
        return await handleDeactivate(supabase, body);
      case "activate":
        return await handleActivate(supabase, body);
      case "delete":
        return await handleDelete(supabase, body);
      case "list":
        return await handleList(supabase, body);
      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error("Error in manage-subscription-plans:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});

/** Stripe client on the tenant's configured subscription account. */
async function getStripe(supabase: any, tenantId: string) {
  const mode = await getSubscriptionStripeMode(supabase, tenantId);
  const account = await getTenantSubscriptionAccount(supabase, tenantId);
  return { stripe: getSubscriptionStripeClientForAccount(account, mode), account, mode };
}

/**
 * Stripe client on the account a plan's price actually lives on
 * (rows created before the UAE migration default to 'uk').
 */
async function getStripeForPlan(supabase: any, tenantId: string, planStripeAccount: string | null) {
  const mode = await getSubscriptionStripeMode(supabase, tenantId);
  const account = planStripeAccount === "uae" ? "uae" : "uk";
  return getSubscriptionStripeClientForAccount(account, mode);
}

async function handleCreate(supabase: any, body: any) {
  const { tenantId, name, description, features, amount, currency = "usd", interval = "month", trialDays = 0, billingModel = "trial" } = body;
  const safeBillingModel = billingModel === "upfront_monthly" ? "upfront_monthly" : "trial";

  if (!tenantId) return errorResponse("tenantId is required");
  if (!name) return errorResponse("name is required");
  if (!amount || amount <= 0) return errorResponse("amount must be a positive number (in cents)");

  const { stripe, account } = await getStripe(supabase, tenantId);
  const productId = await getOrCreateProduct(stripe);

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: currency.toLowerCase(),
    recurring: { interval: interval as "month" | "year" },
    metadata: { tenant_id: tenantId, plan_name: name },
  });

  console.log(`Created Stripe Price ${price.id} on ${account} account for tenant ${tenantId}, plan "${name}"`);

  const { data, error } = await supabase
    .from("subscription_plans")
    .insert({
      tenant_id: tenantId,
      name,
      description: description || null,
      features: features || [],
      amount,
      currency: currency.toLowerCase(),
      interval,
      stripe_price_id: price.id,
      stripe_product_id: productId,
      stripe_account: account,
      trial_days: trialDays,
      billing_model: safeBillingModel,
    })
    .select()
    .single();

  if (error) {
    console.error("Error inserting plan:", error);
    throw error;
  }

  return jsonResponse({ success: true, plan: data });
}

async function handleUpdate(supabase: any, body: any) {
  const { planId, name, description, features, amount, currency, interval, trialDays, billingModel } = body;

  if (!planId) return errorResponse("planId is required");

  const { data: existingPlan, error: fetchError } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("id", planId)
    .single();

  if (fetchError || !existingPlan) return errorResponse("Plan not found", 404);

  const { stripe, account } = await getStripe(supabase, existingPlan.tenant_id);
  const planAccount = existingPlan.stripe_account === "uae" ? "uae" : "uk";

  const pricingChanged =
    (amount !== undefined && amount !== existingPlan.amount) ||
    (currency !== undefined && currency.toLowerCase() !== existingPlan.currency) ||
    (interval !== undefined && interval !== existingPlan.interval);

  let newStripePriceId = existingPlan.stripe_price_id;
  let newStripeProductId = existingPlan.stripe_product_id;
  let newStripeAccount = planAccount;

  if (pricingChanged) {
    const newAmount = amount ?? existingPlan.amount;
    const newCurrency = (currency ?? existingPlan.currency).toLowerCase();
    const newInterval = interval ?? existingPlan.interval;
    // New price goes on the tenant's CURRENT subscription account. If the plan
    // was created on the other account, its stored product id doesn't exist
    // here — resolve/create the product on this account instead.
    const productId = planAccount === account
      ? existingPlan.stripe_product_id
      : await getOrCreateProduct(stripe);

    const newPrice = await stripe.prices.create({
      product: productId,
      unit_amount: newAmount,
      currency: newCurrency,
      recurring: { interval: newInterval as "month" | "year" },
      metadata: { tenant_id: existingPlan.tenant_id, plan_name: name || existingPlan.name },
    });

    if (existingPlan.stripe_price_id) {
      // Deactivate the old price on the account it actually lives on.
      try {
        const oldStripe = planAccount === account
          ? stripe
          : await getStripeForPlan(supabase, existingPlan.tenant_id, planAccount);
        await oldStripe.prices.update(existingPlan.stripe_price_id, { active: false });
      } catch (deactivateErr) {
        console.warn(`Could not deactivate old price ${existingPlan.stripe_price_id} on ${planAccount} account:`, deactivateErr.message);
      }
    }

    newStripePriceId = newPrice.id;
    newStripeProductId = productId;
    newStripeAccount = account;
    console.log(`Created new Stripe Price ${newPrice.id} on ${account} account, deactivated old ${existingPlan.stripe_price_id}`);
  }

  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (features !== undefined) updateData.features = features;
  if (amount !== undefined) updateData.amount = amount;
  if (currency !== undefined) updateData.currency = currency.toLowerCase();
  if (interval !== undefined) updateData.interval = interval;
  if (trialDays !== undefined) updateData.trial_days = trialDays;
  if (billingModel !== undefined) updateData.billing_model = billingModel === "upfront_monthly" ? "upfront_monthly" : "trial";
  if (newStripePriceId !== existingPlan.stripe_price_id) {
    updateData.stripe_price_id = newStripePriceId;
  }
  if (newStripeProductId !== existingPlan.stripe_product_id) {
    updateData.stripe_product_id = newStripeProductId;
  }
  if (newStripeAccount !== planAccount) {
    updateData.stripe_account = newStripeAccount;
  }

  const { data, error } = await supabase
    .from("subscription_plans")
    .update(updateData)
    .eq("id", planId)
    .select()
    .single();

  if (error) {
    console.error("Error updating plan:", error);
    throw error;
  }

  return jsonResponse({ success: true, plan: data, pricingChanged });
}

async function handleDeactivate(supabase: any, body: any) {
  const { planId } = body;
  if (!planId) return errorResponse("planId is required");

  const { data: plan, error: fetchError } = await supabase
    .from("subscription_plans")
    .select("stripe_price_id, tenant_id, stripe_account")
    .eq("id", planId)
    .single();

  if (fetchError || !plan) return errorResponse("Plan not found", 404);

  if (plan.stripe_price_id) {
    const stripe = await getStripeForPlan(supabase, plan.tenant_id, plan.stripe_account);
    await archivePriceIfPresent(stripe, plan.stripe_price_id);
  }

  const { error } = await supabase
    .from("subscription_plans")
    .update({ is_active: false })
    .eq("id", planId);

  if (error) throw error;

  return jsonResponse({ success: true });
}

async function handleActivate(supabase: any, body: any) {
  const { planId } = body;
  if (!planId) return errorResponse("planId is required");

  const { data: plan, error: fetchError } = await supabase
    .from("subscription_plans")
    .select("stripe_price_id, tenant_id, stripe_account")
    .eq("id", planId)
    .single();

  if (fetchError || !plan) return errorResponse("Plan not found", 404);

  if (plan.stripe_price_id) {
    const stripe = await getStripeForPlan(supabase, plan.tenant_id, plan.stripe_account);
    await stripe.prices.update(plan.stripe_price_id, { active: true });
  }

  const { error } = await supabase
    .from("subscription_plans")
    .update({ is_active: true })
    .eq("id", planId);

  if (error) throw error;

  return jsonResponse({ success: true });
}

/**
 * Archive a Stripe price, tolerating one that no longer exists.
 *
 * Plan rows can reference a price on an account we're no longer talking to
 * (legacy platform accounts, mode switches). A price that doesn't exist can't
 * bill anyone, so it must never block deactivating or deleting the plan row —
 * anything else (network, auth) still propagates.
 */
async function archivePriceIfPresent(stripe: any, priceId: string): Promise<void> {
  try {
    await stripe.prices.update(priceId, { active: false });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const gone = err?.code === "resource_missing" || /no such price/i.test(msg);
    if (!gone) throw err;
    console.warn(`[manage-subscription-plans] price ${priceId} not found on this account — treating as already archived. (${msg})`);
  }
}

async function handleDelete(supabase: any, body: any) {
  const { planId } = body;
  if (!planId) return errorResponse("planId is required");

  const { data: subs } = await supabase
    .from("tenant_subscriptions")
    .select("id")
    .eq("plan_id", planId)
    .limit(1);

  if (subs && subs.length > 0) {
    return errorResponse(
      "Cannot delete plan that has subscriptions. Deactivate it instead.",
      409
    );
  }

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("stripe_price_id, tenant_id, stripe_account")
    .eq("id", planId)
    .single();

  if (plan?.stripe_price_id) {
    const stripe = await getStripeForPlan(supabase, plan.tenant_id, plan.stripe_account);
    await archivePriceIfPresent(stripe, plan.stripe_price_id);
  }

  const { error } = await supabase
    .from("subscription_plans")
    .delete()
    .eq("id", planId);

  if (error) throw error;

  return jsonResponse({ success: true });
}

async function handleList(supabase: any, body: any) {
  const { tenantId } = body;
  if (!tenantId) return errorResponse("tenantId is required");

  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return jsonResponse({ success: true, plans: data || [] });
}
