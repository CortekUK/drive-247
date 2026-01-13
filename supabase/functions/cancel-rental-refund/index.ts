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

interface CancelRefundRequest {
  rentalId: string;
  paymentId?: string;
  refundType: "full" | "partial" | "none";
  refundAmount?: number; // For partial refunds
  reason: string;
  cancelledBy: string; // Admin user ID
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

    const { rentalId, paymentId, refundType, refundAmount, reason, cancelledBy, tenantId: requestTenantId }: CancelRefundRequest = await req.json();

    if (!rentalId || !reason) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: rentalId and reason" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing rental cancellation:", { rentalId, refundType, refundAmount, reason });

    // Get rental details (separate query to avoid join issues)
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("id, status, customer_id, vehicle_id, monthly_amount, tenant_id")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      console.error("Rental not found:", rentalError);
      return new Response(
        JSON.stringify({ error: "Rental not found", details: rentalError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get customer details
    let customer = null;
    if (rental.customer_id) {
      const { data: customerData } = await supabase
        .from("customers")
        .select("id, name, email, phone")
        .eq("id", rental.customer_id)
        .single();
      customer = customerData;
    }

    // Get vehicle details
    let vehicle = null;
    if (rental.vehicle_id) {
      const { data: vehicleData } = await supabase
        .from("vehicles")
        .select("id, make, model, registration_number")
        .eq("id", rental.vehicle_id)
        .single();
      vehicle = vehicleData;
    }

    // Get tenant's Stripe Connect account
    const tenantId = requestTenantId || rental.tenant_id;
    let stripeAccountId: string | null = null;

    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("stripe_account_id, stripe_onboarding_complete")
        .eq("id", tenantId)
        .single();

      if (tenant?.stripe_account_id && tenant?.stripe_onboarding_complete) {
        stripeAccountId = tenant.stripe_account_id;
        console.log("Using Stripe Connect account:", stripeAccountId);
      }
    }

    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    // Get related payment with Stripe payment intent
    let payment = null;
    if (paymentId) {
      const { data: paymentData } = await supabase
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .single();
      payment = paymentData;
    } else {
      // Find the most recent payment for this rental with a Stripe payment intent
      const { data: paymentData } = await supabase
        .from("payments")
        .select("*")
        .eq("rental_id", rentalId)
        .not("stripe_payment_intent_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      payment = paymentData;
    }

    let refundResult = null;
    let stripeRefundId = null;

    // Process Stripe refund if applicable
    if (payment?.stripe_payment_intent_id && refundType !== "none") {
      try {
        const paymentIntentId = payment.stripe_payment_intent_id;

        // Get the payment intent to check its status (with Connect account if applicable)
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions);
        console.log("Payment intent status:", paymentIntent.status, stripeAccountId ? `(Connect: ${stripeAccountId})` : '');

        if (paymentIntent.status === "requires_capture") {
          // Pre-auth: Cancel the payment intent (release hold)
          console.log("Cancelling pre-auth payment intent...");
          await stripe.paymentIntents.cancel(paymentIntentId, undefined, stripeOptions);
          refundResult = { type: "cancelled", message: "Pre-authorization hold released" };
        } else if (paymentIntent.status === "succeeded") {
          // Captured payment: Process refund
          // For direct charges, refund is created on the connected account
          let refundParams: Stripe.RefundCreateParams = {
            payment_intent: paymentIntentId,
            reason: "requested_by_customer",
          };

          if (refundType === "partial" && refundAmount) {
            refundParams.amount = Math.round(refundAmount * 100); // Convert to cents
          }

          console.log("Processing Stripe refund:", refundParams);
          const refund = await stripe.refunds.create(refundParams, stripeOptions);
          stripeRefundId = refund.id;
          refundResult = {
            type: refundType,
            refundId: refund.id,
            amount: refund.amount / 100,
            status: refund.status,
          };
        } else {
          console.log("Payment intent not in refundable state:", paymentIntent.status);
          refundResult = { type: "skipped", message: `Payment not in refundable state: ${paymentIntent.status}` };
        }
      } catch (stripeError: any) {
        console.error("Stripe error:", stripeError);
        refundResult = { type: "error", message: stripeError.message };
      }
    }

    // Update rental status to Cancelled
    const { error: updateRentalError } = await supabase
      .from("rentals")
      .update({
        status: "Cancelled",
        updated_at: new Date().toISOString(),
        notes: `Cancelled by admin. Reason: ${reason}${refundResult ? `. Refund: ${JSON.stringify(refundResult)}` : ""}`,
      })
      .eq("id", rentalId);

    if (updateRentalError) {
      console.error("Failed to update rental:", updateRentalError);
    }

    // Update vehicle status back to Available
    if (rental.vehicle_id) {
      await supabase
        .from("vehicles")
        .update({
          status: "Available",
          updated_at: new Date().toISOString(),
        })
        .eq("id", rental.vehicle_id);
    }

    // Update payment record if exists
    if (payment) {
      const paymentUpdate: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (refundType === "full") {
        paymentUpdate.status = "Refunded";
        paymentUpdate.capture_status = "refunded";
      } else if (refundType === "partial") {
        paymentUpdate.status = "Partial Refund";
        paymentUpdate.capture_status = "partial_refund";
        paymentUpdate.refund_amount = refundAmount;
      } else if (refundResult?.type === "cancelled") {
        paymentUpdate.status = "Cancelled";
        paymentUpdate.capture_status = "cancelled";
      }

      if (stripeRefundId) {
        paymentUpdate.stripe_refund_id = stripeRefundId;
      }

      await supabase
        .from("payments")
        .update(paymentUpdate)
        .eq("id", payment.id);
    }

    // Create cancellation record in audit log or notes
    const cancellationRecord = {
      rental_id: rentalId,
      cancelled_by: cancelledBy,
      reason: reason,
      refund_type: refundType,
      refund_amount: refundType === "partial" ? refundAmount : (refundType === "full" ? payment?.amount : 0),
      stripe_refund_id: stripeRefundId,
      cancelled_at: new Date().toISOString(),
    };

    console.log("Cancellation record:", cancellationRecord);

    // Prepare notification data
    const notificationData = {
      customerName: customer?.name || "Customer",
      customerEmail: customer?.email,
      customerPhone: customer?.phone,
      vehicleName: `${vehicle?.make || ""} ${vehicle?.model || ""}`.trim() || "Vehicle",
      vehicleReg: vehicle?.registration_number || "",
      bookingRef: `RNT-${rental.id.slice(0, 8).toUpperCase()}`,
      reason: reason,
      refundType: refundType,
      refundAmount: refundType === "partial" ? refundAmount : (refundType === "full" ? payment?.amount : 0),
      tenantId: tenantId,
    };

    return new Response(
      JSON.stringify({
        success: true,
        message: "Rental cancelled successfully",
        refund: refundResult,
        notificationData: notificationData,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Cancel rental error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
