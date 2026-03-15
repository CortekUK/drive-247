import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  getStripeClient,
  getConnectAccountId,
  type StripeMode,
} from "../_shared/stripe-client.ts";

interface RefundInstallmentRequest {
  rentalId: string;
  reason?: string;
  tenantId?: string;
}

interface InstallmentRefundResult {
  installmentId: string;
  installmentNumber: number;
  amount: number;
  action: "refunded" | "no_stripe_charge" | "already_cancelled" | "skipped";
  stripeRefundId?: string;
  paymentId?: string;
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

    const { rentalId, reason, tenantId: requestTenantId }: RefundInstallmentRequest = await req.json();

    if (!rentalId) {
      return errorResponse("rentalId is required");
    }

    console.log("[REFUND-INSTALLMENTS] Starting for rental:", rentalId);

    // 1. Find installment plan for this rental
    const { data: plan, error: planError } = await supabase
      .from("installment_plans")
      .select("*")
      .eq("rental_id", rentalId)
      .single();

    if (planError || !plan) {
      console.log("[REFUND-INSTALLMENTS] No installment plan found for rental:", rentalId);
      return jsonResponse({
        success: true,
        message: "No installment plan found",
        hasInstallmentPlan: false,
        totalRefunded: 0,
        results: [],
      });
    }

    if (plan.status === "cancelled") {
      console.log("[REFUND-INSTALLMENTS] Plan already cancelled:", plan.id);
      return jsonResponse({
        success: true,
        message: "Installment plan already cancelled",
        hasInstallmentPlan: true,
        planAlreadyCancelled: true,
        totalRefunded: 0,
        results: [],
      });
    }

    const tenantId = requestTenantId || plan.tenant_id;

    // 2. Get tenant Stripe config
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
      }
    }

    const stripe = getStripeClient(stripeMode);
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    // 3. Fetch ALL scheduled installments for this plan
    const { data: installments, error: installmentsError } = await supabase
      .from("scheduled_installments")
      .select("*")
      .eq("installment_plan_id", plan.id)
      .order("installment_number", { ascending: true });

    if (installmentsError) {
      console.error("[REFUND-INSTALLMENTS] Error fetching installments:", installmentsError);
      return errorResponse("Failed to fetch scheduled installments");
    }

    console.log(`[REFUND-INSTALLMENTS] Found ${installments?.length || 0} scheduled installments`);

    // 4. Process each PAID installment — refund if it has a Stripe charge
    const results: InstallmentRefundResult[] = [];
    let totalRefunded = 0;

    for (const installment of installments || []) {
      // Skip non-paid installments (they'll be cancelled by cancel_installment_plan)
      if (installment.status !== "paid") {
        results.push({
          installmentId: installment.id,
          installmentNumber: installment.installment_number,
          amount: installment.amount,
          action: installment.status === "cancelled" ? "already_cancelled" : "skipped",
        });
        continue;
      }

      const result: InstallmentRefundResult = {
        installmentId: installment.id,
        installmentNumber: installment.installment_number,
        amount: installment.amount,
        action: "no_stripe_charge",
        paymentId: installment.payment_id || undefined,
      };

      // If the installment has a Stripe payment intent, refund it
      if (installment.stripe_payment_intent_id) {
        try {
          console.log(
            `[REFUND-INSTALLMENTS] Refunding installment #${installment.installment_number}:`,
            installment.stripe_payment_intent_id,
            "Amount:", installment.amount
          );

          const stripeRefund = await stripe.refunds.create(
            {
              payment_intent: installment.stripe_payment_intent_id,
              amount: Math.round(installment.amount * 100),
              reason: "requested_by_customer",
              metadata: {
                installment_id: installment.id,
                installment_number: String(installment.installment_number),
                rental_id: rentalId,
                reason: reason || "Booking rejected/cancelled",
              },
            },
            stripeOptions
          );

          result.action = "refunded";
          result.stripeRefundId = stripeRefund.id;
          totalRefunded += installment.amount;

          console.log(
            `[REFUND-INSTALLMENTS] Refund created:`, stripeRefund.id,
            "for installment #", installment.installment_number
          );

          // If there's a linked payment record, mark it as refunded
          if (installment.payment_id) {
            await supabase
              .from("payments")
              .update({
                status: "Refunded",
                refund_status: "completed",
                refund_amount: installment.amount,
                refund_reason: reason || "Booking rejected - installment refunded",
                refund_processed_at: new Date().toISOString(),
                stripe_refund_id: stripeRefund.id,
                updated_at: new Date().toISOString(),
              })
              .eq("id", installment.payment_id);
          }
        } catch (err: any) {
          console.error(
            `[REFUND-INSTALLMENTS] Error refunding installment #${installment.installment_number}:`,
            err.message
          );

          // Check if already refunded
          if (err.code === "charge_already_refunded") {
            result.action = "refunded";
            totalRefunded += installment.amount;
          } else {
            result.error = err.message;
          }
        }
      } else {
        // No Stripe PI — manually marked as paid, nothing to refund on Stripe
        console.log(
          `[REFUND-INSTALLMENTS] Installment #${installment.installment_number} has no Stripe PI — manually paid, skipping Stripe refund`
        );
      }

      results.push(result);
    }

    // 5. Also refund the upfront payment if it has a Stripe charge and hasn't been refunded yet
    if (plan.upfront_payment_id) {
      const { data: upfrontPayment } = await supabase
        .from("payments")
        .select("*")
        .eq("id", plan.upfront_payment_id)
        .single();

      if (upfrontPayment && upfrontPayment.status !== "Refunded" && upfrontPayment.stripe_payment_intent_id) {
        try {
          console.log(
            "[REFUND-INSTALLMENTS] Refunding upfront payment:",
            upfrontPayment.stripe_payment_intent_id,
            "Amount:", upfrontPayment.amount
          );

          const stripeRefund = await stripe.refunds.create(
            {
              payment_intent: upfrontPayment.stripe_payment_intent_id,
              amount: Math.round(upfrontPayment.amount * 100),
              reason: "requested_by_customer",
              metadata: {
                payment_id: upfrontPayment.id,
                rental_id: rentalId,
                type: "upfront_installment_refund",
                reason: reason || "Booking rejected/cancelled",
              },
            },
            stripeOptions
          );

          await supabase
            .from("payments")
            .update({
              status: "Refunded",
              refund_status: "completed",
              refund_amount: upfrontPayment.amount,
              refund_reason: reason || "Booking rejected - upfront refunded",
              refund_processed_at: new Date().toISOString(),
              stripe_refund_id: stripeRefund.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", upfrontPayment.id);

          totalRefunded += upfrontPayment.amount;
          console.log("[REFUND-INSTALLMENTS] Upfront refund created:", stripeRefund.id);
        } catch (err: any) {
          console.error("[REFUND-INSTALLMENTS] Error refunding upfront:", err.message);
          if (err.code === "charge_already_refunded") {
            totalRefunded += upfrontPayment.amount;
          }
        }
      }
    }

    // 6. Create per-category refund ledger entries
    const { data: rental } = await supabase
      .from("rentals")
      .select("customer_id, vehicle_id")
      .eq("id", rentalId)
      .single();

    if (rental && totalRefunded > 0) {
      const today = new Date().toISOString().split("T")[0];
      const refRef = `Installment plan refund: ${reason || "Booking rejected"} (Plan: ${plan.id.substring(0, 8)})`;

      // Try to get category breakdown from payment_applications for all refunded payments
      const refundedPaymentIds = [
        ...(plan.upfront_payment_id ? [plan.upfront_payment_id] : []),
        ...results.filter(r => r.action === "refunded" && r.paymentId).map(r => r.paymentId!),
      ];

      // Collect per-category refund amounts from payment_applications
      const categoryRefunds: Record<string, number> = {};
      let allocatedTotal = 0;

      for (const pid of refundedPaymentIds) {
        const { data: applications } = await supabase
          .from("payment_applications")
          .select("amount_applied, charge_entry_id, ledger_entries!charge_entry_id(category)")
          .eq("payment_id", pid);

        if (applications && applications.length > 0) {
          for (const app of applications) {
            const category = (app as any).ledger_entries?.category || "Rental";
            categoryRefunds[category] = (categoryRefunds[category] || 0) + app.amount_applied;
            allocatedTotal += app.amount_applied;
          }
        }
      }

      // If no payment_applications found, fall back to invoice breakdown
      if (allocatedTotal === 0) {
        const { data: invoice } = await supabase
          .from("invoices")
          .select("rental_amount, tax_amount, service_fee, security_deposit, delivery_fee")
          .eq("rental_id", rentalId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (invoice) {
          // Installment amounts go to Rental; upfront covers fees
          const installmentRefundTotal = results
            .filter(r => r.action === "refunded")
            .reduce((sum, r) => sum + r.amount, 0);

          if (installmentRefundTotal > 0) {
            categoryRefunds["Rental"] = (categoryRefunds["Rental"] || 0) + installmentRefundTotal;
          }

          // Upfront covers: security deposit + service fee + tax + delivery fee + first installment
          const upfrontRefunded = plan.upfront_payment_id ? (totalRefunded - installmentRefundTotal) : 0;
          if (upfrontRefunded > 0) {
            const feeItems = [
              { category: "Security Deposit", amount: invoice.security_deposit || 0 },
              { category: "Service Fee", amount: invoice.service_fee || 0 },
              { category: "Tax", amount: invoice.tax_amount || 0 },
              { category: "Delivery Fee", amount: invoice.delivery_fee || 0 },
            ];

            let remainingUpfront = upfrontRefunded;
            for (const item of feeItems) {
              if (item.amount > 0 && remainingUpfront > 0) {
                const refundAmt = Math.min(item.amount, remainingUpfront);
                categoryRefunds[item.category] = (categoryRefunds[item.category] || 0) + refundAmt;
                remainingUpfront -= refundAmt;
              }
            }
            // Any remaining goes to Rental (first installment portion)
            if (remainingUpfront > 0) {
              categoryRefunds["Rental"] = (categoryRefunds["Rental"] || 0) + remainingUpfront;
            }
          }
        } else {
          // No invoice, no applications — single Rental entry as fallback
          categoryRefunds["Rental"] = totalRefunded;
        }
      }

      // Create a refund ledger entry per category
      for (const [category, amount] of Object.entries(categoryRefunds)) {
        if (amount > 0) {
          await supabase
            .from("ledger_entries")
            .insert({
              rental_id: rentalId,
              customer_id: rental.customer_id,
              vehicle_id: rental.vehicle_id,
              tenant_id: tenantId,
              entry_date: today,
              due_date: today,
              type: "Refund",
              category,
              amount: -Math.abs(amount),
              remaining_amount: 0,
              reference: refRef,
            });

          console.log(`[REFUND-INSTALLMENTS] Refund ledger entry: ${category} = -${amount}`);
        }
      }

      console.log("[REFUND-INSTALLMENTS] Created per-category refund ledger entries, total:", totalRefunded);
    }

    // 7. Cancel the installment plan (cancels remaining scheduled installments)
    const { error: cancelError } = await supabase.rpc("cancel_installment_plan", {
      p_plan_id: plan.id,
      p_reason: reason || "Booking rejected/cancelled",
    });

    if (cancelError) {
      console.error("[REFUND-INSTALLMENTS] Error cancelling plan:", cancelError);
    } else {
      console.log("[REFUND-INSTALLMENTS] Plan cancelled:", plan.id);
    }

    // Summary
    const refundedCount = results.filter((r) => r.action === "refunded").length;
    const noChargeCount = results.filter((r) => r.action === "no_stripe_charge").length;

    console.log(
      `[REFUND-INSTALLMENTS] Complete. ${refundedCount} refunded, ${noChargeCount} no Stripe charge, total refunded: ${totalRefunded}`
    );

    return jsonResponse({
      success: true,
      hasInstallmentPlan: true,
      planId: plan.id,
      planCancelled: !cancelError,
      totalRefunded,
      refundedCount,
      noStripeChargeCount: noChargeCount,
      results,
    });
  } catch (error: any) {
    console.error("[REFUND-INSTALLMENTS] Fatal error:", error);
    return jsonResponse(
      { success: false, error: error.message || "Failed to refund installment payments" },
      200
    );
  }
});
