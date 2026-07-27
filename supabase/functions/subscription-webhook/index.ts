import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { onMigrationTaskComplete } from "../_shared/migration-progress.ts";
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
        await handleInvoicePaid(supabase, event.data.object, stripe);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(supabase, event.data.object);
        break;
      default:
        console.log(`Unhandled subscription webhook event: ${event.type}`);
    }
  } catch (error) {
    // Return 500 (not 200) so Stripe retries for up to 3 days. All handlers are
    // idempotent (upsert/onConflict, re-flip no-ops, retire matches nothing on
    // replay), so a retried event is safe — and a transient DB/Stripe error
    // during a migration no longer silently loses the whole event.
    console.error(`Error handling ${event.type}:`, error);
    return errorResponse(`Handler error for ${event.type}: ${error?.message ?? error}`, 500);
  }

  return jsonResponse({ received: true });
});

/**
 * Convert a Stripe unix-seconds timestamp to ISO, or null if it is absent or
 * unusable. `new Date(undefined * 1000)` is an Invalid Date whose .toISOString()
 * THROWS RangeError — the bug this guards against.
 */
function toIsoOrNull(unixSeconds: unknown): string | null {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Resolve a subscription's billing window.
 *
 * Stripe REMOVED `current_period_start` / `current_period_end` from the
 * Subscription object in API version 2025-03-31 (basil) and moved them onto the
 * subscription ITEMS. A webhook payload is rendered at the *endpoint's*
 * configured API version, which can be newer than the SDK version we pin
 * (2023-10-16) — so the raw event may omit these fields even though an SDK
 * `subscriptions.retrieve()` still returns them.
 *
 * Reading them unguarded threw `RangeError: Invalid time value`, which 500'd
 * EVERY customer.subscription.updated event and silently froze the DB (Stripe
 * then retried and failed again). Prefer the SDK-retrieved object, fall back to
 * the raw event, then to item-level fields, and never throw.
 *
 * Returns nulls when nothing is resolvable; callers must OMIT the columns in
 * that case rather than writing null over a previously-good value.
 */
function resolveSubscriptionPeriod(
  ...candidates: any[]
): { start: string | null; end: string | null } {
  for (const sub of candidates) {
    if (!sub) continue;
    const item = sub.items?.data?.[0];
    const start =
      toIsoOrNull(sub.current_period_start) ?? toIsoOrNull(item?.current_period_start);
    const end =
      toIsoOrNull(sub.current_period_end) ?? toIsoOrNull(item?.current_period_end);
    if (start || end) return { start, end };
  }
  return { start: null, end: null };
}

/** Spread-able patch that never clobbers a good stored period with null. */
function periodPatch(period: { start: string | null; end: string | null }) {
  return {
    ...(period.start ? { current_period_start: period.start } : {}),
    ...(period.end ? { current_period_end: period.end } : {}),
  };
}

/**
 * The subscription an invoice belongs to.
 *
 * Stripe relocated this in the 2025 API versions: `invoice.subscription` became
 * `invoice.parent.subscription_details.subscription`. Same class of change as
 * the current_period_* move that took the webhook down — and because a webhook
 * payload is rendered at the ENDPOINT's API version, a newer endpoint silently
 * yields undefined here, which would strand every invoice event with
 * "No tenant found". Read both shapes.
 */
function resolveInvoiceSubscriptionId(invoice: any): string | null {
  const direct = invoice?.subscription;
  if (typeof direct === "string" && direct) return direct;
  if (direct?.id) return direct.id;
  const nested = invoice?.parent?.subscription_details?.subscription;
  if (typeof nested === "string" && nested) return nested;
  if (nested?.id) return nested.id;
  return null;
}

/** Columns the go-live readiness gate needs. */
const GO_LIVE_SELECT =
  "setup_completed_at, stripe_charges_enabled, own_stripe_account_id, stripe_onboarding_complete, bonzah_username";

/**
 * Decide which capabilities may switch from test to live now that the tenant is
 * paying.
 *
 * WHY THIS GATE EXISTS. Paying for the platform is not the same as being ready
 * to take real money or bind real insurance. This previously flipped BOTH
 * stripe_mode and bonzah_mode to 'live' on the sole condition that
 * setup_completed_at was NULL — which is an idempotency guard ("only once"),
 * not a readiness check. Production evidence when this was found: of the 9
 * tenants due to auto-go-live, EIGHT had no Bonzah credentials at all and none
 * had stripe_charges_enabled=true. Flipping those would have pointed real
 * customer bookings at an unconfigured live insurance integration.
 *
 * Rule: switch a capability to live only when THAT capability is configured.
 * They are decided independently — a tenant with Connect ready but no Bonzah
 * credentials goes live on payments only.
 *
 * setup_completed_at is stamped ONLY when everything went live, so a tenant
 * that finishes configuring later is still picked up by a subsequent event
 * instead of being permanently marked done while stuck in test mode.
 */
function resolveGoLive(tenant: any): {
  patch: Record<string, unknown>;
  reason: string;
} {
  if (!tenant || tenant.setup_completed_at) return { patch: {}, reason: "already-complete" };

  const connectReady =
    tenant.stripe_charges_enabled === true ||
    (!!tenant.own_stripe_account_id && tenant.stripe_onboarding_complete === true);
  const bonzahReady = !!tenant.bonzah_username;

  const patch: Record<string, unknown> = {};
  if (connectReady) patch.stripe_mode = "live";
  if (bonzahReady) patch.bonzah_mode = "live";

  // Only "done" when there is nothing left to switch on.
  if (connectReady && bonzahReady) {
    patch.setup_completed_at = new Date().toISOString();
  }

  return {
    patch,
    reason: `connectReady=${connectReady} bonzahReady=${bonzahReady}`,
  };
}

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
      .select("id, stripe_subscription_id, stripe_account, status, current_period_end")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .neq("stripe_subscription_id", subscriptionId);

    for (const oldSub of oldSubs || []) {
      if (oldSub.stripe_subscription_id) {
        // Cancel the old sub on WHICHEVER account it actually lives on — a UK
        // legacy sub, OR a duplicate UAE sub from a re-generated capture link.
        // If this throws we let it propagate (event 500s → Stripe retries):
        // NEVER retire the DB row while its Stripe subscription is still live,
        // or it double-bills invisibly.
        const oldAccount = oldSub.stripe_account === "uae" ? "uae" : "uk";
        const oldStripe = getSubscriptionStripeClientForAccount(oldAccount, mode);
        try {
          if (oldAccount === "uae" || oldSub.status === "past_due") {
            // Duplicate UAE sub = redundant; past-due UK sub has no paid period to
            // preserve and its open invoice would keep smart-retrying. Kill both now.
            await oldStripe.subscriptions.cancel(oldSub.stripe_subscription_id);
            console.log(`UAE migration: canceled ${oldAccount} subscription ${oldSub.stripe_subscription_id} (status ${oldSub.status}) for tenant ${tenantId}`);
          } else {
            // Active/trialing UK sub: let the already-paid period run out.
            await oldStripe.subscriptions.update(oldSub.stripe_subscription_id, {
              cancel_at_period_end: true,
            });
            console.log(`UAE migration: set UK subscription ${oldSub.stripe_subscription_id} to cancel_at_period_end for tenant ${tenantId}`);
          }
        } catch (cancelErr) {
          // A subscription that doesn't exist on that account can't double-bill,
          // so a stale/foreign DB reference must NOT block the migration forever
          // (it would 500 → Stripe retries → stuck). Anything else (network,
          // auth, rate limit) still propagates so we never retire a row whose
          // Stripe subscription is genuinely still live.
          const code = (cancelErr as any)?.code;
          const msg = String((cancelErr as any)?.message ?? cancelErr);
          const alreadyGone =
            code === "resource_missing" || /no such subscription/i.test(msg);
          if (!alreadyGone) throw cancelErr;
          console.warn(
            `UAE migration: subscription ${oldSub.stripe_subscription_id} not found on the ${oldAccount} account — treating as already cancelled. (${msg})`
          );
        }
      }
      // Only reached once the Stripe-side cancel above succeeded.
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

  // Set when this checkout completes the operator's "confirm payment details"
  // migration task, so we notify + reward once the tenant row is updated.
  let migrationPaymentCaptured = false;

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
      ...periodPatch(resolveSubscriptionPeriod(subscription)),
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
    migrationPaymentCaptured = true;
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

  // Auto-refund the $1 card-verification charge if present.
  // In `mode: "subscription"` Checkout, session.payment_intent is ALWAYS null —
  // the $1 setup-fee charge lives on the subscription's first invoice's
  // payment_intent. Resolve it from there (this is why the $1 was never
  // actually being refunded before).
  if (session.metadata?.setup_fee === "true") {
    try {
      let piId: string | null = (session.payment_intent as string) || null;
      if (!piId && subscription.latest_invoice) {
        const inv = await stripe.invoices.retrieve(
          subscription.latest_invoice as string,
          { expand: ["payment_intent"] }
        );
        const invPi = (inv as any).payment_intent;
        piId = typeof invPi === "string" ? invPi : invPi?.id || null;
      }
      if (piId) {
        const refund = await stripe.refunds.create({
          payment_intent: piId,
          // Refund ONLY the $1 verification, never a plan charge. setup_fee is now set
          // solely for deferred-charge plans (trial/upfront) whose first invoice is
          // $1-only, but cap defensively at the hardcoded verification amount (100 minor
          // units) so an amount-less refund can never return a plan charge that happens
          // to share the first invoice's payment_intent.
          amount: 100,
          reason: "requested_by_customer",
        });
        console.log(`Auto-refunded $1 verification charge (refund: ${refund.id}, PI: ${piId}) for tenant ${tenantId}`);
      } else {
        console.warn(`setup_fee set but no payment_intent found to refund for tenant ${tenantId}`);
      }
    } catch (refundErr) {
      console.warn(`Failed to auto-refund verification charge for tenant ${tenantId}:`, refundErr.message);
    }
  }

  // Silently attach the metered e-sign usage price to the subscription. It is
  // deliberately kept OFF the Checkout page (it renders as a confusing duplicate
  // "Drive247 Platform Subscription" row), so we add it here after the fact.
  // Per-signature billing (report-usage-event → Stripe meter) needs this price on
  // the subscription to actually bill. Non-fatal: a failure here must never block
  // the subscription setup or the $1 refund above — worst case, e-sign usage is
  // uncharged until re-synced, which we surface with an error log. Idempotent on
  // Stripe retries via the existing-item guard (the price only ever appears once).
  const meteredPriceId = session.metadata?.esign_metered_price_id;
  if (meteredPriceId) {
    try {
      const alreadyAttached = subscription.items.data.some(
        (i: any) => i.price?.id === meteredPriceId
      );
      if (!alreadyAttached) {
        await stripe.subscriptionItems.create({
          subscription: subscription.id,
          price: meteredPriceId,
          proration_behavior: "none",
        });
        console.log(`Attached metered e-sign price ${meteredPriceId} to subscription ${subscription.id} for tenant ${tenantId}`);
      }
    } catch (meterErr) {
      console.error(`Failed to attach metered e-sign price to subscription ${subscription.id} for tenant ${tenantId}:`, (meterErr as any)?.message ?? meterErr);
    }
  }

  // Task 2 done: notify the admin and grant the 100-credit reward if the
  // operator has now completed both migration steps. Best-effort by design —
  // it must never fail the webhook (which would trigger a Stripe retry of an
  // already-successful subscription setup).
  if (migrationPaymentCaptured) {
    await onMigrationTaskComplete(supabase, tenantId, "payment");
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
      // fullSub first: it comes from the SDK pinned to apiVersion 2023-10-16, so
      // it still carries top-level period fields even when the newer-versioned
      // webhook payload omits them.
      ...periodPatch(resolveSubscriptionPeriod(fullSub, subscription)),
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
  // Auto go-live: when the subscription becomes active, switch the capabilities
  // the tenant has actually configured to live mode. See resolveGoLive().
  const goLiveUpdate: Record<string, any> = { subscription_plan: activePlan };
  if (subscription.status === "active") {
    const { data: currentTenant } = await supabase
      .from("tenants")
      .select(GO_LIVE_SELECT)
      .eq("id", tenantId)
      .single();

    const { patch, reason } = resolveGoLive(currentTenant);
    Object.assign(goLiveUpdate, patch);
    if (Object.keys(patch).length > 0) {
      console.log(`Auto go-live for tenant ${tenantId}: ${JSON.stringify(patch)} (${reason})`);
    } else if (reason !== "already-complete") {
      console.log(`Auto go-live SKIPPED for tenant ${tenantId} — not configured (${reason})`);
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

async function handleInvoicePaid(supabase: any, invoice: any, stripe?: Stripe) {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);
  const customerId = invoice.customer;

  let { data: tenant } = await supabase.from("tenants").select("id").eq("stripe_subscription_customer_id", customerId).maybeSingle();
  if (!tenant) {
    // Fallback: the tenants column can be stale (e.g. overwritten by a credit
    // purchase creating a customer on the other account, or a UAE first-charge
    // invoice racing ahead of checkout.session.completed). Resolve via the
    // subscription row instead so the invoice is never silently dropped.
    const { data: subByCustomer } = await supabase
      .from("tenant_subscriptions").select("tenant_id").eq("stripe_customer_id", customerId).maybeSingle();
    if (subByCustomer) tenant = { id: subByCustomer.tenant_id };
    else if (subscriptionId) {
      const { data: subById } = await supabase
        .from("tenant_subscriptions").select("tenant_id").eq("stripe_subscription_id", subscriptionId).maybeSingle();
      if (subById) tenant = { id: subById.tenant_id };
    }
  }
  if (!tenant) { console.log("No tenant found for customer:", customerId, "sub:", subscriptionId); return; }

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

      // ── Cycle reset on a LATE payment (requirement E7) ──────────────────
      // "If they pay on the 29th, start their new billing cycle from the 29th,
      // not the 22nd. We absorb the 7 lost days to give them a fresh start."
      //
      // Paying an overdue invoice does NOT move Stripe's anchor by itself — the
      // subscription resumes on its original schedule, so a tenant who paid 7
      // days late would be billed again only 23 days later. Resetting the anchor
      // to now gives them the full period they just paid for.
      //
      // SAFETY:
      //  - only when the subscription was actually PAST_DUE (a normal on-time
      //    renewal must never have its anchor moved)
      //  - proration_behavior 'none' is essential: the default would issue
      //    proration line items and could charge the customer a second time
      //    within minutes of the payment that just cleared
      //  - idempotency_key is the invoice id, so Stripe collapses duplicate
      //    deliveries/retries of this same invoice.paid event into one update
      //  - non-fatal: a failure here must not fail the webhook and cause Stripe
      //    to retry the whole event (which already applied the payment).
      if (currentSub.status === "past_due" && stripe && subscriptionId) {
        try {
          await stripe.subscriptions.update(
            subscriptionId,
            {
              billing_cycle_anchor: "now",
              proration_behavior: "none",
            },
            { idempotencyKey: `cycle-reset-${invoice.id}` },
          );
          console.log(
            `Cycle reset for subscription ${subscriptionId} after late payment (invoice ${invoice.id}) — new period starts now`,
          );
        } catch (anchorErr) {
          console.error(
            `Failed to reset billing cycle for ${subscriptionId} (non-fatal):`,
            (anchorErr as any)?.message ?? anchorErr,
          );
        }
      }

      // Auto go-live (mirrors handleSubscriptionUpdated — same readiness gate).
      const { data: t } = await supabase
        .from("tenants")
        .select(GO_LIVE_SELECT)
        .eq("id", tenant.id)
        .single();
      const { patch, reason } = resolveGoLive(t);
      if (Object.keys(patch).length > 0) {
        await supabase.from("tenants").update(patch).eq("id", tenant.id);
        console.log(`Auto go-live (via invoice.paid) for tenant ${tenant.id}: ${JSON.stringify(patch)} (${reason})`);
      } else if (reason !== "already-complete") {
        console.log(`Auto go-live SKIPPED (via invoice.paid) for tenant ${tenant.id} — not configured (${reason})`);
      }
      console.log(`Subscription ${subscriptionId} promoted trialing→active via invoice.paid for tenant ${tenant.id}`);
    }
  }
}

async function handleInvoicePaymentFailed(supabase: any, invoice: any) {
  const customerId = invoice.customer;

  const { data: tenant } = await supabase.from("tenants").select("id, company_name, contact_email").eq("stripe_subscription_customer_id", customerId).maybeSingle();
  if (!tenant) { console.log("No tenant found for customer:", customerId); return; }

  const { data: sub } = await supabase.from("tenant_subscriptions").select("id").eq("stripe_subscription_id", resolveInvoiceSubscriptionId(invoice)).maybeSingle();

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

  // A low/empty e-sign wallet parks agreements as document_status='credit_failed'
  // and raises an ESIGN_LOW_CREDIT reminder. Now that the LIVE wallet is topped
  // up, resolve that alert and auto-retry the parked agreements so the customer
  // finally receives an up-to-date contract. Best-effort — never block the webhook.
  if (!isTestPurchase) {
    try {
      await supabase
        .from("reminders")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("rule_code", "ESIGN_LOW_CREDIT")
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "sent"]);
    } catch (e) {
      console.warn("Failed to resolve ESIGN_LOW_CREDIT reminder:", e);
    }

    try {
      await supabase.functions.invoke("retry-credit-failed-agreements", {
        body: { tenantId },
      });
      console.log(`Triggered credit_failed agreement retry for tenant ${tenantId}`);
    } catch (e) {
      console.warn("Failed to trigger credit_failed agreement retry:", e);
    }
  }
}
