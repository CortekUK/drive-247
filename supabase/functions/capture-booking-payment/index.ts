import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getConnectAccountId, getStripeClientForRecord, type StripeMode } from '../_shared/stripe-client.ts';

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

    // 3. Get tenant's Stripe mode and Connect account for direct charges
    const tenantId = payment.tenant_id || payment.rental?.tenant_id;
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
        // model — a UK-created object must be captured with UK routing even
        // after the tenant flips to Own Stripe.
        stripeAccountId = getConnectAccountId({
          ...tenant,
          payment_model: payment.platform_account === 'uae' ? 'own' : 'managed',
        });
        console.log("Tenant mode:", stripeMode, "Connect account:", stripeAccountId, "Platform:", payment.platform_account || 'uk');
      }
    }

    // 3b. Buffer time check — log warning but don't block (admin may intentionally override)
    if (payment.rental?.vehicle_id && tenantId) {
      const { data: tenantSettings } = await supabase
        .from("tenants")
        .select("buffer_time_minutes")
        .eq("id", tenantId)
        .single();

      const bufferMinutes = tenantSettings?.buffer_time_minutes || 0;
      if (bufferMinutes > 0) {
        const { data: lastRental } = await supabase
          .from("rentals")
          .select("end_date, return_time")
          .eq("vehicle_id", payment.rental.vehicle_id)
          .in("status", ["Closed", "Completed"])
          .neq("id", payment.rental_id)
          .order("end_date", { ascending: false })
          .limit(1)
          .single();

        if (lastRental) {
          const rentalEnd = new Date(`${lastRental.end_date}T${lastRental.return_time || '23:59'}`);
          const bufferDeadline = new Date(rentalEnd.getTime() + bufferMinutes * 60 * 1000);
          const pickupDate = new Date(payment.rental.start_date);

          if (pickupDate < bufferDeadline && pickupDate >= rentalEnd) {
            console.warn("Buffer time override: approving booking during buffer cooldown", {
              rentalEnd: rentalEnd.toISOString(),
              bufferDeadline: bufferDeadline.toISOString(),
              pickupDate: pickupDate.toISOString(),
            });
          }
        }
      }
    }

    // 3c. Overlap check — hard block if another Pending/Active rental overlaps this vehicle's dates
    if (payment.rental?.vehicle_id && payment.rental?.start_date && payment.rental?.end_date) {
      const { data: overlapping, error: overlapErr } = await supabase
        .from("rentals")
        .select("id")
        .eq("vehicle_id", payment.rental.vehicle_id)
        .in("status", ["Pending", "Active"])
        .lte("start_date", payment.rental.end_date)
        .gte("end_date", payment.rental.start_date)
        .neq("id", payment.rental_id)
        .limit(1);

      if (!overlapErr && overlapping && overlapping.length > 0) {
        console.error("Overlap conflict detected:", { rentalId: payment.rental_id, conflictingRentalId: overlapping[0].id });
        return new Response(
          JSON.stringify({
            success: false,
            error: "Cannot approve booking: another rental overlaps with this vehicle's dates. Please resolve the conflict first.",
            conflictingRentalId: overlapping[0].id,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Get Stripe client for the platform account this payment was created on
    const stripe = getStripeClientForRecord(payment, stripeMode);
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    // 4. Get the Stripe checkout session to find the PaymentIntent
    let paymentIntentId = payment.stripe_payment_intent_id;

    if (!paymentIntentId && payment.stripe_checkout_session_id) {
      // Retrieve PaymentIntent from checkout session (on connected account for direct charges)
      const session = await stripe.checkout.sessions.retrieve(
        payment.stripe_checkout_session_id,
        stripeOptions
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

    // 5. Capture the payment in Stripe (on connected account for direct charges)
    console.log("Capturing Stripe payment intent:", paymentIntentId, stripeAccountId ? `(Connect: ${stripeAccountId})` : '');
    let capturedPaymentIntent;
    try {
      capturedPaymentIntent = await stripe.paymentIntents.capture(
        paymentIntentId,
        undefined,
        stripeOptions
      );
    } catch (captureError) {
      // If already captured, retrieve the PaymentIntent and proceed
      if (captureError?.message?.includes("already been captured")) {
        console.log("PaymentIntent already captured, retrieving current state...");
        capturedPaymentIntent = await stripe.paymentIntents.retrieve(
          paymentIntentId,
          stripeOptions
        );
      } else {
        throw captureError;
      }
    }

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

    // 6. Update payment record
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

    // 7. Update rental status to Active
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

      // 8. Update vehicle status to Rented
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

    // 9. Apply payment to charges
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
    if (error instanceof Error) {
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
