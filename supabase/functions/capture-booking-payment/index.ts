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

interface CaptureRequest {
  paymentId: string;
  approvedBy?: string;
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

    const body: CaptureRequest = await req.json();
    const { paymentId, approvedBy } = body;

    console.log("Capturing payment:", paymentId);

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

    // 2. Check if payment is in correct state
    if (payment.capture_status !== "requires_capture") {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Payment is not awaiting capture. Current status: ${payment.capture_status}`,
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
      const session = await stripe.checkout.sessions.retrieve(
        payment.stripe_checkout_session_id
      );
      paymentIntentId = session.payment_intent as string;
    }

    if (!paymentIntentId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No payment intent found for this payment",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. Capture the payment in Stripe
    console.log("Capturing Stripe payment intent:", paymentIntentId);
    const capturedPaymentIntent = await stripe.paymentIntents.capture(
      paymentIntentId
    );

    if (capturedPaymentIntent.status !== "succeeded") {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Stripe capture failed. Status: ${capturedPaymentIntent.status}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Stripe payment captured successfully");

    // 5. Update payment record
    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        capture_status: "captured",
        verification_status: "approved",
        verified_by: approvedBy,
        verified_at: new Date().toISOString(),
        status: "Applied",
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    if (updatePaymentError) {
      console.error("Failed to update payment:", updatePaymentError);
      // Don't fail - Stripe already captured, just log the error
    }

    // 6. Update rental status to Active
    if (payment.rental_id) {
      const { error: rentalUpdateError } = await supabase
        .from("rentals")
        .update({
          status: "Active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.rental_id);

      if (rentalUpdateError) {
        console.error("Failed to update rental:", rentalUpdateError);
      }

      // 7. Update vehicle status to Rented
      if (payment.rental?.vehicle_id) {
        const { error: vehicleUpdateError } = await supabase
          .from("vehicles")
          .update({
            status: "Rented",
            updated_at: new Date().toISOString(),
          })
          .eq("id", payment.rental.vehicle_id);

        if (vehicleUpdateError) {
          console.error("Failed to update vehicle:", vehicleUpdateError);
        }
      }
    }

    // 8. Apply payment to charges
    try {
      const { data: applyResult, error: applyError } = await supabase.functions.invoke(
        "apply-payment",
        {
          body: { paymentId },
        }
      );

      if (applyError) {
        console.error("Failed to apply payment to charges:", applyError);
      } else {
        console.log("Payment applied to charges:", applyResult);
      }
    } catch (applyErr) {
      console.error("Error applying payment:", applyErr);
    }

    console.log("Booking approved successfully");

    return new Response(
      JSON.stringify({
        success: true,
        paymentId,
        rentalId: payment.rental_id,
        capturedAmount: capturedPaymentIntent.amount_received / 100,
        message: "Booking approved and payment captured successfully",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error capturing payment:", error);

    let errorMessage = "Failed to capture payment";
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
