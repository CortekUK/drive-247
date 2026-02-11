import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function getSubscriptionStripe() {
  const key = Deno.env.get("STRIPE_SUBSCRIPTION_SECRET_KEY");
  if (!key) throw new Error("Missing STRIPE_SUBSCRIPTION_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const webhookSecret = Deno.env.get("STRIPE_SUBSCRIPTION_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("Missing STRIPE_SUBSCRIPTION_WEBHOOK_SECRET");
    return errorResponse("Webhook not configured", 500);
  }

  const stripe = getSubscriptionStripe();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return errorResponse("Missing stripe-signature header", 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return errorResponse("Invalid signature", 400);
  }

  console.log(`Subscription webhook event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(stripe, supabase, event.data.object);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(stripe, supabase, event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(supabase, event.data.object);
        break;
      case "invoice.paid":
        await handleInvoicePaid(supabase, event.data.object);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(supabase, event.data.object);
        break;
      default:
        console.log(`Unhandled subscription webhook event: ${event.type}`);
    }
  } catch (error) {
    console.error(`Error handling ${event.type}:`, error);
    return jsonResponse({ received: true, error: error.message });
  }

  return jsonResponse({ received: true });
});

async function handleCheckoutCompleted(stripe: Stripe, supabase: any, session: any) {
  if (session.mode !== "subscription") return;

  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) { console.error("No tenant_id in checkout session metadata"); return; }

  const subscriptionId = session.subscription;
  if (!subscriptionId) { console.error("No subscription ID in checkout session"); return; }

  // Read plan info from session metadata
  const planId = session.metadata?.plan_id || null;
  const planName = session.metadata?.plan_name || null;

  // If we have a plan_id, look up the plan for authoritative name
  let resolvedPlanName = planName || "pro";
  if (planId) {
    const { data: plan } = await supabase
      .from("subscription_plans")
      .select("name")
      .eq("id", planId)
      .single();
    if (plan) resolvedPlanName = plan.name;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method"],
  });

  const paymentMethod = subscription.default_payment_method as Stripe.PaymentMethod | null;
  const card = paymentMethod?.card;

  const { error: subError } = await supabase
    .from("tenant_subscriptions")
    .upsert({
      tenant_id: tenantId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer as string,
      status: subscription.status,
      plan_name: resolvedPlanName,
      plan_id: planId,
      amount: subscription.items.data[0]?.price?.unit_amount || 0,
      currency: subscription.currency,
      interval: subscription.items.data[0]?.price?.recurring?.interval || "month",
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      card_brand: card?.brand || null,
      card_last4: card?.last4 || null,
      card_exp_month: card?.exp_month || null,
      card_exp_year: card?.exp_year || null,
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    }, { onConflict: "stripe_subscription_id" });

  if (subError) { console.error("Error upserting subscription:", subError); throw subError; }

  const { error: tenantError } = await supabase
    .from("tenants")
    .update({ subscription_plan: resolvedPlanName, stripe_subscription_customer_id: subscription.customer as string })
    .eq("id", tenantId);

  if (tenantError) console.error("Error updating tenant plan:", tenantError);
  console.log(`Subscription ${subscription.id} activated for tenant ${tenantId}, plan: ${resolvedPlanName}`);
}

async function handleSubscriptionUpdated(stripe: Stripe, supabase: any, subscription: any) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) { console.error("No tenant_id in subscription metadata"); return; }

  const fullSub = await stripe.subscriptions.retrieve(subscription.id, {
    expand: ["default_payment_method"],
  });

  const paymentMethod = fullSub.default_payment_method as Stripe.PaymentMethod | null;
  const card = paymentMethod?.card;

  const { error } = await supabase
    .from("tenant_subscriptions")
    .update({
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null,
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      card_brand: card?.brand || null,
      card_last4: card?.last4 || null,
      card_exp_month: card?.exp_month || null,
      card_exp_year: card?.exp_year || null,
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) { console.error("Error updating subscription:", error); throw error; }

  // Resolve plan name from subscription metadata or existing record
  let activePlan = "basic";
  if (["active", "trialing"].includes(subscription.status)) {
    const subPlanName = subscription.metadata?.plan_name;
    if (subPlanName) {
      activePlan = subPlanName;
    } else {
      // Fall back to what's stored in our DB
      const { data: existingSub } = await supabase
        .from("tenant_subscriptions")
        .select("plan_name")
        .eq("stripe_subscription_id", subscription.id)
        .single();
      activePlan = existingSub?.plan_name || "pro";
    }
  }
  await supabase.from("tenants").update({ subscription_plan: activePlan }).eq("id", tenantId);
  console.log(`Subscription ${subscription.id} updated: status=${subscription.status}, plan=${activePlan}`);
}

async function handleSubscriptionDeleted(supabase: any, subscription: any) {
  const tenantId = subscription.metadata?.tenant_id;

  const { error } = await supabase
    .from("tenant_subscriptions")
    .update({
      status: "canceled",
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : new Date().toISOString(),
      ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) console.error("Error marking subscription canceled:", error);

  if (tenantId) {
    await supabase.from("tenants").update({ subscription_plan: "basic" }).eq("id", tenantId);
  }
  console.log(`Subscription ${subscription.id} deleted/canceled`);
}

async function handleInvoicePaid(supabase: any, invoice: any) {
  const subscriptionId = invoice.subscription;
  const customerId = invoice.customer;

  const { data: tenant } = await supabase.from("tenants").select("id").eq("stripe_subscription_customer_id", customerId).maybeSingle();
  if (!tenant) { console.log("No tenant found for customer:", customerId); return; }

  const { data: sub } = await supabase.from("tenant_subscriptions").select("id").eq("stripe_subscription_id", subscriptionId).maybeSingle();

  const { error } = await supabase
    .from("tenant_subscription_invoices")
    .upsert({
      tenant_id: tenant.id,
      subscription_id: sub?.id || null,
      stripe_invoice_id: invoice.id,
      stripe_invoice_pdf: invoice.invoice_pdf || null,
      stripe_hosted_invoice_url: invoice.hosted_invoice_url || null,
      status: "paid",
      amount_due: invoice.amount_due || 0,
      amount_paid: invoice.amount_paid || 0,
      currency: invoice.currency || "usd",
      period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
      period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
      due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      paid_at: new Date().toISOString(),
      invoice_number: invoice.number || null,
    }, { onConflict: "stripe_invoice_id" });

  if (error) console.error("Error upserting invoice:", error);
  console.log(`Invoice ${invoice.id} paid for tenant ${tenant.id}`);
}

async function handleInvoicePaymentFailed(supabase: any, invoice: any) {
  const customerId = invoice.customer;

  const { data: tenant } = await supabase.from("tenants").select("id, company_name, contact_email").eq("stripe_subscription_customer_id", customerId).maybeSingle();
  if (!tenant) { console.log("No tenant found for customer:", customerId); return; }

  const { data: sub } = await supabase.from("tenant_subscriptions").select("id").eq("stripe_subscription_id", invoice.subscription).maybeSingle();

  await supabase
    .from("tenant_subscription_invoices")
    .upsert({
      tenant_id: tenant.id,
      subscription_id: sub?.id || null,
      stripe_invoice_id: invoice.id,
      stripe_invoice_pdf: invoice.invoice_pdf || null,
      stripe_hosted_invoice_url: invoice.hosted_invoice_url || null,
      status: "open",
      amount_due: invoice.amount_due || 0,
      amount_paid: invoice.amount_paid || 0,
      currency: invoice.currency || "usd",
      period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
      period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
      due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      invoice_number: invoice.number || null,
    }, { onConflict: "stripe_invoice_id" });

  console.log(`Invoice payment failed for tenant ${tenant.id} (${tenant.company_name})`);
}
