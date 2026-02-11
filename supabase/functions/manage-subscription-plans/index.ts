import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getSubscriptionStripeMode,
  getSubscriptionStripeClient,
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

async function getStripe(supabase: any, tenantId: string) {
  const mode = await getSubscriptionStripeMode(supabase, tenantId);
  return getSubscriptionStripeClient(mode);
}

async function handleCreate(supabase: any, body: any) {
  const { tenantId, name, description, features, amount, currency = "usd", interval = "month", trialDays = 0 } = body;

  if (!tenantId) return errorResponse("tenantId is required");
  if (!name) return errorResponse("name is required");
  if (!amount || amount <= 0) return errorResponse("amount must be a positive number (in cents)");

  const stripe = await getStripe(supabase, tenantId);
  const productId = await getOrCreateProduct(stripe);

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: currency.toLowerCase(),
    recurring: { interval: interval as "month" | "year" },
    metadata: { tenant_id: tenantId, plan_name: name },
  });

  console.log(`Created Stripe Price ${price.id} for tenant ${tenantId}, plan "${name}"`);

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
      trial_days: trialDays,
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
  const { planId, name, description, features, amount, currency, interval, trialDays } = body;

  if (!planId) return errorResponse("planId is required");

  const { data: existingPlan, error: fetchError } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("id", planId)
    .single();

  if (fetchError || !existingPlan) return errorResponse("Plan not found", 404);

  const stripe = await getStripe(supabase, existingPlan.tenant_id);

  const pricingChanged =
    (amount !== undefined && amount !== existingPlan.amount) ||
    (currency !== undefined && currency.toLowerCase() !== existingPlan.currency) ||
    (interval !== undefined && interval !== existingPlan.interval);

  let newStripePriceId = existingPlan.stripe_price_id;

  if (pricingChanged) {
    const newAmount = amount ?? existingPlan.amount;
    const newCurrency = (currency ?? existingPlan.currency).toLowerCase();
    const newInterval = interval ?? existingPlan.interval;
    const productId = existingPlan.stripe_product_id;

    const newPrice = await stripe.prices.create({
      product: productId,
      unit_amount: newAmount,
      currency: newCurrency,
      recurring: { interval: newInterval as "month" | "year" },
      metadata: { tenant_id: existingPlan.tenant_id, plan_name: name || existingPlan.name },
    });

    if (existingPlan.stripe_price_id) {
      await stripe.prices.update(existingPlan.stripe_price_id, { active: false });
    }

    newStripePriceId = newPrice.id;
    console.log(`Created new Stripe Price ${newPrice.id}, deactivated old ${existingPlan.stripe_price_id}`);
  }

  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (features !== undefined) updateData.features = features;
  if (amount !== undefined) updateData.amount = amount;
  if (currency !== undefined) updateData.currency = currency.toLowerCase();
  if (interval !== undefined) updateData.interval = interval;
  if (trialDays !== undefined) updateData.trial_days = trialDays;
  if (newStripePriceId !== existingPlan.stripe_price_id) {
    updateData.stripe_price_id = newStripePriceId;
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
    .select("stripe_price_id, tenant_id")
    .eq("id", planId)
    .single();

  if (fetchError || !plan) return errorResponse("Plan not found", 404);

  if (plan.stripe_price_id) {
    const stripe = await getStripe(supabase, plan.tenant_id);
    await stripe.prices.update(plan.stripe_price_id, { active: false });
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
    .select("stripe_price_id, tenant_id")
    .eq("id", planId)
    .single();

  if (fetchError || !plan) return errorResponse("Plan not found", 404);

  if (plan.stripe_price_id) {
    const stripe = await getStripe(supabase, plan.tenant_id);
    await stripe.prices.update(plan.stripe_price_id, { active: true });
  }

  const { error } = await supabase
    .from("subscription_plans")
    .update({ is_active: true })
    .eq("id", planId);

  if (error) throw error;

  return jsonResponse({ success: true });
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
    .select("stripe_price_id, tenant_id")
    .eq("id", planId)
    .single();

  if (plan?.stripe_price_id) {
    const stripe = await getStripe(supabase, plan.tenant_id);
    await stripe.prices.update(plan.stripe_price_id, { active: false });
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
