// =============================================================================
// signup-payment-intent — step 2, inline payment. No Stripe Checkout redirect.
//
// Creates (or reuses) a Stripe Customer and a `default_incomplete` Subscription
// on the UAE platform account, and hands the browser back the first invoice's
// PaymentIntent client secret plus the matching publishable key. The Payment
// Element then confirms it in place, so the user never leaves the dialog.
//
// THE ORDERING TRAP (read this before adding metadata)
// ----------------------------------------------------
// Neither the Customer nor the Subscription carries a `tenant_id`, because the
// tenant DOES NOT EXIST YET. `subscription-webhook` resolves the tenant solely
// from Stripe `metadata.tenant_id`, and `tenant_subscriptions.tenant_id` is NOT
// NULL with an FK to `tenants`. A `tenant_id` pointing at a row that does not
// exist would make handleSubscriptionUpdated update 0 rows, fall through to
// insertMissingSubscription, and hit FK violation 23503 — which is re-thrown
// (only 23505 is swallowed) into an HTTP 500. Stripe then retries for ~3 days,
// and sustained 5xx can make Stripe auto-disable the endpoint, killing
// subscription event delivery for EVERY tenant on the platform.
//
// With no tenant_id, every webhook handler hits its own "no tenant" guard and
// returns 200 as a no-op. That is correct, intended and harmless. The cost is
// that the first `invoice.paid` is silently dropped — `signup-provision` step
// 7d backfills it, and attaches the tenant_id at step 7c once the tenant is
// real.
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getSignupPlan, type SignupPlanServer } from "../_shared/signup-plans.ts";
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

const LOG = "[signup-payment-intent]";
const HOUR_MS = 60 * 60 * 1000;

/** Statuses that mean this subscription is already paid for. */
const PAID_STATUSES = new Set(["active", "trialing"]);
/** Statuses that mean the old attempt is dead and a NEW one must be created. */
const DEAD_STATUSES = new Set(["incomplete_expired", "canceled"]);

/** The client secret Stripe put on the first invoice of an incomplete sub. */
function clientSecretOf(sub: any): string | null {
  const pi = sub?.latest_invoice?.payment_intent;
  return typeof pi?.client_secret === "string" ? pi.client_secret : null;
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
    return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500, {
      env: missing,
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return signupError("UNAUTHENTICATED", "Missing authorization header", 401);
    }
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) return signupError("UNAUTHENTICATED", "Unauthorized", 401);

    const meta = readSignupMeta(user);
    if (!meta) return signupError("SIGNUP_NOT_FOUND", "No signup in progress", 404);
    if (meta.status === "provisioned") {
      return signupError("ALREADY_PROVISIONED", "This signup is already complete", 409);
    }

    let body: { planId?: string };
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
    if (!allowed) {
      return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);
    }

    // -----------------------------------------------------------------------
    // Which plan is being charged.
    //
    // Once the money has moved the plan is FIXED: a paid user re-opening the
    // dialog on a different card must not silently be re-priced, and support
    // (not this endpoint) moves them. Before payment, switching plans is free.
    // -----------------------------------------------------------------------
    const alreadyCommitted = meta.status === "paid" || meta.status === "provisioning";
    const requested = getSignupPlan(alreadyCommitted ? meta.planId : body?.planId ?? meta.planId);
    if (!requested) return signupError("PLAN_UNKNOWN", "Unknown plan", 400);
    const plan: SignupPlanServer = requested;

    // Mode is locked at account creation — see signup-state.ts.
    const mode = meta.mode ?? getSignupStripeMode();

    let stripe;
    let publishableKey: string;
    try {
      stripe = getSignupStripeClient(mode);
      publishableKey = getSignupPublishableKey(mode);
    } catch (e) {
      if (e instanceof SignupConfigError) {
        // Loud and specific: the alternative is a blank card area with no clue
        // which secret is missing.
        console.error(`${LOG} CONFIG_MISSING: ${e.env} is not set`);
        return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500, {
          env: e.env,
        });
      }
      throw e;
    }

    let paymentAttempts = meta.paymentAttempts ?? 0;
    let customerId = meta.stripeCustomerId ?? null;
    let subscriptionId = meta.stripeSubscriptionId ?? null;

    try {
      // ---------------------------------------------------------------------
      // 1. Reuse an existing subscription wherever it is still usable. This is
      //    what makes the endpoint idempotent: entering step 2, refreshing, and
      //    entering it again must not spawn three subscriptions.
      // ---------------------------------------------------------------------
      if (subscriptionId) {
        let existing: any = null;
        try {
          existing = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["latest_invoice.payment_intent"],
          });
        } catch (e) {
          // Not on this account, or deleted. Fall through and make a new one.
          console.warn(`${LOG} could not retrieve ${subscriptionId} on uae/${mode}:`, e);
        }

        if (existing) {
          // Compared against the plan the EXISTING subscription was created
          // for (meta.planId), not against the request — comparing the request
          // to itself is always false and would silently keep charging the old
          // amount after a plan switch.
          const planChanged = plan.id !== meta.planId;

          if (PAID_STATUSES.has(existing.status)) {
            // Already paid. Never charge again, never offer a card form.
            await writeSignupMeta(supabase, user.id, {
              status: "paid",
              paidAt: meta.paidAt ?? new Date().toISOString(),
              // Stripe's own answer wins over whatever metadata remembered.
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
              currency: plan.currency,
              mode,
              alreadyPaid: true,
            });
          }

          if (existing.status === "incomplete" && !planChanged) {
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
                amountCents: plan.amountCents,
                currency: plan.currency,
                mode,
                alreadyPaid: false,
              });
            }
            console.warn(`${LOG} subscription ${existing.id} is incomplete with no client secret`);
          }

          // Plan changed before paying: cancel the stale incomplete
          // subscription FIRST. Two live subscriptions for one tenant would
          // collide with the partial unique index on tenant_subscriptions and
          // strand one of them permanently.
          if (existing.status === "incomplete" && planChanged) {
            try {
              await stripe.subscriptions.cancel(existing.id);
              console.log(`${LOG} cancelled incomplete ${existing.id} — plan changed to ${plan.id}`);
            } catch (e) {
              console.warn(`${LOG} could not cancel ${existing.id} (non-fatal):`, e);
            }
          }

          if (DEAD_STATUSES.has(existing.status)) {
            console.log(`${LOG} previous subscription ${existing.id} is ${existing.status} — starting a fresh attempt`);
          }
          customerId = (existing.customer as string) ?? customerId;
        }

        // We are about to create a REPLACEMENT subscription, and that needs a
        // new idempotency key — reusing the old one makes Stripe replay the
        // dead subscription verbatim and hand back a client secret that can
        // never be confirmed.
        //
        // THIS MUST SIT OUTSIDE `if (existing)`. It used to be inside it, with a
        // comment claiming it ran "unconditionally" — but the retrieve above can
        // fail (subscription on another account, deleted, or a transient Stripe
        // error), leaving `existing` null and falling straight through to the
        // create with the counter UNCHANGED. Stripe keeps idempotency records for
        // 24h and an `incomplete` subscription expires at ~23h, so inside that
        // overlap the replay returns the original subscription and its long-dead
        // PaymentIntent — a client secret Stripe.js will never mount, which is
        // indistinguishable to the user from the payment form being broken.
        //
        // Every early return above (already paid, reusable incomplete) has
        // already left the function, so reaching here always means "replace".
        paymentAttempts += 1;
        subscriptionId = null;
      }

      // ---------------------------------------------------------------------
      // 2. Customer.
      // ---------------------------------------------------------------------
      if (customerId) {
        try {
          const existingCustomer: any = await stripe.customers.retrieve(customerId);
          if (existingCustomer?.deleted) customerId = null;
        } catch {
          // Belongs to another account (or was purged) — never reuse it.
          console.warn(`${LOG} customer ${customerId} is not on uae/${mode}; creating a new one`);
          customerId = null;
        }
      }

      // Narrowed to a plain `string` from here on: either we verified an
      // existing customer above, or we create one now. The idempotency key is
      // the auth user id, so a retried request reuses the same Customer rather
      // than littering the account with one per attempt.
      let stripeCustomerId: string;
      if (customerId) {
        stripeCustomerId = customerId;
      } else {
        const customer = await stripe.customers.create(
          {
            email: meta.email,
            name: meta.fullName,
            metadata: {
              d247_signup_auth_user: user.id,
              source: "self_serve_signup",
              // NO tenant_id — see the header comment.
            },
          },
          { idempotencyKey: `signup-cus-${user.id}` },
        );
        stripeCustomerId = customer.id as string;
      }

      // ---------------------------------------------------------------------
      // 3. Price — one shared Price per plan, resolved by lookup_key.
      // ---------------------------------------------------------------------
      const { priceId } = await getOrCreateSignupPrice(stripe, plan, mode);

      // ---------------------------------------------------------------------
      // 4. Subscription, incomplete until the card confirms.
      //
      // `payment_method_types: ["card"]` is load-bearing: card is the only
      // method whose 3DS challenge renders in Stripe's own iframe. Allowing a
      // redirect-based method would bounce the user out of the dialog and lose
      // the whole in-place flow.
      // ---------------------------------------------------------------------
      const subscription = await stripe.subscriptions.create(
        {
          customer: stripeCustomerId,
          items: [{ price: priceId }],
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
            // NO tenant_id — see the header comment.
          },
        },
        { idempotencyKey: `signup-sub-${user.id}-${plan.id}-${paymentAttempts}` },
      );

      const clientSecret = clientSecretOf(subscription);
      if (!clientSecret) {
        // Stripe accepted the subscription but gave us nothing to confirm. The
        // subscription is `incomplete`, so nothing has been charged.
        console.error(`${LOG} no client secret on new subscription ${subscription.id}`);
        return signupError(
          "STRIPE_UNAVAILABLE",
          "We couldn't start the payment. No charge was made.",
          502,
        );
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
        metadata: { mode, amountCents: plan.amountCents, attempt: paymentAttempts },
      });

      console.log(
        `${LOG} subscription ${subscription.id} (${plan.id}, uae/${mode}) awaiting payment for ${meta.email}`,
      );

      return jsonResponse({
        success: true,
        clientSecret,
        publishableKey,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        amountCents: plan.amountCents,
        currency: plan.currency,
        mode,
        alreadyPaid: false,
      });
    } catch (e) {
      // Everything above is either a read or a create that leaves the
      // subscription `incomplete`, so there is nothing to unwind and nothing
      // has been charged. Say exactly that.
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
      return signupError(
        "STRIPE_UNAVAILABLE",
        "We couldn't reach our payment provider. No charge was made.",
        502,
      );
    }
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return signupError("INTERNAL", (error as Error)?.message || "Internal server error", 500);
  }
});
