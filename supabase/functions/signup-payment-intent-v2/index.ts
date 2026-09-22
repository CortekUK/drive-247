// =============================================================================
// signup-payment-intent-v2 — self-serve step 2 WITH a Drive247 platform promo
// code (a Drive247 campaign code, or another operator's referral code).
//
// A copy of `signup-payment-intent` (V2_PLAN §7: never change an existing edge
// function) with one addition: body `promoCode`. The onboarding dialog calls
// this function only when the visitor carries a code; without one it keeps
// calling the original. Everything else is the original's behaviour:
//   - the same idempotent reuse of an incomplete subscription,
//   - the same Customer, Price and `default_incomplete` Subscription,
//   - NO tenant_id on anything Stripe holds — the tenant does not exist yet,
//     see the original's header for why that matters.
//
// The code's coupon is minted for the plan's own product (applies_to) and
// attached directly. The response's amountCents is Stripe's own first-invoice
// amount, so the card form confirms exactly the discounted figure shown.
// The redemption and the referral are recorded by the referral engine once the
// operator is provisioned (it finds the coupon on the new subscription).
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { fetchSignupPlan, type SignupPlanServer } from "../_shared/signup-plans.ts";
import {
  getOrCreateSignupPrice,
  getSignupPublishableKey,
  getSignupStripeClient,
  getSignupStripeMode,
  SignupConfigError,
} from "../_shared/signup-stripe.ts";
import {
  checkThrottle,
  clientIp,
  readSignupMeta,
  recordAttempt,
  signupError,
  writeSignupMeta,
} from "../_shared/signup-state.ts";
import {
  checkCodeUsable,
  ensureCodeCoupon,
  findCode,
  productForPrice,
  publicCodeView,
  type PromoCodeRow,
} from "../_shared/platform-promo.ts";

const LOG = "[signup-payment-intent-v2]";
const HOUR_MS = 60 * 60 * 1000;

const PAID_STATUSES = new Set(["active", "trialing"]);
const DEAD_STATUSES = new Set(["incomplete_expired", "canceled"]);

function clientSecretOf(sub: any): string | null {
  const pi = sub?.latest_invoice?.payment_intent;
  return typeof pi?.client_secret === "string" ? pi.client_secret : null;
}

/** What the first invoice actually asks for (the discount already applied). */
function amountDueOf(sub: any, fallback: number): number {
  const due = sub?.latest_invoice?.amount_due;
  return typeof due === "number" ? due : fallback;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    const missing = !supabaseUrl ? "SUPABASE_URL" : "SUPABASE_SERVICE_ROLE_KEY";
    console.error(`${LOG} CONFIG_MISSING: ${missing} is not set`);
    return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500, { env: missing });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return signupError("UNAUTHENTICATED", "Missing authorization header", 401);
    }
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return signupError("UNAUTHENTICATED", "Unauthorized", 401);

    const meta = readSignupMeta(user);
    if (!meta) return signupError("SIGNUP_NOT_FOUND", "No signup in progress", 404);
    if (meta.status === "provisioned") {
      return signupError("ALREADY_PROVISIONED", "This signup is already complete", 409);
    }

    let body: { planId?: string; promoCode?: string };
    try {
      body = await req.json();
    } catch {
      return signupError("INVALID_BODY", "Invalid JSON body", 400);
    }

    const allowed = await checkThrottle(supabase, [
      { scope: "signup_payment_intent", key: user.id, limit: 10, windowMs: HOUR_MS },
    ]);
    await recordAttempt(supabase, {
      scope: "payment_intent",
      ip_address: clientIp(req),
      email: meta.email,
      auth_user_id: user.id,
      plan_id: meta.planId,
      outcome: allowed ? "allowed" : "blocked",
      throttleScope: "signup_payment_intent",
      throttleKey: user.id,
    });
    if (!allowed) return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);

    const alreadyCommitted = meta.status === "paid" || meta.status === "provisioning";
    const requested = await fetchSignupPlan(supabase, alreadyCommitted ? meta.planId : body?.planId ?? meta.planId);
    if (!requested) return signupError("PLAN_UNKNOWN", "Unknown plan", 400);
    const plan: SignupPlanServer = requested;

    // ── the promo code, checked with the same rules as everywhere else ──────
    // A brand-new signup has no tenant yet, so "new operators only" and
    // self-referral hold by construction; the plan limit is checked here.
    let promo: PromoCodeRow | null = null;
    if (typeof body?.promoCode === "string" && body.promoCode.trim() && !alreadyCommitted) {
      const found = await findCode(supabase, body.promoCode);
      if (!found.ok) return signupError("PROMO_INVALID", "That promo code can't be used.", 400, { reason: found.reason });
      const usable = await checkCodeUsable(supabase, found.code, { channel: "self_serve", planKey: plan.id });
      if (!usable.ok) return signupError("PROMO_INVALID", "That promo code can't be used.", 400, { reason: usable.reason });
      promo = found.code;
    }
    const promoView = promo ? await publicCodeView(supabase, promo) : null;

    const mode = meta.mode ?? getSignupStripeMode();

    let stripe;
    let publishableKey: string;
    try {
      stripe = getSignupStripeClient(mode);
      publishableKey = getSignupPublishableKey(mode);
    } catch (e) {
      if (e instanceof SignupConfigError) {
        console.error(`${LOG} CONFIG_MISSING: ${e.env} is not set`);
        return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500, { env: e.env });
      }
      throw e;
    }

    let paymentAttempts = meta.paymentAttempts ?? 0;
    let customerId = meta.stripeCustomerId ?? null;
    let subscriptionId = meta.stripeSubscriptionId ?? null;

    try {
      // 1. Reuse an existing subscription wherever it is still usable.
      if (subscriptionId) {
        let existing: any = null;
        try {
          existing = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.payment_intent"] });
        } catch (e) {
          console.warn(`${LOG} could not retrieve ${subscriptionId} on uae/${mode}:`, e);
        }

        if (existing) {
          const planChanged = plan.id !== meta.planId;
          const item = existing.items?.data?.[0];
          const existingPriceId: string | null = item?.price?.id ?? null;
          const existingAmount: number | null =
            typeof item?.price?.unit_amount === "number"
              ? item.price.unit_amount * (typeof item?.quantity === "number" ? item.quantity : 1)
              : null;
          const priceChanged =
            (!!plan.stripePriceId && !!existingPriceId && existingPriceId !== plan.stripePriceId) ||
            (existingAmount !== null && existingAmount !== plan.amountCents) ||
            (!plan.stripePriceId && !!item?.price?.lookup_key && item.price.lookup_key !== plan.lookupKey);
          // A different code (or adding/removing one) changes what the first
          // invoice asks for, so the old incomplete subscription is stale too.
          const promoChanged = (existing.metadata?.d247_promo_code_id ?? "") !== (promo?.id ?? "");
          const stale = planChanged || priceChanged || promoChanged;

          if (PAID_STATUSES.has(existing.status)) {
            await writeSignupMeta(supabase, user.id, {
              status: "paid",
              paidAt: meta.paidAt ?? new Date().toISOString(),
              stripeCustomerId: (existing.customer as string) ?? customerId ?? undefined,
              stripeSubscriptionId: existing.id,
            });
            return jsonResponse({
              success: true,
              clientSecret: null,
              publishableKey,
              stripeCustomerId: (existing.customer ?? customerId) as string,
              stripeSubscriptionId: existing.id,
              amountCents: plan.amountCents,
              listAmountCents: plan.amountCents,
              currency: plan.currency,
              mode,
              alreadyPaid: true,
              promo: null,
            });
          }

          if (existing.status === "incomplete" && !stale) {
            const secret = clientSecretOf(existing);
            if (secret) {
              await writeSignupMeta(supabase, user.id, {
                status: "payment_pending",
                stripeCustomerId: (existing.customer as string) ?? customerId ?? undefined,
                stripeSubscriptionId: existing.id,
              });
              return jsonResponse({
                success: true,
                clientSecret: secret,
                publishableKey,
                stripeCustomerId: existing.customer as string,
                stripeSubscriptionId: existing.id,
                amountCents: amountDueOf(existing, plan.amountCents),
                listAmountCents: plan.amountCents,
                currency: plan.currency,
                mode,
                alreadyPaid: false,
                promo: promoView,
              });
            }
            console.warn(`${LOG} subscription ${existing.id} is incomplete with no client secret`);
          }

          if (existing.status === "incomplete" && stale) {
            try {
              await stripe.subscriptions.cancel(existing.id);
              console.log(`${LOG} cancelled stale incomplete ${existing.id} (plan/price/promo changed)`);
            } catch (e) {
              console.warn(`${LOG} could not cancel ${existing.id} (non-fatal):`, e);
            }
          }
          if (DEAD_STATUSES.has(existing.status)) {
            console.log(`${LOG} previous subscription ${existing.id} is ${existing.status} — starting a fresh attempt`);
          }
          customerId = (existing.customer as string) ?? customerId;
        }
        // A replacement subscription needs a new idempotency key (see the
        // original: reusing it replays the dead subscription verbatim).
        paymentAttempts += 1;
        subscriptionId = null;
      }

      // 2. Customer.
      if (customerId) {
        try {
          const existingCustomer: any = await stripe.customers.retrieve(customerId);
          if (existingCustomer?.deleted) customerId = null;
        } catch {
          console.warn(`${LOG} customer ${customerId} is not on uae/${mode}; creating a new one`);
          customerId = null;
        }
      }
      let stripeCustomerId: string;
      if (customerId) {
        stripeCustomerId = customerId;
      } else {
        const customer = await stripe.customers.create(
          {
            email: meta.email,
            name: meta.fullName,
            metadata: { d247_signup_auth_user: user.id, source: "self_serve_signup" },
          },
          { idempotencyKey: `signup-cus-${user.id}` },
        );
        stripeCustomerId = customer.id as string;
      }

      // 3. Price.
      const priceId = plan.stripePriceId
        ? plan.stripePriceId
        : (await getOrCreateSignupPrice(stripe, plan, mode)).priceId;

      // 3b. The code's coupon, for this plan's product only. Self-serve has no
      // trial, so the standard terms apply as they are.
      let discounts: Array<{ coupon: string }> = [];
      if (promo) {
        const productId = await productForPrice(stripe as never, priceId);
        const { couponId } = await ensureCodeCoupon(supabase, stripe as never, promo, {
          account: "uae", mode, productId, trialDays: 0,
        });
        discounts = [{ coupon: couponId }];
      }

      // 4. Subscription, incomplete until the card confirms.
      const subscription = await stripe.subscriptions.create(
        {
          customer: stripeCustomerId,
          items: [{ price: priceId }],
          ...(discounts.length ? { discounts } : {}),
          payment_behavior: "default_incomplete",
          payment_settings: {
            payment_method_types: ["card"],
            save_default_payment_method: "on_subscription",
          },
          expand: ["latest_invoice.payment_intent"],
          metadata: {
            d247_signup: "pending",
            d247_signup_auth_user: user.id,
            signup_email: meta.email,
            plan_id: plan.id,
            plan_name: plan.name,
            ...(promo ? { d247_promo_code_id: promo.id, d247_promo_code: promo.code } : {}),
          },
        } as never,
        // The code is part of the key: the same attempt with a different code
        // is a different subscription.
        { idempotencyKey: `signup-sub-${user.id}-${plan.id}-${paymentAttempts}-${promo?.id ?? "none"}` },
      );

      const clientSecret = clientSecretOf(subscription);
      if (!clientSecret) {
        console.error(`${LOG} no client secret on new subscription ${subscription.id}`);
        return signupError("STRIPE_UNAVAILABLE", "We couldn't start the payment. No charge was made.", 502);
      }

      await writeSignupMeta(supabase, user.id, {
        status: "payment_pending",
        planId: plan.id,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        paymentAttempts,
      });

      await recordAttempt(supabase, {
        scope: "payment_intent",
        email: meta.email,
        auth_user_id: user.id,
        plan_id: plan.id,
        outcome: "ok",
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: subscription.id,
        metadata: { mode, amountCents: plan.amountCents, attempt: paymentAttempts, promo: promo?.code ?? null },
      });

      return jsonResponse({
        success: true,
        clientSecret,
        publishableKey,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        amountCents: amountDueOf(subscription, plan.amountCents),
        listAmountCents: plan.amountCents,
        currency: plan.currency,
        mode,
        alreadyPaid: false,
        promo: promoView,
      });
    } catch (e) {
      console.error(`${LOG} Stripe call failed:`, e);
      await recordAttempt(supabase, {
        scope: "payment_intent",
        email: meta.email,
        auth_user_id: user.id,
        plan_id: plan.id,
        outcome: "error",
        error_code: "STRIPE_UNAVAILABLE",
        metadata: { message: (e as Error)?.message ?? "unknown" },
      });
      return signupError("STRIPE_UNAVAILABLE", "We couldn't reach our payment provider. No charge was made.", 502);
    }
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return signupError("INTERNAL", (error as Error)?.message || "Internal server error", 500);
  }
});
