import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts';
import { formatCurrency } from '../_shared/format-utils.ts';

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
      extensionId,
      refundType,
      refundAmount,
      category,
      reason,
      processedBy,
      tenantId: requestTenantId
    }: RefundRequest & { extensionId?: string } = await req.json();

    if (!rentalId || !reason || !refundAmount || refundAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: rentalId, reason, and valid refundAmount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Safeguard: Extension-category refunds MUST be scoped to a specific
    // rental_extension. Without extensionId we can't identify which extension's
    // charge/payment to touch, which causes orphaned ledger rows and an
    // un-updated payment status. A stale client (cached bundle) is the usual
    // cause — fail loudly so the user knows to refresh.
    if (category?.startsWith("Extension") && !extensionId) {
      return new Response(
        JSON.stringify({
          error: `Refund for ${category} requires an extensionId. Your page may be running a stale version — please hard-refresh (Cmd+Shift+R) and try again.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing refund:", { rentalId, refundType, refundAmount, category, reason, extensionId });

    // Get tenant ID for queries
    let tenantId = requestTenantId;

    // Fetch tenant currency code early for error messages
    let currencyCode = 'USD';
    if (tenantId) {
      const { data: tenantCurrency } = await supabase
        .from("tenants")
        .select("currency_code")
        .eq("id", tenantId)
        .single();
      if (tenantCurrency?.currency_code) {
        currencyCode = tenantCurrency.currency_code;
      }
    }

    // VALIDATION: Check if there's actually paid amount for this category.
    // When extensionId is supplied, restrict to that extension's charges/refunds
    // so per-extension refund validation is accurate even if other extensions
    // on the same rental are unpaid or already refunded.
    let chargesQuery = supabase
      .from("ledger_entries")
      .select("amount, remaining_amount")
      .eq("rental_id", rentalId)
      .eq("type", "Charge")
      .eq("category", category);
    if (extensionId) chargesQuery = chargesQuery.eq("extension_id", extensionId);
    const { data: ledgerCharges } = await chargesQuery;

    let refundsQuery = supabase
      .from("ledger_entries")
      .select("amount")
      .eq("rental_id", rentalId)
      .eq("type", "Refund")
      .eq("category", category);
    if (extensionId) refundsQuery = refundsQuery.eq("extension_id", extensionId);
    const { data: ledgerRefunds } = await refundsQuery;

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
          error: `No refundable amount available for ${category}. Total paid: ${formatCurrency(totalPaid, currencyCode)}, Already refunded: ${formatCurrency(totalAlreadyRefunded, currencyCode)}`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (refundAmount > availableForRefund) {
      return new Response(
        JSON.stringify({
          error: `Refund amount (${formatCurrency(refundAmount, currencyCode)}) exceeds available refundable amount (${formatCurrency(availableForRefund, currencyCode)}) for ${category}`
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
    tenantId = requestTenantId || rental.tenant_id;
    let stripeAccountId: string | null = null;
    let stripeMode: StripeMode = 'test';

    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code")
        .eq("id", tenantId)
        .single();

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test';
        stripeAccountId = getConnectAccountId(tenant);
        if (tenant.currency_code) {
          currencyCode = tenant.currency_code;
        }
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
      // For extension categories, find the payment that was actually allocated to this charge.
      // Scope to the specific extension when extensionId is provided so we don't
      // pull in a Stripe payment from an unrelated extension (which would then
      // fail the Stripe refund call).
      if (category.startsWith('Extension')) {
        // Safety: without an explicit extensionId we refuse to grab a Stripe
        // payment for this category on the rental — it would almost certainly
        // be from a different extension and the Stripe refund call would fail.
        // Manual refund (ledger-only) is the safe fallback in that case.
        if (!extensionId) {
          console.log(`Extension refund without extensionId — skipping Stripe payment lookup, manual refund only`);
        } else {
          const { data: extCharges } = await supabase
            .from("ledger_entries")
            .select("id")
            .eq("rental_id", rentalId)
            .eq("type", "Charge")
            .eq("category", category)
            .eq("extension_id", extensionId);

          if (extCharges && extCharges.length > 0) {
            const chargeIds = extCharges.map(c => c.id);
            const { data: apps } = await supabase
              .from("payment_applications")
              .select("payment_id")
              .in("charge_entry_id", chargeIds);

            if (apps && apps.length > 0) {
              const { data: paymentData } = await supabase
                .from("payments")
                .select("*")
                .in("id", apps.map(a => a.payment_id))
                .eq("extension_id", extensionId)
                .not("stripe_payment_intent_id", "is", null)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              payment = paymentData;
            }
          }
        }
        console.log(`Extension refund: found ${payment ? 'Stripe' : 'no Stripe'} payment for ${category}`);
      }

      // Fallback for non-extension categories: find the most recent Stripe payment for this rental
      if (!payment && !category.startsWith('Extension')) {
        const { data: paymentData } = await supabase
          .from("payments")
          .select("*")
          .eq("rental_id", rentalId)
          .not("stripe_payment_intent_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        payment = paymentData;
      }
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

    // Update ALL payments that applied to this category's charges — not just the
    // Stripe-backed one used for the Stripe refund call. Manual payments and
    // Stripe payments both need their status flipped when the charge they paid
    // for is refunded, otherwise the UI keeps showing "Paid". The refund amount
    // is distributed across the matching payments in proportion to what each
    // actually paid toward these charges (payment_applications.amount_applied).
    if (refundResult?.type !== "error") {
      let chargeLookup = supabase
        .from("ledger_entries")
        .select("id")
        .eq("rental_id", rentalId)
        .eq("type", "Charge")
        .eq("category", category);
      if (extensionId) chargeLookup = chargeLookup.eq("extension_id", extensionId);
      const { data: relatedCharges } = await chargeLookup;

      if (relatedCharges && relatedCharges.length > 0) {
        const relatedChargeIds = relatedCharges.map(c => c.id);
        const { data: relatedApps } = await supabase
          .from("payment_applications")
          .select("payment_id, amount_applied")
          .in("charge_entry_id", relatedChargeIds);

        // Aggregate how much each payment contributed to these charges
        const contributed = new Map<string, number>();
        for (const pa of (relatedApps || [])) {
          const prev = contributed.get(pa.payment_id) || 0;
          contributed.set(pa.payment_id, prev + Number(pa.amount_applied || 0));
        }

        // Allocate the refund amount across payments in most-applied-first order
        const sorted = Array.from(contributed.entries()).sort((a, b) => b[1] - a[1]);
        let remainingToAllocate = refundAmount;
        for (const [pid, contribution] of sorted) {
          if (remainingToAllocate <= 0.0001) break;
          const allocateToThisPayment = Math.min(remainingToAllocate, contribution);
          remainingToAllocate -= allocateToThisPayment;

          const { data: pRec } = await supabase
            .from("payments")
            .select("amount, refund_amount, refund_reason, stripe_refund_id")
            .eq("id", pid)
            .single();
          if (!pRec) continue;

          const newTotalRefund = Number(pRec.refund_amount || 0) + allocateToThisPayment;
          const paymentUpdate: Record<string, any> = {
            updated_at: new Date().toISOString(),
            refund_amount: newTotalRefund,
            refund_processed_at: new Date().toISOString(),
            refund_reason: pRec.refund_reason
              ? `${pRec.refund_reason}; ${category}: ${reason}`
              : `${category}: ${reason}`,
          };

          // NOTE: do not touch capture_status — its check constraint only
          // allows requires_capture/captured/cancelled/expired/NULL. Refund
          // state lives on `status` + `refund_amount` + `refund_processed_at`.
          if (newTotalRefund + 0.0001 >= Number(pRec.amount)) {
            paymentUpdate.status = "Refunded";
          } else {
            paymentUpdate.status = "Partial Refund";
          }

          // Only stamp the Stripe refund id on the payment that owned it
          if (stripeRefundId && payment && pid === payment.id) {
            paymentUpdate.stripe_refund_id = pRec.stripe_refund_id
              ? `${pRec.stripe_refund_id},${stripeRefundId}`
              : stripeRefundId;
          }

          const { error: paymentUpdateError } = await supabase
            .from("payments")
            .update(paymentUpdate)
            .eq("id", pid);

          if (paymentUpdateError) {
            console.error("Payment update failed:", pid, paymentUpdateError);
          } else {
            console.log("Payment updated:", pid, "allocated:", allocateToThisPayment, "newTotalRefund:", newTotalRefund);
          }
        }
      } else {
        console.log("No related charges found for payment-status update");
      }
    }

    // Create a ledger entry for the refund (negative charge to reduce balance)
    // Check if refund was successful (not error type)
    const shouldCreateLedger = refundResult && refundResult.type !== "error";
    console.log("Should create ledger entry:", shouldCreateLedger, "refundResult:", JSON.stringify(refundResult));

    if (shouldCreateLedger) {
      const ledgerEntry: Record<string, any> = {
        rental_id: rentalId,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        tenant_id: tenantId,
        entry_date: new Date().toISOString().split('T')[0],
        due_date: new Date().toISOString().split('T')[0],
        type: 'Refund',
        category: category,
        amount: -Math.abs(refundAmount),
        remaining_amount: 0,
        reference: `Refund: ${reason}${stripeRefundId ? ` (Stripe: ${stripeRefundId})` : ''}`,
      };
      if (extensionId) ledgerEntry.extension_id = extensionId;

      console.log("Creating ledger entry:", JSON.stringify(ledgerEntry));

      const { data: ledgerData, error: ledgerError } = await supabase
        .from("ledger_entries")
        .insert(ledgerEntry)
        .select();

      if (ledgerError) {
        console.error("Failed to create ledger entry:", JSON.stringify(ledgerError));
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to record refund ledger entry: ${ledgerError.message}`,
            refund: refundResult,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log("Ledger entry created for refund:", JSON.stringify(ledgerData));
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
