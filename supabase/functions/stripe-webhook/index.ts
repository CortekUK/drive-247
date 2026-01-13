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

    // For direct charges with Stripe Connect, events from connected accounts
    // will have event.account set to the connected account ID
    const connectedAccountId = (event as any).account as string | undefined;
    if (connectedAccountId) {
      console.log("Event from connected account:", connectedAccountId);
    }

    // stripeOptions for any Stripe API calls that need to target the connected account
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;

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

          // Update payment record - look up by stripe_checkout_session_id since payment_id
          // is not in metadata (Stripe doesn't allow updating session metadata after creation)
          const { data: existingPaymentRecord, error: paymentLookupError } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .single();

          if (existingPaymentRecord) {
            const { error: updateError } = await supabase
              .from("payments")
              .update({
                stripe_payment_intent_id: session.payment_intent as string,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingPaymentRecord.id);

            if (updateError) {
              console.error("Failed to update payment with stripe_payment_intent_id:", updateError);
            } else {
              console.log("Updated payment", existingPaymentRecord.id, "with stripe_payment_intent_id:", session.payment_intent);
            }
          } else if (paymentLookupError) {
            console.log("No existing payment record found for session:", session.id, paymentLookupError.message);
          }

          // Get paymentId for notification (from lookup or metadata fallback)
          const paymentId = existingPaymentRecord?.id || session.metadata?.payment_id;

          // Send booking pending notification emails
          try {
            // Get rental details with customer and vehicle info
            const { data: rental } = await supabase
              .from("rentals")
              .select(`
                id,
                start_date,
                end_date,
                monthly_amount,
                tenant_id,
                customer:customers(id, name, email, phone),
                vehicle:vehicles(id, make, model, reg)
              `)
              .eq("id", rentalId)
              .single();

            if (rental && rental.customer && rental.vehicle) {
              const vehicleName = rental.vehicle.make && rental.vehicle.model
                ? `${rental.vehicle.make} ${rental.vehicle.model}`
                : rental.vehicle.reg;

              const notificationData = {
                paymentId: paymentId || '',
                rentalId: rentalId,
                tenantId: rental.tenant_id, // Required for tenant-specific templates and admin email
                customerId: rental.customer.id,
                customerName: rental.customer.name,
                customerEmail: rental.customer.email,
                customerPhone: rental.customer.phone,
                vehicleName: vehicleName,
                vehicleMake: rental.vehicle.make,
                vehicleModel: rental.vehicle.model,
                vehicleReg: rental.vehicle.reg,
                pickupDate: new Date(rental.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                returnDate: new Date(rental.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                amount: rental.monthly_amount || (session.amount_total ? session.amount_total / 100 : 0),
                bookingRef: rentalId.substring(0, 8).toUpperCase(),
              };

              console.log("Sending booking pending notification:", notificationData.bookingRef);

              const notifyResponse = await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-booking-pending`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify(notificationData),
                }
              );

              if (notifyResponse.ok) {
                console.log("Booking notification sent successfully");
              } else {
                console.error("Failed to send booking notification:", await notifyResponse.text());
              }
            }
          } catch (notifyError) {
            console.error("Error sending booking notification:", notifyError);
            // Don't fail the webhook for notification errors
          }
        } else {
          // Auto mode: Payment was captured, but rental stays Pending until admin approves
          // Rental status = Pending (approval_status=pending, payment_status=fulfilled)
          console.log("Auto checkout completed, updating payment_status to fulfilled:", rentalId);

          // Update rental payment_status to fulfilled (approval_status stays pending)
          // Rental will only go Active when admin clicks Approve (approval_status = approved)
          const { error: rentalUpdateError } = await supabase
            .from("rentals")
            .update({
              payment_status: "fulfilled",
              updated_at: new Date().toISOString(),
            })
            .eq("id", rentalId);

          if (rentalUpdateError) {
            console.error("Failed to update rental payment_status:", rentalUpdateError);
          } else {
            console.log("Rental payment_status updated to fulfilled");
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
              .select("customer_id, vehicle_id, monthly_amount, tenant_id")
              .eq("id", rentalId)
              .single();

            if (rental) {
              const paymentAmount = session.amount_total ? session.amount_total / 100 : rental.monthly_amount;
              const today = new Date().toISOString().split("T")[0];

              const paymentData: any = {
                rental_id: rentalId,
                customer_id: rental.customer_id,
                vehicle_id: rental.vehicle_id,
                amount: paymentAmount,
                payment_date: today,
                apply_from_date: today,
                method: "Card",
                payment_type: "Payment",
                status: "Pending", // Will be updated when admin approves
                remaining_amount: paymentAmount,
                verification_status: "pending", // Changed: needs admin approval
                stripe_checkout_session_id: session.id,
                stripe_payment_intent_id: session.payment_intent as string,
                capture_status: "captured", // Payment is captured, just needs approval
                booking_source: "website",
              };

              // Add tenant_id if rental has it
              if (rental.tenant_id) {
                paymentData.tenant_id = rental.tenant_id;
              }

              const { data: newPayment, error: paymentError } = await supabase
                .from("payments")
                .insert(paymentData)
                .select()
                .single();

              if (paymentError) {
                console.error("Failed to create payment record:", paymentError);
              } else {
                console.log("Payment record created from webhook:", newPayment.id);

                // Send booking pending notification for auto mode (same as manual mode)
                try {
                  const { data: rentalWithDetails } = await supabase
                    .from("rentals")
                    .select(`
                      id,
                      start_date,
                      end_date,
                      monthly_amount,
                      tenant_id,
                      customer:customers(id, name, email, phone),
                      vehicle:vehicles(id, make, model, reg)
                    `)
                    .eq("id", rentalId)
                    .single();

                  if (rentalWithDetails && rentalWithDetails.customer && rentalWithDetails.vehicle) {
                    const vehicleName = rentalWithDetails.vehicle.make && rentalWithDetails.vehicle.model
                      ? `${rentalWithDetails.vehicle.make} ${rentalWithDetails.vehicle.model}`
                      : rentalWithDetails.vehicle.reg;

                    const notificationData = {
                      paymentId: newPayment.id,
                      rentalId: rentalId,
                      tenantId: rentalWithDetails.tenant_id, // Required for tenant-specific templates and admin email
                      customerId: rentalWithDetails.customer.id,
                      customerName: rentalWithDetails.customer.name,
                      customerEmail: rentalWithDetails.customer.email,
                      customerPhone: rentalWithDetails.customer.phone,
                      vehicleName: vehicleName,
                      vehicleMake: rentalWithDetails.vehicle.make,
                      vehicleModel: rentalWithDetails.vehicle.model,
                      vehicleReg: rentalWithDetails.vehicle.reg,
                      pickupDate: new Date(rentalWithDetails.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                      returnDate: new Date(rentalWithDetails.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                      amount: rentalWithDetails.monthly_amount || paymentAmount,
                      bookingRef: rentalId.substring(0, 8).toUpperCase(),
                      paymentMode: 'auto', // Indicate this is auto mode
                    };

                    console.log("Sending booking pending notification for auto mode:", notificationData.bookingRef);

                    const notifyResponse = await fetch(
                      `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-booking-pending`,
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                        },
                        body: JSON.stringify(notificationData),
                      }
                    );

                    if (notifyResponse.ok) {
                      console.log("Booking notification sent successfully");
                    } else {
                      console.error("Failed to send booking notification:", await notifyResponse.text());
                    }
                  }
                } catch (notifyError) {
                  console.error("Error sending booking notification:", notifyError);
                }
              }
            }
          }
        }

        // BACKFILL: Ensure stripe_payment_intent_id is saved for ALL matching payments
        // This catches any race conditions where the payment record was created after the webhook
        if (session.payment_intent && session.id) {
          const { data: backfilledPayments, error: backfillError } = await supabase
            .from("payments")
            .update({
              stripe_payment_intent_id: session.payment_intent as string,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_checkout_session_id", session.id)
            .is("stripe_payment_intent_id", null)
            .select("id");

          if (!backfillError && backfilledPayments && backfilledPayments.length > 0) {
            console.log(
              "Backfilled stripe_payment_intent_id for",
              backfilledPayments.length,
              "payments with session:",
              session.id
            );
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

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        console.log("Charge refunded:", charge.id, "for payment_intent:", charge.payment_intent);

        if (!charge.payment_intent) {
          console.log("No payment_intent on charge, skipping");
          break;
        }

        // Find payment by payment_intent
        const { data: payment } = await supabase
          .from("payments")
          .select("id, rental_id, tenant_id, amount")
          .eq("stripe_payment_intent_id", charge.payment_intent as string)
          .single();

        if (payment) {
          console.log("Found payment for refund:", payment.id);

          const refundAmount = charge.amount_refunded / 100;
          const isFullRefund = refundAmount >= payment.amount;

          // Update payment status
          const { error: updateError } = await supabase
            .from("payments")
            .update({
              refund_status: "completed",
              status: isFullRefund ? "Refunded" : "Partial Refund",
              refund_processed_at: new Date().toISOString(),
              refund_amount: refundAmount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);

          if (updateError) {
            console.error("Failed to update payment refund status:", updateError);
          } else {
            console.log("Updated payment", payment.id, "with refund status");
          }

          // Create portal notification
          if (payment.tenant_id) {
            const { error: notificationError } = await supabase
              .from("notifications")
              .insert({
                tenant_id: payment.tenant_id,
                type: "refund_processed",
                title: "Refund Processed",
                message: `Refund of $${refundAmount.toFixed(2)} has been processed successfully`,
                data: {
                  payment_id: payment.id,
                  rental_id: payment.rental_id,
                  refund_amount: refundAmount,
                  stripe_charge_id: charge.id,
                },
                is_read: false,
              });

            if (notificationError) {
              // Notification table might not exist, log but don't fail
              console.warn("Could not create notification (table may not exist):", notificationError.message);
            } else {
              console.log("Created refund notification for tenant:", payment.tenant_id);
            }
          }
        } else {
          console.log("No payment found for payment_intent:", charge.payment_intent);
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
