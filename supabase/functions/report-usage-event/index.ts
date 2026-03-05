import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getSubscriptionStripeClient,
} from "../_shared/subscription-stripe.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const {
      tenant_id,
      rental_id,
      customer_id,
      customer_name,
      rental_ref,
      category = "esign",
      unit_cost = 1.0,
      currency = "usd",
    } = await req.json();

    if (!tenant_id) {
      return errorResponse("tenant_id is required", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve tenant's subscription Stripe mode
    const mode = await getSubscriptionStripeMode(supabase, tenant_id);

    // Find active subscription with stripe_customer_id
    const { data: tenantSub } = await supabase
      .from("tenant_subscriptions")
      .select("stripe_customer_id")
      .eq("tenant_id", tenant_id)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    let stripeEventId: string | null = null;

    if (tenantSub?.stripe_customer_id) {
      // Map category to Stripe meter event name
      const eventNameMap: Record<string, string> = {
        esign: "esign_sent",
        // Future: sms: "sms_sent", ocr: "ocr_processed"
      };
      const eventName = eventNameMap[category];

      if (!eventName) {
        return errorResponse(`Unknown usage category: ${category}`, 400);
      }

      // Get correct Stripe client based on mode (uses Supabase secrets)
      const stripeKey =
        mode === "live"
          ? Deno.env.get("STRIPE_SUBSCRIPTION_LIVE_SECRET_KEY") ||
            Deno.env.get("STRIPE_LIVE_SECRET_KEY") ||
            ""
          : Deno.env.get("STRIPE_SUBSCRIPTION_TEST_SECRET_KEY") ||
            Deno.env.get("STRIPE_SUBSCRIPTION_SECRET_KEY") ||
            Deno.env.get("STRIPE_TEST_SECRET_KEY") ||
            "";

      if (!stripeKey) {
        console.error(`No Stripe key found for mode: ${mode}`);
        return errorResponse(`No Stripe key configured for ${mode} mode`, 500);
      }

      const meterRes = await fetch(
        "https://api.stripe.com/v1/billing/meter_events",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            event_name: eventName,
            "payload[stripe_customer_id]": tenantSub.stripe_customer_id,
            "payload[value]": "1",
          }),
        }
      );

      const meterData = await meterRes.json();
      console.log(
        "Stripe meter event:",
        meterRes.ok ? meterData.identifier : "FAILED",
        meterRes.status,
        `(mode: ${mode}, category: ${category})`
      );

      if (meterRes.ok) {
        stripeEventId = meterData.identifier;
      } else {
        console.error("Stripe meter error:", JSON.stringify(meterData));
      }
    } else {
      console.log(
        "No active subscription for tenant, skipping meter event"
      );
    }

    // Log usage for portal dashboard
    const refId =
      rental_ref || (rental_id ? rental_id.substring(0, 8).toUpperCase() : null);

    await supabase.from("esign_usage_log").insert({
      tenant_id,
      rental_id: rental_id || null,
      customer_id: customer_id || null,
      customer_name: customer_name || null,
      rental_ref: refId,
      unit_cost,
      currency,
      stripe_event_id: stripeEventId,
    });

    return jsonResponse({
      success: true,
      mode,
      stripe_event_id: stripeEventId,
      logged: true,
    });
  } catch (err) {
    console.error("report-usage-event error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
