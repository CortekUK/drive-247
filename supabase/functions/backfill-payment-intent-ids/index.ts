import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * One-time backfill script to populate stripe_payment_intent_id for existing payments
 * that have a stripe_checkout_session_id but are missing the payment intent ID.
 *
 * This addresses the issue where pre-auth payments were created before the webhook
 * was fixed to properly save the payment intent ID.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find payments with checkout session ID but no payment intent ID
    const { data: payments, error: queryError } = await supabase
      .from("payments")
      .select("id, stripe_checkout_session_id, tenant_id")
      .not("stripe_checkout_session_id", "is", null)
      .is("stripe_payment_intent_id", null);

    if (queryError) {
      throw new Error(`Failed to query payments: ${queryError.message}`);
    }

    if (!payments || payments.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No payments to backfill",
          count: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Found ${payments.length} payments to backfill`);

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const payment of payments) {
      try {
        console.log(`Processing payment ${payment.id}...`);

        // Try to get the Stripe Connect account for this tenant
        let stripeOptions: { stripeAccount?: string } = {};
        if (payment.tenant_id) {
          const { data: tenant } = await supabase
            .from("tenants")
            .select("stripe_account_id, stripe_onboarding_complete")
            .eq("id", payment.tenant_id)
            .single();

          if (tenant?.stripe_account_id && tenant?.stripe_onboarding_complete) {
            stripeOptions = { stripeAccount: tenant.stripe_account_id };
          }
        }

        // Retrieve the checkout session from Stripe
        let session: Stripe.Checkout.Session;
        try {
          session = await stripe.checkout.sessions.retrieve(
            payment.stripe_checkout_session_id,
            stripeOptions
          );
        } catch (stripeErr: any) {
          // Try without stripeAccount if it failed (session might be on platform)
          if (stripeOptions.stripeAccount) {
            console.log(`Retrying without stripeAccount for payment ${payment.id}`);
            session = await stripe.checkout.sessions.retrieve(
              payment.stripe_checkout_session_id
            );
          } else {
            throw stripeErr;
          }
        }

        if (!session.payment_intent) {
          console.log(`Payment ${payment.id}: No payment_intent in session (might be expired or cancelled)`);
          results.skipped++;
          continue;
        }

        const paymentIntentId = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id;

        // Update the payment record
        const { error: updateError } = await supabase
          .from("payments")
          .update({
            stripe_payment_intent_id: paymentIntentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payment.id);

        if (updateError) {
          console.error(`Failed to update payment ${payment.id}:`, updateError);
          results.failed++;
          results.errors.push(`${payment.id}: ${updateError.message}`);
        } else {
          console.log(`Updated payment ${payment.id} with payment_intent ${paymentIntentId}`);
          results.success++;
        }
      } catch (err: any) {
        console.error(`Error processing payment ${payment.id}:`, err);
        results.failed++;
        results.errors.push(`${payment.id}: ${err.message}`);
      }
    }

    console.log(`Backfill complete: ${results.success} success, ${results.failed} failed, ${results.skipped} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Backfilled ${results.success} payments`,
        total: payments.length,
        ...results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Backfill error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
