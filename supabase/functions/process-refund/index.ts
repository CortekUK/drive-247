import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RefundRequest {
  rentalId: string;
  paymentId?: string;
  refundType: "full" | "partial";
  refundAmount: number;
  category: string; // Tax, Service Fee, Security Deposit, Rental
  reason: string;
  processedBy?: string;
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

    const {
      rentalId,
      paymentId,
      refundType,
      refundAmount,
      category,
      reason,
      processedBy,
      tenantId: requestTenantId
    }: RefundRequest = await req.json();

    if (!rentalId || !reason || !refundAmount || refundAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: rentalId, reason, and valid refundAmount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing refund:", { rentalId, refundType, refundAmount, category, reason });

    // Get tenant ID for queries
    const tenantId = requestTenantId;

    // VALIDATION: Check if there's actually paid amount for this category
    // Get ledger entries to calculate what was actually paid vs charged
    const { data: ledgerCharges } = await supabase
      .from("ledger_entries")
      .select("amount, remaining_amount")
      .eq("rental_id", rentalId)
      .eq("type", "Charge")
      .eq("category", category);

    const { data: ledgerRefunds } = await supabase
      .from("ledger_entries")
      .select("amount")
      .eq("rental_id", rentalId)
      .eq("type", "Refund")
      .eq("category", category);

    // Calculate total charged, paid, and already refunded for this category
    const totalCharged = ledgerCharges?.reduce((sum, c) => sum + (c.amount || 0), 0) || 0;
    const totalRemaining = ledgerCharges?.reduce((sum, c) => sum + (c.remaining_amount || 0), 0) || 0;
    const totalPaid = totalCharged - totalRemaining;
    const totalAlreadyRefunded = Math.abs(ledgerRefunds?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0);
    const availableForRefund = totalPaid - totalAlreadyRefunded;

    console.log("Refund validation:", {
      category,
      totalCharged,
      totalPaid,
      totalAlreadyRefunded,
      availableForRefund,
      requestedRefund: refundAmount
    });

    if (availableForRefund <= 0) {
      return new Response(
        JSON.stringify({
          error: `No refundable amount available for ${category}. Total paid: $${totalPaid.toFixed(2)}, Already refunded: $${totalAlreadyRefunded.toFixed(2)}`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (refundAmount > availableForRefund) {
      return new Response(
        JSON.stringify({
          error: `Refund amount ($${refundAmount.toFixed(2)}) exceeds available refundable amount ($${availableForRefund.toFixed(2)}) for ${category}`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get rental details
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

    // Get tenant's Stripe mode and Connect account
    const tenantId = requestTenantId || rental.tenant_id;
    let stripeAccountId: string | null = null;
    let stripeMode: StripeMode = 'test';

    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("stripe_mode, stripe_account_id, stripe_onboarding_complete")
        .eq("id", tenantId)
        .single();

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test';
        stripeAccountId = getConnectAccountId(tenant);
        console.log("Refund - tenantId:", tenantId, "mode:", stripeMode, "connectAccount:", stripeAccountId);
      }
    }

    // Initialize mode-aware Stripe client
    const stripe = getStripeClient(stripeMode);
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
    if (payment?.stripe_payment_intent_id) {
      try {
        const paymentIntentId = payment.stripe_payment_intent_id;

        // Get the payment intent to check its status (with Connect account if applicable)
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions);
        console.log("Payment intent status:", paymentIntent.status, stripeAccountId ? `(Connect: ${stripeAccountId})` : '');

        if (paymentIntent.status === "requires_capture") {
          // Pre-auth: For partial refund on pre-auth, we can't do partial release
          // We would need to capture first, then refund
          console.log("Payment is pre-auth, cannot process partial refund directly");
          refundResult = {
            type: "error",
            message: "Cannot process refund on pre-authorized payment. Please capture first."
          };
        } else if (paymentIntent.status === "succeeded") {
          // Captured payment: Process refund
          // For direct charges on Connect accounts, refund is created on the connected account
          const refundParams: Stripe.RefundCreateParams = {
            payment_intent: paymentIntentId,
            amount: Math.round(refundAmount * 100), // Convert to cents
            reason: "requested_by_customer",
            metadata: {
              category: category,
              rental_id: rentalId,
              refund_reason: reason,
            }
          };

          console.log("Processing Stripe refund:", refundParams, stripeAccountId ? `on Connect account ${stripeAccountId}` : '');
          const refund = await stripe.refunds.create(refundParams, stripeOptions);
          stripeRefundId = refund.id;
          refundResult = {
            type: refundType,
            refundId: refund.id,
            amount: refund.amount / 100,
            status: refund.status,
            stripeAccount: stripeAccountId || 'platform',
          };
          console.log("Stripe refund successful:", refundResult);
        } else {
          console.log("Payment intent not in refundable state:", paymentIntent.status);
          refundResult = { type: "skipped", message: `Payment not in refundable state: ${paymentIntent.status}` };
        }
      } catch (stripeError: any) {
        console.error("Stripe error:", stripeError);
        refundResult = { type: "error", message: stripeError.message };

        // Return error for Stripe failures
        return new Response(
          JSON.stringify({
            success: false,
            error: `Stripe refund failed: ${stripeError.message}`,
            refund: refundResult
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // No Stripe payment - record as manual refund
      console.log("No Stripe payment found, recording as manual refund");
      refundResult = {
        type: refundType,
        amount: refundAmount,
        status: "manual",
        message: "Refund recorded (no Stripe payment to process)"
      };
    }

    // Update payment record if exists and refund was successful
    if (payment && refundResult?.status !== "error") {
      const currentRefundAmount = payment.refund_amount || 0;
      const newTotalRefund = currentRefundAmount + refundAmount;

      const paymentUpdate: Record<string, any> = {
        updated_at: new Date().toISOString(),
        refund_amount: newTotalRefund,
        refund_reason: payment.refund_reason
          ? `${payment.refund_reason}; ${category}: ${reason}`
          : `${category}: ${reason}`,
      };

      // Update status based on total refunded
      if (newTotalRefund >= payment.amount) {
        paymentUpdate.status = "Refunded";
        paymentUpdate.capture_status = "refunded";
      } else {
        paymentUpdate.status = "Partial Refund";
        paymentUpdate.capture_status = "partial_refund";
      }

      if (stripeRefundId) {
        // Append to existing refund IDs if any
        paymentUpdate.stripe_refund_id = payment.stripe_refund_id
          ? `${payment.stripe_refund_id},${stripeRefundId}`
          : stripeRefundId;
      }

      paymentUpdate.refund_processed_at = new Date().toISOString();

      await supabase
        .from("payments")
        .update(paymentUpdate)
        .eq("id", payment.id);

      console.log("Payment record updated with refund info");
    }

    // Create a ledger entry for the refund (negative charge to reduce balance)
    // Check if refund was successful (not error type)
    const shouldCreateLedger = refundResult && refundResult.type !== "error";
    console.log("Should create ledger entry:", shouldCreateLedger, "refundResult:", JSON.stringify(refundResult));

    if (shouldCreateLedger) {
      const ledgerEntry = {
        rental_id: rentalId,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        tenant_id: tenantId,
        entry_date: new Date().toISOString().split('T')[0],
        due_date: new Date().toISOString().split('T')[0],
        type: 'Refund',
        category: category,
        amount: -Math.abs(refundAmount), // Negative amount for refund
        remaining_amount: 0,
        reference: `Refund: ${reason}${stripeRefundId ? ` (Stripe: ${stripeRefundId})` : ''}`,
      };

      console.log("Creating ledger entry:", JSON.stringify(ledgerEntry));

      const { data: ledgerData, error: ledgerError } = await supabase
        .from("ledger_entries")
        .insert(ledgerEntry)
        .select();

      if (ledgerError) {
        console.error("Failed to create ledger entry:", JSON.stringify(ledgerError));
      } else {
        console.log("Ledger entry created for refund:", JSON.stringify(ledgerData));
      }
    }

    // Get customer and vehicle details for response
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name, email")
      .eq("id", rental.customer_id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        message: `${category} refund processed successfully`,
        refund: refundResult,
        details: {
          rentalId,
          category,
          refundAmount,
          refundType,
          customerName: customer?.name,
          customerEmail: customer?.email,
          stripeAccount: stripeAccountId || 'platform',
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Process refund error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
