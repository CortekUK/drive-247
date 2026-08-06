import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { PLATFORM_TOS_VERSION } from "../_shared/platform-tos.ts";
import { authorizeTenantAccess } from "../_shared/tenant-auth.ts";
import {
  getSubscriptionStripeMode,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { CREDIT_CONFIG } from "../_shared/credit-config.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization", 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the user
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const { credits, tenantId, successUrl, cancelUrl, acceptedTos } = await req.json();
    if (!credits || !tenantId)
      return errorResponse("credits and tenantId are required");

    // Membership check — see _shared/tenant-auth.ts. This function previously
    // authenticated the caller and then trusted the body's tenantId, which is a
    // different question: Drive247 runs ONE Supabase auth project, so "holds a
    // valid JWT" includes every rental customer who registered on any tenant's
    // public booking site, and tenant UUIDs are readable before login. Without
    // this, any signed-in member of the public could bill credits to an
    // arbitrary operator and — now that this function writes an audit record —
    // burn that operator's write-once ToS acceptance with their own identity.
    const access = await authorizeTenantAccess(supabaseAdmin, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    // Only the operator accepts the operator's contract; super admins pass the
    // check above for every tenant. Mirrors create-subscription-checkout.
    const actorIsOperator = access.appUser?.is_super_admin !== true;

    const creditAmount = parseInt(credits, 10);
    if (isNaN(creditAmount) || creditAmount < 1 || creditAmount > 10000)
      return errorResponse("credits must be between 1 and 10,000");
    // Stripe rejects a Checkout Session whose total converts to under ~200 fils
    // on the AED-settling account, so anything below this floor would 500.
    if (creditAmount < CREDIT_CONFIG.MIN_PURCHASE_CREDITS)
      return errorResponse(
        `Minimum purchase is ${CREDIT_CONFIG.MIN_PURCHASE_CREDITS} credits ($${(
          CREDIT_CONFIG.MIN_PURCHASE_CREDITS * CREDIT_CONFIG.CREDIT_PRICE_USD
        ).toFixed(2)}).`
      );

    const priceCents = Math.round(creditAmount * CREDIT_CONFIG.CREDIT_PRICE_USD * 100); // $0.20/credit

    // Credits ALWAYS bill on the UAE account, for every tenant — regardless of
    // where their subscription still bills. Credits are one-time purchases with
    // no saved-card or renewal dependency, so they need no per-tenant migration.
    const mode = await getSubscriptionStripeMode(supabaseAdmin, tenantId);
    const account = "uae" as const;
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("stripe_subscription_customer_id, uae_customer_id, subscription_account, company_name")
      .eq("id", tenantId)
      .single();
    // Was previously selecting a non-existent column ("name"), which errored
    // silently → tenant null → a brand-new Stripe customer created and
    // stripe_subscription_customer_id overwritten on EVERY purchase, severing
    // invoice→tenant resolution in the subscription webhook.
    if (tenantErr || !tenant) {
      return errorResponse(`Tenant not found: ${tenantErr?.message ?? tenantId}`, 404);
    }

    // Stripe customers are account-scoped, so pick the id that belongs to the
    // UAE account and NEVER clobber the other one:
    //  - subscription already on UAE → stripe_subscription_customer_id is a UAE
    //    customer, reuse it.
    //  - subscription still on the legacy account → that column must stay
    //    untouched (the subscription webhook resolves legacy invoices with it),
    //    so credits use their own uae_customer_id.
    const subsOnUae = tenant.subscription_account === "uae";
    const customerColumn = subsOnUae ? "stripe_subscription_customer_id" : "uae_customer_id";
    let customerId = subsOnUae
      ? tenant.stripe_subscription_customer_id
      : tenant.uae_customer_id;

    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if ((existing as { deleted?: boolean }).deleted) customerId = null;
      } catch (_e) {
        console.log(
          `Stored customer ${customerId} not found on ${account}/${mode} Stripe account, creating new one`
        );
        customerId = null;
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: tenant?.company_name || undefined,
        metadata: { tenant_id: tenantId, purpose: "credits" },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("tenants")
        .update({ [customerColumn]: customerId })
        .eq("id", tenantId);
    }

    // Create a one-time Stripe Price for this amount
    const price = await stripe.prices.create({
      unit_amount: priceCents,
      currency: "usd",
      product_data: {
        name: `Drive247 Credits (${creditAmount})`,
      },
    });

    // Create checkout session (one-time payment)
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        type: "credit_purchase",
        tenant_id: tenantId,
        package_name: `${creditAmount} Credits`,
        credits: String(creditAmount),
        platform_account: account,
        // Mirror the acceptance onto the Stripe session, not just into our DB.
        // The UPDATE below is best-effort (its error is logged, never thrown),
        // so in any window where this function is deployed ahead of the
        // migration the consent would otherwise leave NO trace anywhere and be
        // unrecoverable. On the session it is durable, which makes a backfill
        // possible: replay these sessions and apply the same write-once UPDATE.
        ...(acceptedTos === true && actorIsOperator
          ? {
              tos_version: PLATFORM_TOS_VERSION,
              tos_accepted_in_app: "true",
              tos_actor: "operator",
              ...(access.appUser?.id ? { tos_accepted_by: access.appUser.id } : {}),
              ...(user.email ? { tos_accepted_by_email: user.email } : {}),
            }
          : {}),
      },
      success_url:
        successUrl || `${req.headers.get("origin")}/credits?status=success`,
      cancel_url:
        cancelUrl || `${req.headers.get("origin")}/credits?status=cancelled`,
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: {
          type: "credit_purchase",
          tenant_id: tenantId,
          platform_account: account,
        },
      },
    });

    // ── Platform Terms of Service acceptance ──────────────────────────────
    //
    // Buying credits is a real charge, and /credits is whitelisted past the
    // subscription paywall — so a tenant provisioned via the admin
    // CreateTenantDialog (which creates no subscription_plans row, so the
    // paywall never fires) can reach this endpoint without ever having seen the
    // subscribe flow. This is the only place that acceptance gets recorded for
    // them.
    //
    // Same three guards as create-subscription-checkout: only stamp when the
    // box was actually ticked, only for the operator (never a super admin), and
    // never overwrite an earlier acceptance. Write-once is enforced purely by
    // the `.is(..., null)` filter on the UPDATE rather than by a pre-read, so
    // the tenant SELECT above never has to name a column that may not exist yet
    // — naming it there would 404 every credit purchase, because the
    // `if (tenantErr || !tenant)` guard below turns any tenant-select error
    // into "Tenant not found".
    // The audit write can never break the purchase: its error is logged only.
    if (acceptedTos === true && actorIsOperator) {
      const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
      const clientIp = forwardedFor.split(",")[0]?.trim() || null;

      const { data: updated, error: tosError } = await supabaseAdmin
        .from("tenants")
        .update({
          platform_tos_accepted_at: new Date().toISOString(),
          platform_tos_version: PLATFORM_TOS_VERSION,
          platform_tos_accepted_by: access.appUser?.id ?? null,
          platform_tos_accepted_by_email: user.email ?? null,
          platform_tos_accepted_ip: clientIp,
        })
        .eq("id", tenantId)
        .is("platform_tos_accepted_at", null)
        // Without .select() supabase-js sends return=minimal and PostgREST
        // answers 204 with no body, so `data` is null whether the filter matched
        // one row or zero — making a "recorded" log line unfalsifiable.
        .select("id");

      if (tosError) {
        console.error(`Failed to record platform ToS acceptance for tenant ${tenantId}:`, tosError);
      } else if (updated && updated.length > 0) {
        console.log(`Recorded platform ToS acceptance ${PLATFORM_TOS_VERSION} for tenant ${tenantId} via credit purchase`);
      } else {
        // The write-once filter matched nothing — an acceptance was already on
        // record. Logged distinctly because "no error" and "wrote a row" are
        // different facts, and an audit log that conflates them is worthless
        // for the one question it exists to answer.
        console.log(`Platform ToS already on record for tenant ${tenantId}; credit-purchase acceptance not re-stamped`);
      }
    }

    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error("create-credit-checkout error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
