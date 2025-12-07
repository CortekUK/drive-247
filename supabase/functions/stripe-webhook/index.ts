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
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

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

    const signature = req.headers.get("stripe-signature");
    const body = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    let event: Stripe.Event;

    // Verify webhook signature if secret is configured
    if (webhookSecret && signature) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // For testing without signature verification
      event = JSON.parse(body) as Stripe.Event;
      console.warn("Webhook signature not verified - no secret configured");
    }

    console.log("Stripe webhook received:", event.type);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session completed:", session.id);

        const rentalId = session.client_reference_id || session.metadata?.rental_id;
        const isPreAuth = session.metadata?.preauth_mode === "true";

        if (!rentalId) {
          console.log("No rental ID in session, skipping");
          break;
        }

        if (isPreAuth) {
          // Pre-auth mode: Just log - payment is held, not captured
          console.log("Pre-auth checkout completed, awaiting admin approval");

          // Update payment record if it exists
          const paymentId = session.metadata?.payment_id;
          if (paymentId) {
            await supabase
              .from("payments")
              .update({
                stripe_checkout_session_id: session.id,
                stripe_payment_intent_id: session.payment_intent as string,
                updated_at: new Date().toISOString(),
              })
              .eq("id", paymentId);
          }
        } else {
          // Auto mode: Payment was captured, activate rental
          console.log("Auto checkout completed, activating rental:", rentalId);

          // Update rental status to Active
          const { error: rentalError } = await supabase
            .from("rentals")
            .update({
              status: "Active",
              updated_at: new Date().toISOString(),
            })
            .eq("id", rentalId);

          if (rentalError) {
            console.error("Failed to update rental status:", rentalError);
          }

          // Create payment record if it doesn't exist
          const { data: existingPayment } = await supabase
            .from("payments")
            .select("id")
            .eq("rental_id", rentalId)
            .eq("stripe_checkout_session_id", session.id)
            .single();

          if (!existingPayment) {
            // Get rental details
            const { data: rental } = await supabase
              .from("rentals")
              .select("customer_id, vehicle_id, monthly_amount")
              .eq("id", rentalId)
              .single();

            if (rental) {
              const { error: paymentError } = await supabase
                .from("payments")
                .insert({
                  rental_id: rentalId,
                  customer_id: rental.customer_id,
                  vehicle_id: rental.vehicle_id,
                  amount: session.amount_total ? session.amount_total / 100 : rental.monthly_amount,
                  payment_date: new Date().toISOString().split("T")[0],
                  method: "Card",
                  payment_type: "Payment",
                  status: "Applied",
                  verification_status: "auto_approved",
                  stripe_checkout_session_id: session.id,
                  stripe_payment_intent_id: session.payment_intent as string,
                  capture_status: "captured",
                  booking_source: "website",
                });

              if (paymentError) {
                console.error("Failed to create payment record:", paymentError);
              } else {
                console.log("Payment record created from webhook");
              }
            }
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent succeeded:", paymentIntent.id);

        // Update payment record if exists
        const { data: payment } = await supabase
          .from("payments")
          .select("id, capture_status")
          .eq("stripe_payment_intent_id", paymentIntent.id)
          .single();

        if (payment) {
          // Only update if this is a capture (not a hold)
          if (paymentIntent.capture_method !== "manual" || paymentIntent.status === "succeeded") {
            await supabase
              .from("payments")
              .update({
                status: "Applied",
                capture_status: "captured",
                updated_at: new Date().toISOString(),
              })
              .eq("id", payment.id);
            console.log("Payment record updated:", payment.id);
          }
        }
        break;
      }

      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent canceled:", paymentIntent.id);

        // Update payment record
        const { data: payment } = await supabase
          .from("payments")
          .select("id, rental_id")
          .eq("stripe_payment_intent_id", paymentIntent.id)
          .single();

        if (payment) {
          await supabase
            .from("payments")
            .update({
              capture_status: "cancelled",
              verification_status: "rejected",
              status: "Refunded",
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);

          // Cancel the rental
          if (payment.rental_id) {
            await supabase
              .from("rentals")
              .update({
                status: "Cancelled",
                updated_at: new Date().toISOString(),
              })
              .eq("id", payment.rental_id);
          }

          console.log("Payment and rental cancelled from webhook");
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent failed:", paymentIntent.id);

        // Notify customer of failed payment
        const rentalId = paymentIntent.metadata?.rental_id;
        if (rentalId) {
          // Get customer details
          const { data: rental } = await supabase
            .from("rentals")
            .select("customer:customers(name, email, phone)")
            .eq("id", rentalId)
            .single();

          if (rental?.customer) {
            // Could trigger a notification here
            console.log("Payment failed for customer:", rental.customer.email);
          }
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session expired:", session.id);

        const rentalId = session.client_reference_id;
        if (rentalId) {
          // Check if rental is still in Pending status
          const { data: rental } = await supabase
            .from("rentals")
            .select("id, status")
            .eq("id", rentalId)
            .single();

          if (rental?.status === "Pending") {
            // Cancel the rental since checkout expired
            await supabase
              .from("rentals")
              .update({
                status: "Cancelled",
                updated_at: new Date().toISOString(),
              })
              .eq("id", rentalId);

            console.log("Cancelled expired checkout rental:", rentalId);
          }
        }
        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
