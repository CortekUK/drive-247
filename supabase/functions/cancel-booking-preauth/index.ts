import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getConnectAccountId, getStripeClientForRecord, type StripeMode } from '../_shared/stripe-client.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CancelRequest {
  paymentId: string;
  rejectedBy?: string;
  reason?: string;
  tenantId?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body: CancelRequest = await req.json();
    const { paymentId, rejectedBy, reason, tenantId: requestTenantId } = body;

    console.log("Cancelling pre-auth for payment:", paymentId);

    // 1. Get payment details including tenant_id
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(
        `
        *,
        rental:rentals(*),
        customer:customers(*)
      `
      )
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      console.error("Payment not found:", paymentError);
      return new Response(
        JSON.stringify({ success: false, error: "Payment not found" }),
        {
          status: 200, // Return 200 to avoid FunctionsHttpError, success: false indicates failure
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Get tenant's Stripe mode and Connect account
    const tenantId = requestTenantId || payment.tenant_id;
    let stripeMode: StripeMode = 'test'; // Default to test mode for safety
    let stripeAccountId: string | null = null;

    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id")
        .eq("id", tenantId)
        .single();

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test';
        // Resolve the connected account for the platform the payment was
        // CREATED on (payments.platform_account), not the tenant's current
        // model — a UK-created object must be cancelled with UK routing even
        // after the tenant flips to Own Stripe.
        stripeAccountId = getConnectAccountId({
          ...tenant,
          payment_model: payment.platform_account === 'uae' ? 'own' : 'managed',
        });
        console.log("Tenant mode:", stripeMode, "Connect account:", stripeAccountId, "Platform:", payment.platform_account || 'uk');
      }
    }

    // Get Stripe client for the platform account this payment was created on
    const stripe = getStripeClientForRecord(payment, stripeMode);

    // 3. Check if payment can be cancelled
    if (
      payment.capture_status &&
      payment.capture_status !== "requires_capture"
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Payment cannot be cancelled. Current status: ${payment.capture_status}`,
        }),
        {
          status: 200, // Return 200 to avoid FunctionsHttpError, success: false indicates failure
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Stripe options for Connect account (if applicable)
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    // 4. Get the Stripe checkout session to find the PaymentIntent
    let paymentIntentId = payment.stripe_payment_intent_id;

    if (!paymentIntentId && payment.stripe_checkout_session_id) {
      // Retrieve PaymentIntent from checkout session
      try {
        const session = await stripe.checkout.sessions.retrieve(
          payment.stripe_checkout_session_id,
          stripeOptions
        );
        paymentIntentId = session.payment_intent as string;
      } catch (sessionError) {
        console.error("Failed to retrieve checkout session:", sessionError);
      }
    }

    // 5. Cancel the PaymentIntent in Stripe (if exists)
    // Nothing below may claim a release happened unless this is true.
    let holdReleased = false;
    if (paymentIntentId) {
      console.log("Cancelling Stripe payment intent:", paymentIntentId, stripeAccountId ? `(Connect: ${stripeAccountId})` : '');
      try {
        const cancelledPaymentIntent = await stripe.paymentIntents.cancel(
          paymentIntentId,
          undefined,
          stripeOptions
        );
        console.log(
          "Stripe payment intent cancelled:",
          cancelledPaymentIntent.status
        );
        holdReleased = true;
      } catch (stripeError: any) {
        // These two codes mean the hold is ALREADY gone at Stripe — the end
        // state we wanted. Anything else means the customer's money is STILL
        // HELD, and we must not record a release that did not happen.
        if (
          stripeError.code === "payment_intent_unexpected_state" ||
          stripeError.code === "resource_missing"
        ) {
          holdReleased = true;
        } else {
          // WAS: swallowed with "Don't fail - continue with database updates".
          // The code below then wrote status:"Refunded", capture_status:
          // "cancelled" and set the rental to Cancelled — so a failed release
          // produced a record saying the customer had been refunded, a freed
          // vehicle, and a customer notification, while the funds stayed held.
          // Harmless-looking until the platform account cannot be reached at
          // all, at which point it becomes the guaranteed outcome for every
          // cancellation. Fail loudly instead and change nothing.
          console.error("Stripe cancel FAILED — not recording a release:", stripeError);
          return new Response(
            JSON.stringify({
              success: false,
              error:
                `The deposit hold could not be released at Stripe (${stripeError?.message || stripeError?.code || "unknown error"}). ` +
                `Nothing has been changed — the booking is still active and the customer's money is still held. ` +
                `Do not retry until the payment account is reachable.`,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // 6. Update payment record
    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        capture_status: "cancelled",
        verification_status: "rejected",
        verified_by: rejectedBy,
        verified_at: new Date().toISOString(),
        status: "Refunded", // Mark as refunded since hold was released
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    if (updatePaymentError) {
      console.error("Failed to update payment:", updatePaymentError);
    }

    // 7. Update rental status to Cancelled
    if (payment.rental_id) {
      const { error: rentalUpdateError } = await supabase
        .from("rentals")
        .update({
          status: "Cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.rental_id);

      if (rentalUpdateError) {
        console.error("Failed to update rental:", rentalUpdateError);
      }

      // 8. Ensure vehicle stays Available (it should already be)
      if (payment.rental?.vehicle_id) {
        const { error: vehicleUpdateError } = await supabase
          .from("vehicles")
          .update({
            status: "Available",
            updated_at: new Date().toISOString(),
          })
          .eq("id", payment.rental.vehicle_id);

        if (vehicleUpdateError) {
          console.error("Failed to update vehicle:", vehicleUpdateError);
        }
      }
    }

    // 9. Cancel any unpaid charges for this rental
    if (payment.rental_id) {
      const { error: chargeUpdateError } = await supabase
        .from("charges")
        .update({
          status: "Cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("rental_id", payment.rental_id)
        .eq("status", "Unpaid");

      if (chargeUpdateError) {
        console.error("Failed to cancel charges:", chargeUpdateError);
      }
    }

    console.log("Booking rejected successfully");

    return new Response(
      JSON.stringify({
        success: true,
        paymentId,
        rentalId: payment.rental_id,
        message: "Booking rejected and pre-authorization released",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error cancelling pre-auth:", error);

    // `Stripe` is not imported in this file, so the previous
    // `error instanceof Stripe.errors.StripeError` threw ReferenceError from
    // INSIDE this catch — turning every handled failure into an unhandled
    // crash and an opaque FunctionsHttpError for the caller. Rare enough to go
    // unnoticed while Stripe calls succeeded; from cutoff it is every call.
    const errorMessage =
      (error as { message?: string })?.message || "Failed to cancel pre-authorization";

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 200, // Return 200 to avoid FunctionsHttpError, success: false indicates failure
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
