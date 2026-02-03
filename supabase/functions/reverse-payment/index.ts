import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ReversePaymentRequest {
  paymentId: string;
  reason: string;
  reversedBy?: string;
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

    const { paymentId, reason, reversedBy }: ReversePaymentRequest = await req.json();

    if (!paymentId) {
      return new Response(
        JSON.stringify({ success: false, error: "Payment ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!reason || reason.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Reversal reason is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Reversing payment:", paymentId, "Reason:", reason);

    // 1. Get the payment details
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      console.error("Payment not found:", paymentError);
      return new Response(
        JSON.stringify({ success: false, error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Validate payment can be reversed
    // Cannot reverse Stripe payments (those should use refund)
    if (payment.stripe_payment_intent_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cannot reverse Stripe payments. Use refund instead."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cannot reverse already refunded payments
    if (payment.refund_status === 'completed' || payment.refund_status === 'processing') {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cannot reverse a payment that has already been refunded"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if payment has a reversal note (already reversed)
    if (payment.refund_reason?.includes('[REVERSED]')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "This payment has already been reversed"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Payment details:", {
      id: payment.id,
      amount: payment.amount,
      status: payment.status,
      customer_id: payment.customer_id,
      rental_id: payment.rental_id
    });

    // 3. Get all payment applications for this payment
    const { data: applications, error: appError } = await supabase
      .from("payment_applications")
      .select("id, charge_entry_id, amount_applied")
      .eq("payment_id", paymentId);

    if (appError) {
      console.error("Error fetching payment applications:", appError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch payment allocations" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found", applications?.length || 0, "payment applications to reverse");

    // 4. Restore remaining_amount on each charge that was paid
    if (applications && applications.length > 0) {
      for (const app of applications) {
        // Get current charge
        const { data: charge, error: chargeError } = await supabase
          .from("ledger_entries")
          .select("id, remaining_amount, amount, type")
          .eq("id", app.charge_entry_id)
          .single();

        if (chargeError) {
          console.error("Error fetching charge:", chargeError);
          continue;
        }

        if (charge) {
          // Restore the remaining amount
          const newRemainingAmount = (charge.remaining_amount || 0) + app.amount_applied;

          console.log(`Restoring charge ${charge.id}: remaining ${charge.remaining_amount} + applied ${app.amount_applied} = ${newRemainingAmount}`);

          const { error: updateError } = await supabase
            .from("ledger_entries")
            .update({
              remaining_amount: newRemainingAmount,
              updated_at: new Date().toISOString()
            })
            .eq("id", app.charge_entry_id);

          if (updateError) {
            console.error("Error restoring charge remaining_amount:", updateError);
          }
        }
      }

      // 5. Delete payment applications
      const { error: deleteAppError } = await supabase
        .from("payment_applications")
        .delete()
        .eq("payment_id", paymentId);

      if (deleteAppError) {
        console.error("Error deleting payment applications:", deleteAppError);
      } else {
        console.log("Deleted payment applications");
      }
    }

    // 6. Delete P&L revenue entries created by this payment
    // These entries have source_ref like "{paymentId}_{chargeId}"
    const { data: pnlEntries, error: pnlError } = await supabase
      .from("pnl_entries")
      .select("id")
      .eq("payment_id", paymentId);

    if (!pnlError && pnlEntries && pnlEntries.length > 0) {
      const { error: deletePnlError } = await supabase
        .from("pnl_entries")
        .delete()
        .eq("payment_id", paymentId);

      if (deletePnlError) {
        console.error("Error deleting P&L entries:", deletePnlError);
      } else {
        console.log("Deleted", pnlEntries.length, "P&L entries");
      }
    }

    // 7. Handle the payment's ledger entry
    // Find the ledger entry created for this payment (type: 'Payment')
    const { data: paymentLedgerEntry, error: ledgerError } = await supabase
      .from("ledger_entries")
      .select("id, amount")
      .eq("payment_id", paymentId)
      .eq("type", "Payment")
      .maybeSingle();

    if (!ledgerError && paymentLedgerEntry) {
      // Create a reversal ledger entry (positive amount to offset the negative payment)
      const { error: reversalError } = await supabase
        .from("ledger_entries")
        .insert({
          rental_id: payment.rental_id,
          customer_id: payment.customer_id,
          vehicle_id: payment.vehicle_id,
          tenant_id: payment.tenant_id,
          entry_date: new Date().toISOString().split('T')[0],
          type: 'Adjustment',
          category: 'Adjustment',
          amount: Math.abs(paymentLedgerEntry.amount), // Positive to offset negative payment
          remaining_amount: 0,
          reference: `Payment Reversal: ${reason}`,
          payment_id: paymentId,
        });

      if (reversalError) {
        console.error("Error creating reversal ledger entry:", reversalError);
      } else {
        console.log("Created reversal ledger entry");
      }
    }

    // 8. Update the payment record
    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        status: "Reversed",
        remaining_amount: 0, // No longer has any allocation
        refund_reason: `[REVERSED] ${reason}`,
        refund_processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    if (updatePaymentError) {
      console.error("Error updating payment status:", updatePaymentError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update payment status" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Payment reversed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Payment reversed successfully",
        details: {
          paymentId,
          amount: payment.amount,
          applicationsReversed: applications?.length || 0,
          reason,
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Reverse payment error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
