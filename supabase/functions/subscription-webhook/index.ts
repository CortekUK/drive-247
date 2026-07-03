import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getSubscriptionStripeClientForAccount,
  getSubscriptionWebhookSecretCandidates,
  type SubscriptionAccount,
} from "../_shared/subscription-stripe.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return errorResponse("Missing stripe-signature header", 400);

  // Determine mode from Stripe's livemode flag, then verify signature with correct secret
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const mode: "test" | "live" = payload.livemode ? "live" : "test";

  // The same webhook URL is registered on both platform accounts (UK legacy +
  // UAE) during the migration. Try each account's signing secret — whichever
  // verifies tells us which account the event came from.
  const candidates = getSubscriptionWebhookSecretCandidates(mode);
  if (candidates.length === 0) {
    console.error(`Missing webhook secret for mode: ${mode}`);
    return errorResponse("Webhook not configured", 500);
  }

  let event: Stripe.Event | null = null;
  let account: SubscriptionAccount = "uk";
  let stripe: Stripe | null = null;
  for (const candidate of candidates) {
    try {
      const client = getSubscriptionStripeClientForAccount(candidate.account, mode);
      event = await client.webhooks.constructEventAsync(body, signature, candidate.secret);
      account = candidate.account;
      stripe = client;
      break;
    } catch (_err) {
      // Wrong secret (or missing key) for this candidate — try the next one.
    }
  }

  if (!event || !stripe) {
    console.error("Webhook signature verification failed for all configured accounts");
    return errorResponse("Invalid signature", 400);
  }

  console.log(`Subscription webhook event: ${event.type} (${event.id}) [account: ${account}, mode: ${mode}]`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const sessionObj = event.data.object as any;
        if (sessionObj.metadata?.type === "credit_purchase") {
          await handleCreditPurchase(supabase, sessionObj);
        } else {
          await handleCheckoutCompleted(stripe, supabase, sessionObj, account, mode);
        }
        break;
      }
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(stripe, supabase, event.data.object, account);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(supabase, event.data.object, account);
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

async function handleCheckoutCompleted(
  stripe: Stripe,
  supabase: any,
  session: any,
  account: SubscriptionAccount,
  mode: "test" | "live"
) {
  if (session.mode !== "subscription") return;

  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) { console.error("No tenant_id in checkout session metadata"); return; }

  const subscriptionId = session.subscription;
  if (!subscriptionId) { console.error("No subscription ID in checkout session"); return; }

  const planId = session.metadata?.plan_id || null;
  const planName = session.metadata?.plan_name || null;
  const isUaeMigration = account === "uae" && session.metadata?.migration === "uae-capture";

  // UK→UAE migration: retire the legacy UK subscription BEFORE upserting the
  // new UAE row (a partial unique index allows only one active/trialing/
  // past_due row per tenant). The Stripe-side UK subscription is set to
  // cancel_at_period_end so it simply stops when the already-paid period ends.
  if (isUaeMigration) {
    // Flip the tenant to the UAE account FIRST so the post-migration guard in
    // handleSubscriptionUpdated ignores the UK subscription.updated event that
    // the cancel_at_period_end call below will trigger (it can arrive before
    // this handler finishes).
    await supabase
      .from("tenants")
      .update({ subscription_account: "uae" })
      .eq("id", tenantId);

    const { data: oldSubs } = await supabase
      .from("tenant_subscriptions")
      .select("id, stripe_subscription_id, stripe_account, current_period_end")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .neq("stripe_subscription_id", subscriptionId);

    for (const oldSub of oldSubs || []) {
      if (oldSub.stripe_account !== "uae" && oldSub.stripe_subscription_id) {
        try {
          const ukStripe = getSubscriptionStripeClientForAccount("uk", mode);
          await ukStripe.subscriptions.update(oldSub.stripe_subscription_id, {
            cancel_at_period_end: true,
          });
          console.log(`UAE migration: set UK subscription ${oldSub.stripe_subscription_id} to cancel_at_period_end for tenant ${tenantId}`);
        } catch (cancelErr) {
          console.error(`UAE migration: failed to cancel UK subscription ${oldSub.stripe_subscription_id}:`, cancelErr.message);
        }
      }
      // Retire the DB row now so the new UAE row can occupy the
      // one-active-subscription-per-tenant slot.
      await supabase
        .from("tenant_subscriptions")
        .update({
          status: "canceled",
          canceled_at: new Date().toISOString(),
          ended_at: oldSub.current_period_end || new Date().toISOString(),
        })
        .eq("id", oldSub.id);
      console.log(`UAE migration: retired legacy subscription row ${oldSub.id} for tenant ${tenantId}`);
    }
  }

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
      // Tag which platform account bills this subscription. UK rows keep the
      // column's default; only events verified from the UAE account tag 'uae'.
      ...(account === "uae" ? { stripe_account: "uae" } : {}),
    }, { onConflict: "stripe_subscription_id" });

  if (subError) { console.error("Error upserting subscription:", subError); throw subError; }

  // If trialing, force test mode for Stripe Connect and Bonzah so tenant can configure safely.
  // EXCEPTION: a uae-capture migration rides Stripe's trial primitive purely to
  // defer the first UAE charge until the paid UK period ends — the tenant is an
  // existing (often live) operator, so never knock them back to test mode.
  const tenantUpdate: Record<string, any> = {
    subscription_plan: resolvedPlanName,
    stripe_subscription_customer_id: subscription.customer as string,
  };
  if (isUaeMigration) {
    tenantUpdate.subscription_account = "uae";
    console.log(`UAE migration complete for tenant ${tenantId} — subscription now bills on the UAE account`);
  } else if (subscription.status === "trialing") {
    tenantUpdate.stripe_mode = "test";
    tenantUpdate.bonzah_mode = "test";
    tenantUpdate.setup_completed_at = null;
    console.log(`Trial started for tenant ${tenantId} — forcing test mode for Stripe Connect & Bonzah`);
  }

  const { error: tenantError } = await supabase
    .from("tenants")
    .update(tenantUpdate)
    .eq("id", tenantId);

  if (tenantError) console.error("Error updating tenant plan:", tenantError);

  // Auto-refund the $1 card verification charge if present
  if (session.metadata?.setup_fee === "true" && session.payment_intent) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: session.payment_intent as string,
        reason: "requested_by_customer",
      });
      console.log(`Auto-refunded $1 verification charge (refund: ${refund.id}) for tenant ${tenantId}`);
    } catch (refundErr) {
      console.warn(`Failed to auto-refund verification charge for tenant ${tenantId}:`, refundErr.message);
    }
  }

  console.log(`Subscription ${subscription.id} activated for tenant ${tenantId}, plan: ${resolvedPlanName}`);
}

async function handleSubscriptionUpdated(
  stripe: Stripe,
  supabase: any,
  subscription: any,
  account: SubscriptionAccount
) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) { console.error("No tenant_id in subscription metadata"); return; }

  // Post-migration guard: once a tenant bills on the UAE account, events about
  // their legacy UK subscription (which is winding down via
  // cancel_at_period_end) must not overwrite the retired DB row or the
  // tenant's plan — the UAE subscription is now the source of truth.
  if (account === "uk") {
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("subscription_account")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantRow?.subscription_account === "uae") {
      console.log(`Ignoring UK subscription.updated for migrated tenant ${tenantId} (sub ${subscription.id})`);
      return;
    }
  }

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
      ...(account === "uae" ? { stripe_account: "uae" } : {}),
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) { console.error("Error updating subscription:", error); throw error; }

  let activePlan = "basic";
  if (["active", "trialing"].includes(subscription.status)) {
    const subPlanName = subscription.metadata?.plan_name;
    if (subPlanName) {
      activePlan = subPlanName;
    } else {
      const { data: existingSub } = await supabase
        .from("tenant_subscriptions")
        .select("plan_name")
        .eq("stripe_subscription_id", subscription.id)
        .single();
      activePlan = existingSub?.plan_name || "pro";
    }
  }
  // Auto go-live: when trial ends and subscription becomes active, switch to live mode (once)
  const goLiveUpdate: Record<string, any> = { subscription_plan: activePlan };
  if (subscription.status === "active") {
    const { data: currentTenant } = await supabase
      .from("tenants")
      .select("setup_completed_at")
      .eq("id", tenantId)
      .single();

    if (currentTenant && !currentTenant.setup_completed_at) {
      goLiveUpdate.stripe_mode = "live";
      goLiveUpdate.bonzah_mode = "live";
      goLiveUpdate.setup_completed_at = new Date().toISOString();
      console.log(`Auto go-live for tenant ${tenantId} — switching Stripe Connect & Bonzah to live mode`);
    }
  }

  await supabase.from("tenants").update(goLiveUpdate).eq("id", tenantId);
  console.log(`Subscription ${subscription.id} updated: status=${subscription.status}, plan=${activePlan}`);
}

async function handleSubscriptionDeleted(supabase: any, subscription: any, account: SubscriptionAccount) {
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
    // Don't downgrade the tenant's plan if another subscription is still
    // active/trialing — e.g. the legacy UK subscription finally ending at
    // period end AFTER the tenant migrated to a UAE subscription.
    const { data: otherActive } = await supabase
      .from("tenant_subscriptions")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .neq("stripe_subscription_id", subscription.id)
      .limit(1);

    if (otherActive && otherActive.length > 0) {
      console.log(`Subscription ${subscription.id} (${account}) deleted for tenant ${tenantId}, but another active subscription exists — keeping current plan`);
    } else {
      await supabase.from("tenants").update({ subscription_plan: "basic" }).eq("id", tenantId);
    }
  }
  console.log(`Subscription ${subscription.id} deleted/canceled`);
}

function parseInvoiceLineItems(invoice: any): { baseAmount: number; usageAmount: number; usageQuantity: number } {
  let baseAmount = 0;
  let usageAmount = 0;
  let usageQuantity = 0;

  const lines = invoice.lines?.data || [];
  for (const line of lines) {
    if (line.price?.recurring?.usage_type === "metered") {
      usageAmount += line.amount || 0;
      usageQuantity += line.quantity || 0;
    } else {
      baseAmount += line.amount || 0;
    }
  }

  return { baseAmount, usageAmount, usageQuantity };
}

async function handleInvoicePaid(supabase: any, invoice: any) {
  const subscriptionId = invoice.subscription;
  const customerId = invoice.customer;

  const { data: tenant } = await supabase.from("tenants").select("id").eq("stripe_subscription_customer_id", customerId).maybeSingle();
  if (!tenant) { console.log("No tenant found for customer:", customerId); return; }

  const { data: sub } = await supabase.from("tenant_subscriptions").select("id").eq("stripe_subscription_id", subscriptionId).maybeSingle();

  const { baseAmount, usageAmount, usageQuantity } = parseInvoiceLineItems(invoice);

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
      base_amount: baseAmount || null,
      usage_amount: usageAmount || null,
      usage_quantity: usageQuantity || null,
    }, { onConflict: "stripe_invoice_id" });

  if (error) console.error("Error upserting invoice:", error);
  console.log(`Invoice ${invoice.id} paid for tenant ${tenant.id} (base: ${baseAmount}, usage: ${usageAmount}, qty: ${usageQuantity})`);

  // Self-heal: a paid recurring invoice (billing_reason "subscription_cycle")
  // means the subscription is active. If the trialing→active
  // `customer.subscription.updated` event was missed/dropped by Stripe, the
  // subscription row would otherwise stay frozen at "trialing" and the portal
  // would render a nonsensical "Trial · 0 days left". Promoting here closes
  // that gap. We deliberately only act on "subscription_cycle" so the initial
  // $1 setup-fee / trial-start invoice ("subscription_create") never triggers
  // a premature go-live during the trial.
  if (sub?.id && invoice.billing_reason === "subscription_cycle" && (invoice.amount_paid || 0) > 0) {
    const { data: currentSub } = await supabase
      .from("tenant_subscriptions")
      .select("status")
      .eq("id", sub.id)
      .single();

    // Only promote non-terminal states — never resurrect a canceled subscription.
    if (currentSub && ["trialing", "past_due", "incomplete"].includes(currentSub.status)) {
      await supabase
        .from("tenant_subscriptions")
        .update({
          status: "active",
          ...(invoice.period_start ? { current_period_start: new Date(invoice.period_start * 1000).toISOString() } : {}),
          ...(invoice.period_end ? { current_period_end: new Date(invoice.period_end * 1000).toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);

      // Auto go-live once (mirrors handleSubscriptionUpdated)
      const { data: t } = await supabase
        .from("tenants")
        .select("setup_completed_at")
        .eq("id", tenant.id)
        .single();
      if (t && !t.setup_completed_at) {
        await supabase
          .from("tenants")
          .update({
            stripe_mode: "live",
            bonzah_mode: "live",
            setup_completed_at: new Date().toISOString(),
          })
          .eq("id", tenant.id);
        console.log(`Auto go-live (via invoice.paid) for tenant ${tenant.id}`);
      }
      console.log(`Subscription ${subscriptionId} promoted trialing→active via invoice.paid for tenant ${tenant.id}`);
    }
  }
}

async function handleInvoicePaymentFailed(supabase: any, invoice: any) {
  const customerId = invoice.customer;

  const { data: tenant } = await supabase.from("tenants").select("id, company_name, contact_email").eq("stripe_subscription_customer_id", customerId).maybeSingle();
  if (!tenant) { console.log("No tenant found for customer:", customerId); return; }

  const { data: sub } = await supabase.from("tenant_subscriptions").select("id").eq("stripe_subscription_id", invoice.subscription).maybeSingle();

  const { baseAmount, usageAmount, usageQuantity } = parseInvoiceLineItems(invoice);

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
      base_amount: baseAmount || null,
      usage_amount: usageAmount || null,
      usage_quantity: usageQuantity || null,
    }, { onConflict: "stripe_invoice_id" });

  console.log(`Invoice payment failed for tenant ${tenant.id} (${tenant.company_name})`);
}

async function handleCreditPurchase(supabase: any, session: any) {
  const tenantId = session.metadata?.tenant_id;
  const packageId = session.metadata?.package_id;
  const credits = parseInt(session.metadata?.credits || "0", 10);
  const packageName = session.metadata?.package_name || "Credits";

  if (!tenantId || !credits) {
    console.error("Missing tenant_id or credits in credit purchase metadata");
    return;
  }

  // Determine if this was a test or live purchase based on Stripe's livemode
  const isTestPurchase = !session.livemode;

  // Add credits to wallet (test credits go to test_balance, live to balance)
  const { data, error } = await supabase.rpc("add_credits", {
    p_tenant_id: tenantId,
    p_amount: credits,
    p_type: "purchase",
    p_description: `Purchased ${packageName} package (${credits} ${isTestPurchase ? "test " : ""}credits)`,
    p_package_id: packageId || null,
    p_stripe_payment_id: session.payment_intent || null,
    p_is_test_mode: isTestPurchase,
  });

  if (error) {
    console.error("Error adding credits after purchase:", error);
    throw error;
  }

  // Save the payment method for future auto-refill
  if (session.payment_intent) {
    try {
      // The payment_intent has setup_future_usage so the PM is saved on the customer
      // Store the PM ID on the wallet for auto-refill
      const { data: piData } = await supabase
        .from("tenant_credit_wallets")
        .select("stripe_payment_method_id")
        .eq("tenant_id", tenantId)
        .single();

      if (piData && !piData.stripe_payment_method_id) {
        // We'll update this when we can resolve the PM from the PI
        // For now, auto-refill will fall back to customer's default PM
        console.log("Payment method will be resolved from customer default for auto-refill");
      }
    } catch (pmErr) {
      console.warn("Could not save payment method for auto-refill:", pmErr);
    }
  }

  console.log(`Credit purchase completed: ${credits} ${isTestPurchase ? "TEST" : "LIVE"} credits added for tenant ${tenantId} (package: ${packageName})`);
}
