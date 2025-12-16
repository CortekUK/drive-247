import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CancelRequest {
  paymentId: string;
  rejectedBy?: string;
  reason?: string;
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
    const { paymentId, rejectedBy, reason } = body;

    console.log("Cancelling pre-auth for payment:", paymentId);

    // 1. Get payment details
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
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Check if payment can be cancelled
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
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 3. Get the Stripe checkout session to find the PaymentIntent
    let paymentIntentId = payment.stripe_payment_intent_id;

    if (!paymentIntentId && payment.stripe_checkout_session_id) {
      // Retrieve PaymentIntent from checkout session
      try {
        const session = await stripe.checkout.sessions.retrieve(
          payment.stripe_checkout_session_id
        );
        paymentIntentId = session.payment_intent as string;
      } catch (sessionError) {
        console.error("Failed to retrieve checkout session:", sessionError);
      }
    }

    // 4. Cancel the PaymentIntent in Stripe (if exists)
    if (paymentIntentId) {
      console.log("Cancelling Stripe payment intent:", paymentIntentId);
      try {
        const cancelledPaymentIntent = await stripe.paymentIntents.cancel(
          paymentIntentId
        );
        console.log(
          "Stripe payment intent cancelled:",
          cancelledPaymentIntent.status
        );
      } catch (stripeError) {
        // If already cancelled or expired, that's fine
        if (
          stripeError.code !== "payment_intent_unexpected_state" &&
          stripeError.code !== "resource_missing"
        ) {
          console.error("Stripe cancel error:", stripeError);
          // Don't fail - continue with database updates
        }
      }
    }

    // 5. Update payment record
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

    // 6. Update rental status to Cancelled
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

      // 7. Ensure vehicle stays Available (it should already be)
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

    // 8. Cancel any unpaid charges for this rental
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

    let errorMessage = "Failed to cancel pre-authorization";
    if (error instanceof Stripe.errors.StripeError) {
      errorMessage = error.message;
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
