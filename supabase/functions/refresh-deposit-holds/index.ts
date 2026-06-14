// Auto-refresh deposit holds that are about to expire (within 2 days of the
// REAL Stripe deadline). Runs daily via cron. Cancels the old hold, places a
// new one on the saved payment method, and records the true expiry.
// NOTE: standard card auths expire ~7 days out; only cards granted extended
// authorization last up to ~30. We track the actual deadline per hold.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getStripeClient, getConnectAccountId, resolveHoldExpiry, DEPOSIT_HOLD_CARD_OPTIONS, type StripeMode } from "../_shared/stripe-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("[DEPOSIT-REFRESH] Starting deposit hold refresh check...");

    // Find active rentals with deposit holds expiring within 2 days of the real
    // Stripe deadline. Running daily, this gives ~1 cron cycle of buffer before
    // the auth dies — tight enough to avoid needless churn on 7-day holds, early
    // enough to never miss the window.
    const refreshThreshold = new Date();
    refreshThreshold.setDate(refreshThreshold.getDate() + 2);

    const { data: rentalsToRefresh, error: queryError } = await supabase
      .from("rentals")
      .select(`
        id, tenant_id, customer_id,
        deposit_hold_payment_intent_id,
        deposit_hold_amount,
        deposit_hold_payment_method_id,
        deposit_hold_stripe_customer_id,
        deposit_hold_expires_at
      `)
      .eq("status", "Active")
      .eq("deposit_hold_status", "held")
      .lt("deposit_hold_expires_at", refreshThreshold.toISOString())
      .not("deposit_hold_payment_intent_id", "is", null);

    if (queryError) {
      console.error("[DEPOSIT-REFRESH] Query error:", queryError);
      return errorResponse("Failed to query rentals", 500);
    }

    if (!rentalsToRefresh || rentalsToRefresh.length === 0) {
      console.log("[DEPOSIT-REFRESH] No holds need refreshing");
      return jsonResponse({ success: true, refreshed: 0 });
    }

    console.log("[DEPOSIT-REFRESH] Found", rentalsToRefresh.length, "holds to refresh");

    let refreshed = 0;
    let failed = 0;
    const errors: string[] = [];

    // Cache tenant Stripe configs to avoid repeated lookups
    const tenantCache: Record<string, any> = {};

    for (const rental of rentalsToRefresh) {
      try {
        console.log("[DEPOSIT-REFRESH] Processing rental:", rental.id);

        // Mark as refreshing
        await supabase
          .from("rentals")
          .update({ deposit_hold_status: "refreshing" })
          .eq("id", rental.id);

        // Get tenant Stripe config (cached)
        if (!tenantCache[rental.tenant_id]) {
          const { data: tenant } = await supabase
            .from("tenants")
            .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code")
            .eq("id", rental.tenant_id)
            .single();
          tenantCache[rental.tenant_id] = tenant;
        }

        const tenant = tenantCache[rental.tenant_id];
        if (!tenant) {
          throw new Error(`Tenant not found: ${rental.tenant_id}`);
        }

        const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || "test";
        const stripe = getStripeClient(stripeMode);
        const connectAccountId = getConnectAccountId(tenant);
        const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

        // Step 1: Cancel the old hold
        try {
          await stripe.paymentIntents.cancel(
            rental.deposit_hold_payment_intent_id,
            stripeOptions
          );
          console.log("[DEPOSIT-REFRESH] Old hold cancelled:", rental.deposit_hold_payment_intent_id);
        } catch (cancelErr: any) {
          if (cancelErr.code === "payment_intent_unexpected_state") {
            console.warn("[DEPOSIT-REFRESH] Old hold already in final state, continuing...");
          } else {
            throw cancelErr;
          }
        }

        // Step 2: Create new hold
        const currencyCode = (tenant.currency_code || "usd").toLowerCase();
        const amountInCents = Math.round((rental.deposit_hold_amount || 0) * 100);

        const newIntent = await stripe.paymentIntents.create(
          {
            amount: amountInCents,
            currency: currencyCode,
            customer: rental.deposit_hold_stripe_customer_id,
            payment_method: rental.deposit_hold_payment_method_id,
            capture_method: "manual",
            confirm: true,
            off_session: true,
            description: `Security deposit hold (refreshed) for rental ${rental.id.substring(0, 8).toUpperCase()}`,
            // Request extended authorization so the refreshed hold lasts as long
            // as the card allows, and expand the charge to read the real expiry.
            payment_method_options: { card: DEPOSIT_HOLD_CARD_OPTIONS },
            expand: ["latest_charge"],
            metadata: {
              rental_id: rental.id,
              tenant_id: rental.tenant_id,
              type: "deposit_hold",
              refreshed: "true",
            },
          },
          stripeOptions
        );

        if (newIntent.status !== "requires_capture") {
          throw new Error(`New hold failed with status: ${newIntent.status}`);
        }

        // Step 3: Update rental with the new hold info + its REAL expiry.
        const newExpiresAt = await resolveHoldExpiry(stripe, newIntent, stripeOptions);

        await supabase
          .from("rentals")
          .update({
            deposit_hold_payment_intent_id: newIntent.id,
            deposit_hold_status: "held",
            deposit_hold_placed_at: new Date().toISOString(),
            deposit_hold_expires_at: newExpiresAt,
          })
          .eq("id", rental.id);

        console.log("[DEPOSIT-REFRESH] Refreshed:", rental.id, "→", newIntent.id);
        refreshed++;
      } catch (err: any) {
        console.error("[DEPOSIT-REFRESH] Failed for rental:", rental.id, err.message);
        failed++;
        errors.push(`${rental.id}: ${err.message}`);

        // Mark as expired if refresh failed
        await supabase
          .from("rentals")
          .update({ deposit_hold_status: "expired" })
          .eq("id", rental.id);
      }
    }

    console.log("[DEPOSIT-REFRESH] Complete. Refreshed:", refreshed, "Failed:", failed);

    return jsonResponse({
      success: true,
      refreshed,
      failed,
      total: rentalsToRefresh.length,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error: any) {
    console.error("[DEPOSIT-REFRESH] Error:", error);
    return errorResponse(error.message, 500);
  }
});
