import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  getStripeClient,
  getConnectAccountId,
  type StripeMode,
} from "../_shared/stripe-client.ts";

interface RejectRentalRequest {
  rentalId: string;
  reason?: string;
  tenantId?: string;
}

interface RefundResult {
  paymentId: string;
  amount: number;
  action: "refunded" | "released" | "pending_manual" | "skipped";
  stripeRefundId?: string;
  error?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId, reason, tenantId: requestTenantId }: RejectRentalRequest = await req.json();

    if (!rentalId) {
      return errorResponse("rentalId is required");
    }

    console.log("Rejecting rental:", rentalId);

    // 1. Fetch the rental
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("*, customers(id, name, email), vehicles(id, reg, make, model)")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      console.error("Rental not found:", rentalError);
      return errorResponse("Rental not found", 404);
    }

    const tenantId = requestTenantId || rental.tenant_id;

    // 2. Get tenant info for Stripe
    let stripeMode: StripeMode = "test";
    let stripeAccountId: string | null = null;

    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("stripe_mode, stripe_account_id, stripe_onboarding_complete")
        .eq("id", tenantId)
        .single();

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || "test";
        stripeAccountId = getConnectAccountId(tenant);
        console.log("Tenant mode:", stripeMode, "Connect account:", stripeAccountId);
      }
    }

    const stripe = getStripeClient(stripeMode);
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    // 3. Fetch ALL active payments for this rental
    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("*")
      .eq("rental_id", rentalId)
      .not("status", "in", '("Refunded","Cancelled","Reversed")')
      .order("created_at", { ascending: true });

    if (paymentsError) {
      console.error("Error fetching payments:", paymentsError);
      return errorResponse("Failed to fetch payments");
    }

    console.log(`Found ${payments?.length || 0} active payments to process`);

    // 4. Process each payment
    const refundResults: RefundResult[] = [];

    for (const payment of payments || []) {
      const result: RefundResult = {
        paymentId: payment.id,
        amount: payment.amount || 0,
        action: "skipped",
      };

      try {
        // Resolve payment intent ID if missing
        let paymentIntentId = payment.stripe_payment_intent_id;
        if (!paymentIntentId && payment.stripe_checkout_session_id) {
          try {
            const session = await stripe.checkout.sessions.retrieve(
              payment.stripe_checkout_session_id,
              stripeOptions
            );
            paymentIntentId = session.payment_intent as string;
            if (paymentIntentId) {
              // Save it for future reference
              await supabase
                .from("payments")
                .update({ stripe_payment_intent_id: paymentIntentId })
                .eq("id", payment.id);
            }
          } catch (err: any) {
            console.warn(`Could not retrieve checkout session for payment ${payment.id}:`, err.message);
          }
        }

        if (payment.capture_status === "requires_capture" && paymentIntentId) {
          // PRE-AUTH: Release the hold
          console.log(`Releasing pre-auth hold for payment ${payment.id}: ${paymentIntentId}`);
          try {
            await stripe.paymentIntents.cancel(paymentIntentId, undefined, stripeOptions);
            result.action = "released";
          } catch (err: any) {
            if (err.code === "payment_intent_unexpected_state" || err.code === "resource_missing") {
              console.warn(`Pre-auth already cancelled/expired for ${payment.id}`);
              result.action = "released";
            } else {
              throw err;
            }
          }

          await supabase
            .from("payments")
            .update({
              status: "Refunded",
              capture_status: "cancelled",
              refund_status: "completed",
              refund_amount: payment.amount,
              refund_reason: reason || "Booking rejected by admin",
              refund_processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);
        } else if (payment.capture_status === "captured" && paymentIntentId) {
          // CAPTURED: Full refund via Stripe
          console.log(`Refunding captured payment ${payment.id}: ${paymentIntentId}`);
          const stripeRefund = await stripe.refunds.create(
            {
              payment_intent: paymentIntentId,
              amount: Math.round(payment.amount * 100),
              reason: "requested_by_customer",
              metadata: {
                payment_id: payment.id,
                rental_id: rentalId,
                reason: reason || "Booking rejected",
              },
            },
            stripeOptions
          );

          result.action = "refunded";
          result.stripeRefundId = stripeRefund.id;

          await supabase
            .from("payments")
            .update({
              status: "Refunded",
              refund_status: "completed",
              refund_amount: payment.amount,
              refund_reason: reason || "Booking rejected by admin",
              refund_processed_at: new Date().toISOString(),
              stripe_refund_id: stripeRefund.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);
        } else if (payment.amount > 0 && !paymentIntentId) {
          // MANUAL/NO STRIPE: Mark as pending manual refund
          console.log(`Payment ${payment.id} has no Stripe PI — marking for manual refund`);
          result.action = "pending_manual";

          await supabase
            .from("payments")
            .update({
              refund_status: "pending_manual",
              refund_amount: payment.amount,
              refund_reason: reason || "Booking rejected - manual refund required",
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);
        } else {
          // No amount or already handled
          console.log(`Skipping payment ${payment.id} (amount: ${payment.amount}, capture: ${payment.capture_status})`);
          await supabase
            .from("payments")
            .update({
              status: "Cancelled",
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);
        }
      } catch (err: any) {
        console.error(`Error processing payment ${payment.id}:`, err);
        result.error = err.message;
      }

      refundResults.push(result);
    }

    // 5. Create Refund ledger entries and clean up P&L
    // We keep payment_applications, payment ledger entries, and charge remaining_amounts intact
    // so the UI correctly shows what was paid. We add Refund entries so the UI shows "Refunded".
    const paymentIds = (payments || []).map((p) => p.id);
    const refundedPaymentIds = refundResults
      .filter((r) => r.action === "refunded" || r.action === "released")
      .map((r) => r.paymentId);

    if (refundedPaymentIds.length > 0) {
      // For each refunded payment, find what categories it was applied to via payment_applications
      for (const pid of refundedPaymentIds) {
        const { data: applications } = await supabase
          .from("payment_applications")
          .select("amount_applied, charge_entry_id, ledger_entries!charge_entry_id(category, vehicle_id)")
          .eq("payment_id", pid);

        if (applications && applications.length > 0) {
          // Create a Refund ledger entry for each category that was paid
          for (const app of applications) {
            const category = (app as any).ledger_entries?.category || "Other";
            const vehicleId = (app as any).ledger_entries?.vehicle_id || rental.vehicle_id;

            const { error: refundEntryError } = await supabase
              .from("ledger_entries")
              .insert({
                rental_id: rentalId,
                customer_id: rental.customer_id,
                vehicle_id: vehicleId,
                tenant_id: tenantId,
                entry_date: new Date().toISOString().split("T")[0],
                due_date: new Date().toISOString().split("T")[0],
                type: "Refund",
                category: category,
                amount: -Math.abs(app.amount_applied),
                remaining_amount: 0,
                reference: `Rejection refund: ${reason || "Booking rejected"} (Payment: ${pid.substring(0, 8)})`,
              });

            if (refundEntryError) {
              console.error(`Error creating refund ledger entry for ${category}:`, refundEntryError);
            }
          }
        } else {
          // No payment_applications found — create a single refund entry using payment's target_categories
          const payment = (payments || []).find((p) => p.id === pid);
          if (payment) {
            const categories = payment.target_categories || ["Other"];
            const amountPerCategory = payment.amount / categories.length;

            for (const category of categories) {
              await supabase
                .from("ledger_entries")
                .insert({
                  rental_id: rentalId,
                  customer_id: rental.customer_id,
                  vehicle_id: rental.vehicle_id,
                  tenant_id: tenantId,
                  entry_date: new Date().toISOString().split("T")[0],
                  due_date: new Date().toISOString().split("T")[0],
                  type: "Refund",
                  category: category,
                  amount: -Math.abs(amountPerCategory),
                  remaining_amount: 0,
                  reference: `Rejection refund: ${reason || "Booking rejected"} (Payment: ${pid.substring(0, 8)})`,
                });
            }
          }
        }
      }
      console.log("Created refund ledger entries for refunded payments");

      // Delete P&L revenue entries linked to refunded payments
      for (const pid of refundedPaymentIds) {
        await supabase
          .from("pnl_entries")
          .delete()
          .like("source_ref", `${pid}_%`);
      }
      console.log("Deleted P&L revenue entries");
    }

    // 6. Update rental status
    const { error: rentalUpdateError } = await supabase
      .from("rentals")
      .update({
        status: "Cancelled",
        approval_status: "rejected",
        cancellation_reason: reason || "rejected_by_admin",
        cancellation_requested: false,
        payment_status: "refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", rentalId);

    if (rentalUpdateError) {
      console.error("Error updating rental:", rentalUpdateError);
    }

    // 7. Release vehicle
    if (rental.vehicles?.id || rental.vehicle_id) {
      const vehicleId = rental.vehicles?.id || rental.vehicle_id;
      const { error: vehicleError } = await supabase
        .from("vehicles")
        .update({ status: "Available", updated_at: new Date().toISOString() })
        .eq("id", vehicleId);

      if (vehicleError) {
        console.error("Error releasing vehicle:", vehicleError);
      } else {
        console.log("Vehicle released:", vehicleId);
      }
    }

    // 8. Cancel any unpaid charges for this rental
    const { error: chargesError } = await supabase
      .from("charges")
      .update({ status: "Cancelled", updated_at: new Date().toISOString() })
      .eq("rental_id", rentalId)
      .eq("status", "Unpaid");

    if (chargesError) {
      console.error("Error cancelling charges:", chargesError);
    }

    // Build summary
    const totalRefunded = refundResults
      .filter((r) => r.action === "refunded" || r.action === "released")
      .reduce((sum, r) => sum + r.amount, 0);
    const manualCount = refundResults.filter((r) => r.action === "pending_manual").length;

    console.log(
      `Rental ${rentalId} rejected. ${refundResults.length} payments processed, ` +
      `${totalRefunded} refunded/released, ${manualCount} pending manual.`
    );

    return jsonResponse({
      success: true,
      rentalId,
      paymentsProcessed: refundResults.length,
      totalRefunded,
      manualRefundsRequired: manualCount,
      results: refundResults,
    });
  } catch (error: any) {
    console.error("Reject rental error:", error);
    return jsonResponse({ success: false, error: error.message || "Failed to reject rental" }, 200);
  }
});
