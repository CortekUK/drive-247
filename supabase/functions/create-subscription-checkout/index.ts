import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { authorizeTenantAccess } from "../_shared/tenant-auth.ts";
import { PLATFORM_TOS_VERSION, PLATFORM_TOS_URL } from "../_shared/platform-tos.ts";

const STRIPE_PRODUCT_NAME = "Drive247 Platform Subscription";

/**
 * Stripe's native terms-of-service consent on the hosted Checkout page.
 *
 * This is the only NON-BYPASSABLE consent gate in the flow: Stripe refuses to
 * complete the session until the box is ticked, and records the result on
 * `session.consent.terms_of_service`. The in-app checkbox in PricingCard is UX
 * and an in-app record; it cannot be the enforcement point, because a client
 * boolean only ever attests that the caller's own code sent `true`.
 *
 * IT IS OFF BY DEFAULT AND MUST STAY OFF UNTIL CONFIGURED. Stripe rejects
 * `consent_collection.terms_of_service` with a 400 unless a Terms of Service URL
 * is set on the account (Settings → Checkout and Payment Links → "Terms of
 * service URL"). That has to be done on FOUR account/mode combinations —
 * uk/test, uk/live, uae/test, uae/live — because this codebase routes tenants
 * across two platform Stripe accounts in two modes. Enabling it before all four
 * are set would 400 the checkout call, which surfaces to the tenant as a generic
 * toast on an inescapable paywall with no way out.
 *
 * Turn on with: supabase secrets set STRIPE_TOS_CONSENT_ENABLED=true
 */
const STRIPE_TOS_CONSENT_ENABLED =
  (Deno.env.get("STRIPE_TOS_CONSENT_ENABLED") ?? "").toLowerCase() === "true";

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

    const { tenantId, planId, successUrl, cancelUrl, acceptedTos } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");
    if (!planId) return errorResponse("planId is required");
    if (!successUrl) return errorResponse("successUrl is required");
    if (!cancelUrl) return errorResponse("cancelUrl is required");

    // `acceptedTos` is deliberately NOT a hard requirement, and that is a
    // considered decision rather than an oversight.
    //
    // Rejecting the request when the flag is missing would buy nothing: an
    // attacker simply sends `true`. A client boolean can only ever attest that
    // the caller's own code sent it, so it has no evidentiary value and no
    // security value. What a hard reject WOULD do is lock tenants out during any
    // window where the deployed edge function is ahead of the deployed portal
    // bundle — and the surface it locks is the non-dismissible paywall modal,
    // whose only other exit is signing out. All cost, no benefit.
    //
    // Enforcement therefore lives where it cannot be forged: Stripe's
    // consent_collection on the hosted page (see STRIPE_TOS_CONSENT_ENABLED),
    // whose result the subscription-webhook reads back off the completed
    // session. This flag records the in-app acceptance moment when it is
    // genuinely present.
    const tosAcceptedByClient = acceptedTos === true;

    // Membership check — see _shared/tenant-auth.ts. Without it any signed-in
    // user could start a subscription billed to another operator.
    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    // Only the OPERATOR can accept the operator's contract. authorizeTenantAccess
    // deliberately lets super admins through for every tenant, so a super admin
    // driving checkout on someone's behalf would otherwise mint a consent record
    // the operator never gave. Computed here (not at the stamp site) because the
    // session metadata below must be gated on it too — otherwise the webhook
    // happily writes the record that this function refused to.
    const actorIsOperator = access.appUser?.is_super_admin !== true;
    const recordAcceptance = tosAcceptedByClient && actorIsOperator;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      // Deliberately does NOT select platform_tos_accepted_at. PostgREST fails
      // the WHOLE query on an unknown column, and the guard below turns any
      // tenant-select error into a 404 — so naming a column that does not exist
      // yet would make every subscription checkout return "Tenant not found"
      // in any window where this function is deployed ahead of the migration.
      // The write-once guarantee does not need a pre-read: the UPDATE carries
      // `.is("platform_tos_accepted_at", null)`, which is also race-safe in a
      // way a read-then-write never is.
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

    // Build line items: fixed plan price + $1 card verification.
    // The metered e-sign usage price is intentionally NOT added as a checkout
    // line item — Stripe renders it as a confusing second "Drive247 Platform
    // Subscription" row (it shares the product) that clutters the checkout. We
    // instead attach it to the subscription SILENTLY in the subscription-webhook
    // right after checkout completes, so per-signature billing still works but
    // the tenant never sees the usage line at signup. Its id is passed through
    // session metadata (`esign_metered_price_id`) so the webhook uses the exact
    // price for this account/mode.
    const lineItems: Array<any> = [
      { price: priceId, quantity: 1 },
    ];
    // Metered price ids are account-specific: never attach the UK price id to a
    // UAE subscription (it doesn't exist on that account).
    const meteredPriceId = account === "uae"
      ? (mode === "live"
          ? Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_LIVE")
          : Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_TEST"))
      : (mode === "live"
          ? Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_LIVE")
          : (Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_TEST") || Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID")));

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
          product_data: { name: "Card verification — $1.00, refunded instantly (net $0 today)" },
          unit_amount: 100, // $1.00
        },
        quantity: 1,
      });
    }

    // REUSE an existing Stripe customer when we already have one; only fall back
    // to customer_email for a tenant we have never billed.
    //
    // customer_email lets Stripe mint a NEW customer at checkout, which keeps the
    // email field editable (the reason the original note below warns against
    // `customer:`). That is right the FIRST time — a tenant may want billing to
    // go to a finance inbox rather than their login. It is wrong every time
    // after: each retry or resubscribe spawned another customer for the same
    // tenant, scattering their payment methods and billing history across
    // several. One tenant accumulated three in a single morning.
    //
    // It also makes the flow testable. A Stripe test clock can only ever hold a
    // customer that was CREATED on it, so while checkout always minted its own
    // customer, a subscription made through the portal could never be attached to
    // a clock — and the tenant-facing billing flow could not be fast-forwarded at
    // all. Point tenants.stripe_subscription_customer_id at a clock customer and
    // the ordinary portal checkout now lands on that clock.
    let existingCustomerId = tenant.stripe_subscription_customer_id || null;

    // A customer id belongs to ONE Stripe account. tenants.stripe_subscription_customer_id
    // survives a uk→uae migration untouched, so reusing it blindly hands a UK
    // customer to the UAE account and Stripe answers "No such customer" — which
    // the catch below turns into a 500 and the tenant sees as a generic toast.
    // They can never subscribe, and the billing-portal fallback needs a live
    // subscription row they do not have, so there is no way out.
    //
    // The plan's price gets exactly this treatment a few lines up; the customer
    // was simply missed. Verify it the same way and drop it if it is foreign —
    // checkout then mints a fresh customer on the correct account.
    if (existingCustomerId) {
      try {
        const existing = await stripe.customers.retrieve(existingCustomerId);
        if ((existing as any)?.deleted) {
          console.log(`Customer ${existingCustomerId} is deleted on ${account}/${mode}; creating a new one`);
          existingCustomerId = null;
        }
      } catch (_e) {
        console.log(
          `Customer ${existingCustomerId} is not on the ${account}/${mode} account (likely pre-migration); creating a new one`
        );
        existingCustomerId = null;
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Prefilled but EDITABLE email — do NOT switch this back to `customer:`
      // for a first-time tenant, as that locks the email field in Stripe Checkout.
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: tenant.contact_email }),
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // setup_fee flags the webhook to auto-refund the $1 verification. Only set it
      // when the $1 was actually added (deferred-charge plans); a charge-now plan has
      // no $1 to refund and must keep its full first-period charge.
      // Stripe's own acceptance gate on the hosted page. Non-bypassable, and the
      // outcome lands on session.consent.terms_of_service for the webhook to
      // read back. Env-gated because it 400s unless a ToS URL is configured on
      // this Stripe account — see STRIPE_TOS_CONSENT_ENABLED at the top.
      ...(STRIPE_TOS_CONSENT_ENABLED
        ? { consent_collection: { terms_of_service: "required" as const } }
        : {}),
      // tos_* rides the SAME channel already used for setup_fee and
      // esign_metered_price_id, so the webhook can stamp acceptance against a
      // COMPLETED payment rather than a session that may be abandoned. The
      // version is the server constant — never anything the client named.
      // The two consent signals have DIFFERENT trust properties, so they are
      // gated differently rather than as one unit.
      //
      //  · tos_accepted_in_app is the forgeable client boolean, and it belongs
      //    to whoever CREATED the session. A super admin's tick is not the
      //    operator's, so those keys are withheld unless the actor is the
      //    operator — otherwise the webhook would write the very record this
      //    function deliberately refused to.
      //  · Stripe's own consent_collection result is attested by whoever
      //    COMPLETES the payment, which is always the operator, whatever the
      //    support flow that produced the link. Withholding tos_version from a
      //    super-admin-created session would therefore throw away the single
      //    non-repudiable acceptance in the whole system. So tos_version always
      //    rides along, and tos_actor tells the webhook which signals to trust.
      metadata: { tenant_id: tenantId, plan_id: planId, plan_name: plan.name, source: "platform_subscription", tos_version: PLATFORM_TOS_VERSION, tos_actor: actorIsOperator ? "operator" : "super_admin", ...(recordAcceptance ? { tos_accepted_in_app: "true", ...(access.appUser?.id ? { tos_accepted_by: access.appUser.id } : {}), ...(user.email ? { tos_accepted_by_email: user.email } : {}) } : {}), ...(chargesDeferredToday ? { setup_fee: "true" } : {}), ...(meteredPriceId ? { esign_metered_price_id: meteredPriceId } : {}) },
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

    // ── Record the in-app platform-ToS acceptance ────────────────────────────
    //
    // Placed HERE, after the Stripe call resolves, because every earlier point
    // sits above a return path that aborts the flow (tenant 404, the 409
    // active-subscription guard, the plan guards, and the Stripe calls
    // themselves, which fall through to the catch). Stamping before those would
    // record an acceptance for a checkout that never happened.
    //
    // This is the *in-app* record. The authoritative one is written by
    // subscription-webhook on checkout.session.completed, which additionally
    // correlates with a real payment and can read Stripe's own consent result.
    // A tenant who clicks Subscribe and abandons Stripe Checkout is stamped
    // here but never gets a subscription — which is the correct reading of
    // "they accepted the terms", and matches Section 38 of the terms
    // ("otherwise proceeding past a point where these Terms are presented").
    //
    // THREE GUARDS, each closing a specific hole:
    //  1. tosAcceptedByClient — only stamp when the box was actually ticked.
    //  2. !is_super_admin — authorizeTenantAccess lets a super admin through for
    //     ANY tenant. A super admin driving checkout on an operator's behalf
    //     must not mint a consent record the operator never gave.
    //  3. write-once — the `.is("platform_tos_accepted_at", null)` filter on the
    //     UPDATE itself, so a repeat call cannot slide the timestamp forward.
    //     Enforced at the database rather than by a pre-read, which keeps the
    //     tenant SELECT free of a column that may not exist yet (see the select
    //     above) and is race-safe against a double-click. The 409 guard above
    //     means this only runs for never-subscribed tenants, but a tenant can
    //     retry checkout many times before completing one.
    if (recordAcceptance) {
      // First match wins; x-forwarded-for is a comma-separated chain where the
      // left-most entry is the original client.
      const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
      const clientIp = forwardedFor.split(",")[0]?.trim() || null;

      const { error: tosError } = await supabase
        .from("tenants")
        .update({
          platform_tos_accepted_at: new Date().toISOString(),
          platform_tos_version: PLATFORM_TOS_VERSION,
          platform_tos_accepted_by: access.appUser?.id ?? null,
          platform_tos_accepted_by_email: user.email ?? null,
          platform_tos_accepted_ip: clientIp,
        })
        .eq("id", tenantId)
        // Belt and braces against a concurrent double-click: even if two
        // requests both read NULL, only the first UPDATE matches.
        .is("platform_tos_accepted_at", null);

      if (tosError) {
        // Never fail checkout over the audit write. The tenant is mid-payment on
        // an inescapable paywall; losing the stamp is recoverable (the webhook
        // writes it again on completion), losing the checkout is not.
        console.error(
          `Failed to record platform ToS acceptance for tenant ${tenantId}:`,
          tosError,
        );
      } else {
        console.log(
          `Recorded platform ToS acceptance ${PLATFORM_TOS_VERSION} for tenant ${tenantId} by app_user ${access.appUser?.id}`,
        );
      }
    } else if (!actorIsOperator) {
      // Distinguish a deliberate suppression from a wiring bug — both are
      // silence otherwise, and they demand opposite responses.
      console.log(
        `ToS acceptance suppressed for tenant ${tenantId}: session created by super admin ${access.appUser?.id}, not the operator`,
      );
    } else if (!tosAcceptedByClient) {
      // Expected transiently during a deploy where the function is ahead of the
      // portal bundle. If it persists, the checkbox is not wired on some path.
      console.warn(
        `Checkout for tenant ${tenantId} carried no in-app ToS acceptance (terms url: ${PLATFORM_TOS_URL})`,
      );
    }

    return jsonResponse({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("Error creating subscription checkout:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
