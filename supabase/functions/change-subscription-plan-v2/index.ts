// change-subscription-plan-v2 — v2 Billing's "Upgrade / Switch plan".
//
// A NEW function (V2_PLAN §7): nothing existing changes. It moves a tenant's
// LIVE Drive247 subscription to another plan through Stripe's own hosted
// "confirm your plan change" page (a Billing Portal session with a
// `subscription_update_confirm` flow). Stripe Checkout can't do this — it only
// starts new subscriptions, and create-subscription-checkout refuses a second
// one. On that page Stripe shows the prorated amount, takes it from the card,
// and switches the plan; then it sends the operator back to Billing.
//
// POST (JWT) { tenantId, action, planKey? | planId?, promoCode?, returnUrl? }
//
//   action "session"  → { url }  Stripe's confirm page for the chosen plan.
//     planKey   "starter" | "growth" | "scale" — the site's self-serve plans
//     planId    a subscription_plans row of this tenant (per-tenant pricing)
//     promoCode optional; must be an active Stripe promotion code
//     returnUrl where Stripe sends them back (Billing, ?status=plan-updated)
//
//   action "confirm"  → { changed, planName }  After the return: if the live
//     subscription is now on the chosen plan's price, record it — a
//     subscription_plans row for the tenant (as signup-provision does) and the
//     subscription's plan metadata, which subscription-webhook reads on the
//     `customer.subscription.updated` that follows. Safe to call more than
//     once; does nothing if the change didn't happen.
//
// Proration: `always_invoice` — the difference for the rest of the period is
// invoiced and charged immediately, which is what the portal's confirm page
// shows. A move to a cheaper plan produces a credit on the next bill instead.
//
// Who may: staff of this tenant who can edit billing (head_admin, admin, a
// manager with an editor grant on Settings › Subscription), or a super admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { authorizeTenantAccess } from "../_shared/tenant-auth.ts";
import { fetchSignupPlan } from "../_shared/signup-plans.ts";
import { getOrCreateSignupPrice } from "../_shared/signup-stripe.ts";

const LOG = "[change-subscription-plan-v2]";
const LIVE_STATUSES = ["active", "trialing", "past_due"];

interface Target {
  priceId: string;
  productId: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: string;
  description: string | null;
  features: string[];
  /** The tenant's subscription_plans row, when it already exists. */
  planRowId: string | null;
}

async function canEditBilling(supabase: any, appUserId: string, isSuperAdmin: boolean): Promise<boolean> {
  if (isSuperAdmin) return true;
  const { data: me } = await supabase.from("app_users").select("role").eq("id", appUserId).maybeSingle();
  const role = me?.role as string | undefined;
  if (role === "head_admin" || role === "admin") return true;
  if (role !== "manager") return false;
  const { data: grant } = await supabase
    .from("manager_permissions")
    .select("access_level")
    .eq("app_user_id", appUserId)
    .eq("tab_key", "settings.subscription")
    .maybeSingle();
  return grant?.access_level === "editor";
}

/** The Stripe Price for the chosen plan, on THIS tenant's billing account. */
async function resolveTarget(
  supabase: any,
  stripe: any,
  tenantId: string,
  account: "uk" | "uae",
  mode: "test" | "live",
  planKey: unknown,
  planId: unknown,
): Promise<Target | { error: string; status: number }> {
  // A per-tenant plan the super admin set up.
  if (typeof planId === "string" && planId) {
    const { data: row } = await supabase
      .from("subscription_plans")
      .select("id, name, description, features, amount, currency, interval, stripe_price_id, stripe_product_id, stripe_account, is_active")
      .eq("id", planId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!row || !row.is_active) return { error: "That plan isn't available.", status: 404 };
    if (!row.stripe_price_id) return { error: "That plan has no price set up yet.", status: 409 };
    if (row.stripe_account && row.stripe_account !== account) {
      return { error: "That plan is on a different billing account. Please contact support.", status: 409 };
    }
    return {
      priceId: row.stripe_price_id,
      productId: row.stripe_product_id,
      name: row.name,
      amountCents: row.amount,
      currency: row.currency,
      interval: row.interval,
      description: row.description,
      features: Array.isArray(row.features) ? row.features : [],
      planRowId: row.id,
    };
  }

  // One of the site's self-serve plans.
  const plan = await fetchSignupPlan(supabase, planKey);
  if (!plan) return { error: "Unknown plan.", status: 400 };

  let priceId: string;
  let productId: string;
  if (account === "uae") {
    // Signup's home account: the exact Price the admin set, else by lookup_key.
    if (plan.stripePriceId) {
      const p = await stripe.prices.retrieve(plan.stripePriceId);
      priceId = p.id;
      productId = typeof p.product === "string" ? p.product : p.product.id;
    } else {
      ({ priceId, productId } = await getOrCreateSignupPrice(stripe, plan, mode));
    }
  } else {
    // A legacy UK-account tenant: use the plan's Price there if one exists, and
    // never create one from here (signup-stripe's price cache is per mode, not
    // per account, so it must not be used across accounts).
    const found = await stripe.prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 1 });
    const p = found.data[0];
    if (!p) return { error: "This plan isn't set up on your billing account yet. Please contact support.", status: 409 };
    priceId = p.id;
    productId = typeof p.product === "string" ? p.product : p.product.id;
  }

  // Reuse the tenant's row for this price if it has one.
  const { data: existing } = await supabase
    .from("subscription_plans")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("stripe_price_id", priceId)
    .maybeSingle();

  return {
    priceId,
    productId,
    name: plan.name,
    amountCents: plan.amountCents,
    currency: plan.currency,
    interval: plan.interval,
    description: plan.tagline,
    features: plan.features,
    planRowId: existing?.id ?? null,
  };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
    const action = body.action === "confirm" ? "confirm" : "session";
    if (!tenantId) return errorResponse("tenantId is required");

    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);
    if (!(await canEditBilling(supabase, access.appUser.id, access.appUser.is_super_admin))) {
      return errorResponse("You don't have permission to change the plan.", 403);
    }

    // The live subscription, and never anything but this tenant's.
    const { data: live } = await supabase
      .from("tenant_subscriptions")
      .select("id, stripe_subscription_id, status, plan_name")
      .eq("tenant_id", tenantId)
      .in("status", LIVE_STATUSES)
      .maybeSingle();
    if (!live?.stripe_subscription_id) return errorResponse("There's no active subscription to change.", 404);
    if (live.status === "past_due") {
      return errorResponse("Please pay your outstanding invoice before changing plan.", 409);
    }

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    const account = await getTenantSubscriptionAccount(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    const sub = await stripe.subscriptions.retrieve(live.stripe_subscription_id);
    const item = sub.items?.data?.[0];
    if (!item) return errorResponse("The subscription has no plan on it. Please contact support.", 409);
    const currentPriceId: string = item.price.id;
    const currentProductId: string = typeof item.price.product === "string" ? item.price.product : item.price.product.id;

    const target = await resolveTarget(supabase, stripe, tenantId, account, mode, body.planKey, body.planId);
    if ("error" in target) return errorResponse(target.error, target.status);

    // ── after the return: record the change, if it happened ───────────────
    if (action === "confirm") {
      if (currentPriceId !== target.priceId) return jsonResponse({ changed: false });

      let planRowId = target.planRowId;
      if (!planRowId) {
        const { data: row, error } = await supabase
          .from("subscription_plans")
          .insert({
            tenant_id: tenantId,
            name: target.name,
            description: target.description,
            features: target.features,
            amount: target.amountCents,
            currency: target.currency,
            interval: target.interval,
            stripe_price_id: target.priceId,
            stripe_product_id: target.productId,
            stripe_account: account,
            trial_days: 0,
            is_active: true,
            sort_order: 0,
          })
          .select("id")
          .single();
        if (error || !row) {
          console.error(`${LOG} plan row insert failed for ${tenantId}:`, error);
          return errorResponse("The plan changed, but we couldn't record it. Please contact support.", 500);
        }
        planRowId = row.id;
      }

      // subscription-webhook reads these on the customer.subscription.updated
      // this triggers, and syncs plan_id / plan_name onto tenant_subscriptions.
      if (sub.metadata?.plan_id !== planRowId || sub.metadata?.plan_name !== target.name) {
        await stripe.subscriptions.update(sub.id, {
          metadata: { ...(sub.metadata ?? {}), plan_id: planRowId, plan_name: target.name },
        });
      }
      console.log(`${LOG} tenant ${tenantId} now on ${target.name} (${target.priceId})`);
      return jsonResponse({ changed: true, planName: target.name });
    }

    // ── the session: Stripe's hosted confirm page ─────────────────────────
    if (currentPriceId === target.priceId) return errorResponse("You're already on that plan.", 409);
    const returnUrl = typeof body.returnUrl === "string" ? body.returnUrl : "";
    if (!/^https?:\/\//.test(returnUrl)) return errorResponse("returnUrl is required");

    let promotionCodeId: string | null = null;
    if (typeof body.promoCode === "string" && body.promoCode.trim()) {
      const found = await stripe.promotionCodes.list({ code: body.promoCode.trim(), active: true, limit: 1 });
      promotionCodeId = found.data[0]?.id ?? null;
      if (!promotionCodeId) return errorResponse("That promo code can't be used here.", 400);
    }

    // Allowed moves for this flow only: the current price and the target, each
    // under its product. A fresh configuration per session, as
    // create-subscription-portal-session does, so the account's default portal
    // settings (plan changes off) are never touched.
    const products = new Map<string, Set<string>>();
    products.set(currentProductId, new Set([currentPriceId]));
    (products.get(target.productId) ?? products.set(target.productId, new Set()).get(target.productId)!).add(target.priceId);

    const configuration = await stripe.billingPortal.configurations.create({
      business_profile: { headline: "Change your Drive247 plan" },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: false },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price", "promotion_code"],
          proration_behavior: "always_invoice",
          products: [...products].map(([product, prices]) => ({ product, prices: [...prices] })),
        },
      },
    });

    const session = await stripe.billingPortal.sessions.create({
      customer: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      configuration: configuration.id,
      return_url: returnUrl,
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: sub.id,
          items: [{ id: item.id, price: target.priceId, quantity: item.quantity ?? 1 }],
          ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
        },
        after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
      },
    });

    console.log(`${LOG} session for tenant ${tenantId}: ${currentPriceId} → ${target.priceId} (${account}/${mode})`);
    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error(`${LOG} failed:`, error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
