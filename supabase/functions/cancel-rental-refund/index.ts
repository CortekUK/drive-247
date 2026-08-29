import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getConnectAccountId, getStripeClientForRecord, type StripeMode } from '../_shared/stripe-client.ts';
import { getTenantBonzahCredentials, bonzahFetchWithCredentials } from '../_shared/bonzah-client.ts';
import { tryProviderRefund } from '../_shared/payments/refund.ts';

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
      .select("id, status, customer_id, vehicle_id, monthly_amount, tenant_id, deposit_hold_status, deposit_hold_payment_intent_id, platform_account")
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

    // Get tenant's Stripe mode and Connect account
    const tenantId = requestTenantId || rental.tenant_id;
    let stripeAccountId: string | null = null;
    let stripeMode: StripeMode = 'test';

    let tenantData: any = null;
    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id")
        .eq("id", tenantId)
        .single();

      if (tenant) {
        tenantData = tenant;
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test';
        stripeAccountId = getConnectAccountId(tenant);
        console.log("Refund - tenantId:", tenantId, "mode:", stripeMode, "connectAccount:", stripeAccountId);
      }
    }

    // Resolve Stripe client + connected account from the platform the RECORD
    // (payment / rental hold) was CREATED on — never the tenant's current
    // model, which may have flipped since the Stripe object was created.
    const resolveForRecord = (record: { platform_account?: string | null }) => {
      const client = getStripeClientForRecord(record, stripeMode);
      const accountId = tenantData
        ? getConnectAccountId({
            ...tenantData,
            payment_model: record.platform_account === 'uae' ? 'own' : 'managed',
          })
        : null;
      return { client, options: accountId ? { stripeAccount: accountId } : undefined };
    };

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
      // Find the most recent payment for this rental with a Stripe payment intent.
      //
      // NOTE the .limit(1): a "full" refund refunds ONE payment, the newest. That
      // was mostly harmless when a rental had a single Stripe payment, but a
      // charged-deposit rental normally has at least two (rent, then the deposit)
      // and the deposit is usually the newest — so "cancel and refund in full"
      // hands back the DEPOSIT and silently keeps the rent.
      //
      // Deliberately not changed here: refunding every payment would alter what
      // 46 live hold-path tenants get back on cancellation, and that is a money
      // decision rather than a bug fix. Instead the leftovers are reported so the
      // operator can act, and the shortfall is no longer invisible.
      const { data: stripePayments } = await supabase
        .from("payments")
        .select("*")
        .eq("rental_id", rentalId)
        // Widened from `stripe_payment_intent_id IS NOT NULL`. That expression
        // meant "carries real electronic money" while Stripe was the only rail
        // and silently narrows to "is a Stripe payment" now that it is not.
        // Unwidened, a Square charge is never selected and the cancellation
        // reports a refund the customer never receives.
        .or("stripe_payment_intent_id.not.is.null,square_payment_id.not.is.null")
        .order("created_at", { ascending: false });

      payment = (stripePayments && stripePayments[0]) || null;
      if (stripePayments && stripePayments.length > 1) {
        unrefundedOtherPayments = stripePayments.slice(1).map((p: any) => ({
          id: p.id,
          amount: Number(p.amount) || 0,
          alreadyRefunded: Number(p.refund_amount) || 0,
        }));
        console.warn(
          `[cancel-rental-refund] rental ${rentalId} has ${stripePayments.length} Stripe payments; ` +
          `only the newest (${payment?.id}) is being refunded. Others left untouched: ` +
          JSON.stringify(unrefundedOtherPayments)
        );
      }
    }

    let refundResult = null;
    let stripeRefundId = null;
    // Other Stripe payments on this rental that this cancellation did NOT refund.
    let unrefundedOtherPayments: Array<{ id: string; amount: number; alreadyRefunded: number }> = [];

    // Process Stripe refund if applicable
    if (payment?.stripe_payment_intent_id && refundType !== "none") {
      try {
        const paymentIntentId = payment.stripe_payment_intent_id;
        const { client: stripe, options: stripeOptions } = resolveForRecord(payment);

        // Get the payment intent to check its status (with Connect account if applicable)
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions);
        console.log("Payment intent status:", paymentIntent.status);

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
    } else if (payment?.payment_provider === "square" && refundType !== "none") {
      // SQUARE — a sibling branch, so the Stripe condition above is byte-identical.
      //
      // Reaching here is guaranteed rather than hoped for: the DB CHECK
      // payments_provider_handle_exclusivity_check forbids a square row from
      // carrying a stripe_payment_intent_id, so a Square payment can only ever
      // fail the test above.
      //
      // There is no pre-auth equivalent to handle. Square tenants never place an
      // authorisation hold — place-deposit-hold refuses them outright — so the
      // `requires_capture` / paymentIntents.cancel path above has no counterpart
      // and its absence here is by design, not an omission.
      const routed = await tryProviderRefund(supabase, tenantId, {
        paymentRecord: payment as Record<string, unknown>,
        amountCents:
          refundType === "partial" && refundAmount
            ? Math.round(refundAmount * 100)
            : undefined,
        reason: reason || "Rental cancelled",
      });

      // A skip is handled:true with NO error flag, so testing only `.error` let a
      // "refund not actually issued" reach the success branch — the customer was
      // told they were refunded while nothing left Square. Reachable whenever the
      // connection is inactive (square_get_tokens filters status='active') or the
      // payment has no square_payment_id yet because its webhook was missed.
      if (routed.error || routed.skipped) {
        refundResult = {
          type: "error",
          message: routed.skipped
            ? `Square refund NOT issued: ${routed.reason ?? "provider skipped"}. No money has been returned to the customer.`
            : `Square refund failed: ${routed.reason ?? "unknown error"}`,
        };
      } else {
        const body = (routed.body ?? {}) as Record<string, unknown>;
        // Reported as submitted, not settled. Square refunds are asynchronous and
        // routinely sit PENDING; square-webhook writes the terminal state when
        // refund.updated arrives. Saying "refunded" here would tell an operator
        // the customer has their money back before Square has moved it.
        refundResult = {
          type: refundType,
          refundId: body.square_refund_id ?? body.refund_id ?? null,
          // Parenthesised: `a ?? b || c` is a SyntaxError in Deno, and this file
          // therefore never bundled — the Square branch below it has never been
          // deployed. Intent is unchanged: the requested amount if given,
          // otherwise the payment's own amount, otherwise zero.
          amount: refundAmount ?? (Number(payment.amount) || 0),
          status: String(body.status ?? "processing"),
          provider: "square",
        };
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

    // Void the rental's synced Xero / Zoho invoices (Sprint 6 patch).
    // Fire-and-forget — sync log lets the operator retry if it fails.
    try {
      const voidUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/void-rental-accounting`;
      await fetch(voidUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": req.headers.get("Authorization") ?? "",
        },
        body: JSON.stringify({ rentalId }),
      });
    } catch (voidErr) {
      console.error("[finance-sync] void-rental-accounting call failed (non-fatal):", voidErr);
    }

    // Cancel any associated Bonzah insurance policies
    const { data: activePolicies } = await supabase
      .from("bonzah_insurance_policies")
      .select("id, policy_id, policy_no, status, premium_amount")
      .eq("rental_id", rentalId)
      .in("status", ["active", "quoted", "payment_pending"]);

    let cancelledPolicies: typeof activePolicies = [];

    if (activePolicies && activePolicies.length > 0) {
      // Try to cancel on Bonzah's side for active policies with a policy_id
      let bonzahCredentials = null;
      try {
        bonzahCredentials = await getTenantBonzahCredentials(supabase, tenantId);
      } catch (credErr) {
        console.warn("Could not fetch Bonzah credentials (skipping API cancellation):", credErr);
      }

      // Fetch tenant timezone for Bonzah API
      let timezone = "America/New_York";
      if (tenantId) {
        const { data: tenantTz } = await supabase
          .from("tenants")
          .select("timezone")
          .eq("id", tenantId)
          .single();
        if (tenantTz?.timezone) timezone = tenantTz.timezone;
      }

      for (const policy of activePolicies) {
        // Call Bonzah cancellation API for issued policies
        if (bonzahCredentials && policy.policy_id && policy.status === "active") {
          try {
            const cancelResult = await bonzahFetchWithCredentials(
              "/Bonzah/newendorse_cncl",
              {
                endorsement_id: "",
                eproposal_id: "",
                policy_id: policy.policy_id,
                endorsement_remarks: `Rental cancelled. Reason: ${reason}`,
                endo_source: "API",
                endo_booking_time_zone: timezone,
                finalize: 1,
              },
              bonzahCredentials
            );
            console.log(`Bonzah cancellation endorsement submitted for policy ${policy.policy_no}:`, cancelResult);
          } catch (bonzahErr: any) {
            console.error(`Failed to cancel policy ${policy.policy_no} on Bonzah:`, bonzahErr.message);
          }
        }

        // Update status in our DB regardless
        await supabase
          .from("bonzah_insurance_policies")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", policy.id);
      }

      cancelledPolicies = activePolicies;
      console.log(`Cancelled ${activePolicies.length} insurance policy(ies) for rental ${rentalId}`);
    }

    // Cancel unpaid insurance ledger entries (write off outstanding insurance charges)
    const { data: cancelledInsuranceCharges, error: insuranceLedgerError } = await supabase
      .from("ledger_entries")
      .update({
        remaining_amount: 0,
        notes: "Auto-cancelled: rental cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("rental_id", rentalId)
      // Security Deposit joins Insurance here. A cancelled rental cannot owe a
      // deposit: there is no vehicle going out and nothing to secure. Leaving it
      // outstanding meant the charge survived the cancellation forever, kept
      // inflating the customer's balance and aged receivables, and daily-reminders
      // (which never looks at rentals.status) went on chasing "Security deposit
      // still outstanding after 4 weeks" on a dead rental.
      .in("category", ["Insurance", "Security Deposit"])
      .eq("type", "Charge")
      .gt("remaining_amount", 0)
      .select("id, amount, remaining_amount, category");

    if (insuranceLedgerError) {
      console.error("Failed to cancel insurance ledger entries:", insuranceLedgerError);
    } else if (cancelledInsuranceCharges && cancelledInsuranceCharges.length > 0) {
      const totalWrittenOff = cancelledInsuranceCharges.reduce((sum, c) => sum + (c.remaining_amount || 0), 0);
      console.log(`Wrote off ${cancelledInsuranceCharges.length} unpaid insurance charge(s) totalling ${totalWrittenOff}`);
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

    // Release deposit hold if one exists.
    //
    // This USED to test `=== 'held'`. The deposit_hold_status CHECK was widened
    // from 7 values to 11 on 2026-08-10 (adding capturing / requires_action /
    // needs_review / disputed alongside the existing processing / refreshing),
    // and this function was not redeployed with that change — so a rental
    // cancelled while its hold sat in any of those six states had its Stripe
    // authorisation left UNCANCELLED while the rental was marked cancelled and
    // the vehicle returned to Available. The customer's money then stayed held
    // until the card network expired it (~4 days, up to ~30 on an extended
    // authorisation), and nothing swept for it: reconcile-deposit-holds
    // reconciles hold state against Stripe, it does not release holds for
    // cancelled rentals.
    //
    // The window is not rare any more — the nightly refresh (pg_cron jobid 57)
    // and the 6-hourly reconciler (jobid 63) both move rows through
    // 'refreshing' on a schedule.
    //
    // So: release on ANY non-terminal status. Terminal states are excluded
    // because there is nothing to cancel — 'released'/'expired' are already
    // gone, 'captured' is money we deliberately took, and 'failed' never
    // produced a live authorisation.
    const HOLD_TERMINAL = ['released', 'expired', 'captured', 'failed'];
    if (
      rental.deposit_hold_status
      && !HOLD_TERMINAL.includes(rental.deposit_hold_status)
      && rental.deposit_hold_payment_intent_id
    ) {
      try {
        const { client: holdStripe, options: holdOptions } = resolveForRecord(rental);
        await holdStripe.paymentIntents.cancel(rental.deposit_hold_payment_intent_id, holdOptions);
        await supabase.from("rentals").update({ deposit_hold_status: "released" }).eq("id", rentalId);
        console.log("Released deposit hold:", rental.deposit_hold_payment_intent_id);
      } catch (holdErr: any) {
        console.warn("Failed to release deposit hold:", holdErr.message);
      }
    }

    // Update payment record if exists
    if (payment) {
      const paymentUpdate: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      // These branches used to key off `refundType` — the REQUEST parameter —
      // so a refund that FAILED at Stripe still wrote status:"Refunded".
      // refundResult is set to { type: "error" } in the catch above, and
      // execution falls straight through to here. The result was: money kept,
      // ledger says refunded, and the customer notified "Refund processed."
      // Once the platform account is unreachable that is not an edge case, it
      // is every cancellation. Key off what actually happened instead.
      // `stripeRefundId` is assigned ONLY on the line after a successful
      // stripe.refunds.create. It is the single unambiguous proof that money
      // actually moved — unlike refundResult.type, which on success is just
      // refundType echoed back and so cannot distinguish success from request.
      const refundActuallyHappened = !!stripeRefundId;

      // capture_status is deliberately NOT written for refunds. Its check
      // constraint allows only requires_capture/captured/cancelled/expired/NULL,
      // so "refunded"/"partial_refund" made this whole UPDATE throw — AFTER
      // Stripe had already returned the money. The result was a refunded
      // customer with refund_amount still 0, status still Paid, and no
      // stripe_refund_id, i.e. money out with no record and the payment still
      // reading as fully refundable. Refund state lives on status +
      // refund_amount + stripe_refund_id.
      if (refundType === "full" && refundActuallyHappened) {
        paymentUpdate.status = "Refunded";
        // Was never set on the full path, so refund_amount stayed 0 and the
        // payment still looked entirely refundable to process-refund.
        paymentUpdate.refund_amount = Number(payment.amount) || 0;
        paymentUpdate.refund_processed_at = new Date().toISOString();
      } else if (refundType === "partial" && refundActuallyHappened) {
        paymentUpdate.status = "Partial Refund";
        paymentUpdate.refund_amount =
          Number(payment.refund_amount || 0) + Number(refundAmount || 0);
        paymentUpdate.refund_processed_at = new Date().toISOString();
      } else if (refundType !== "none" && !refundActuallyHappened) {
        // Asked for a refund, did not get one. Leave the payment status alone
        // so the money still reads as collected, and record why.
        console.error(
          `[cancel-rental-refund] refund FAILED for payment ${payment.id} — ` +
          `NOT marking it refunded. reason: ${refundResult?.message || "unknown"}`
        );
        paymentUpdate.rejection_reason =
          `Refund attempt failed: ${refundResult?.message || "unknown error"}`;
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

      // Record the refund in the LEDGER. This function never did, and
      // availableForRefund in process-refund is derived from ledger Refund rows
      // alone — so after a cancellation refund the money still read as fully
      // refundable and could be handed back a SECOND time through the rental
      // page. Charged security deposits make that reachable in normal use.
      //
      // Split across the categories this payment actually settled, in the same
      // proportions, so each category's refundable balance is right rather than
      // dumping the whole amount on one. Non-fatal: the money has already moved,
      // so a bookkeeping failure must not fail the cancellation.
      if (refundActuallyHappened) {
        try {
          const refundedTotal = refundType === "full"
            ? Number(payment.amount) || 0
            : Number(refundAmount) || 0;

          const { data: apps } = await supabase
            .from("payment_applications")
            .select("amount_applied, charge_entry_id, ledger_entries!inner(category, extension_id)")
            .eq("payment_id", payment.id);

          const byCategory: Record<string, { amount: number; extensionId: string | null }> = {};
          for (const a of (apps || []) as any[]) {
            const cat = a.ledger_entries?.category;
            if (!cat) continue;
            if (!byCategory[cat]) byCategory[cat] = { amount: 0, extensionId: a.ledger_entries?.extension_id ?? null };
            byCategory[cat].amount += Number(a.amount_applied || 0);
          }

          const appliedTotal = Object.values(byCategory).reduce((s, v) => s + v.amount, 0);
          const today = new Date().toISOString().split("T")[0];

          if (appliedTotal > 0 && refundedTotal > 0) {
            for (const [cat, info] of Object.entries(byCategory)) {
              const share = Math.round((refundedTotal * (info.amount / appliedTotal)) * 100) / 100;
              if (share <= 0) continue;
              const reference = `Refund: rental cancelled (Stripe: ${stripeRefundId})`;

              // Same-day refunds for a category collide on ux_rental_charge_unique,
              // so merge like process-refund does rather than blindly inserting.
              const { data: existing } = await supabase
                .from("ledger_entries")
                .select("id, amount, reference")
                .eq("rental_id", rentalId)
                .eq("type", "Refund")
                .eq("category", cat)
                .eq("due_date", today)
                .maybeSingle();

              if (existing) {
                await supabase.from("ledger_entries").update({
                  amount: Number(existing.amount) - share,
                  reference: existing.reference ? `${existing.reference}; ${reference}` : reference,
                }).eq("id", existing.id);
              } else {
                await supabase.from("ledger_entries").insert({
                  rental_id: rentalId,
                  customer_id: rental.customer_id,
                  vehicle_id: rental.vehicle_id,
                  tenant_id: tenantId,
                  entry_date: today,
                  due_date: today,
                  type: "Refund",
                  category: cat,
                  amount: -Math.abs(share),
                  remaining_amount: 0,
                  reference,
                  ...(info.extensionId ? { extension_id: info.extensionId } : {}),
                });
              }
            }
            console.log(`[cancel-rental-refund] recorded ${refundedTotal} across ${Object.keys(byCategory).length} categories`);
          } else {
            console.warn(
              `[cancel-rental-refund] refunded ${refundedTotal} but payment ${payment.id} has no ` +
              `payment_applications to attribute it to — NO ledger Refund row written. ` +
              `rental=${rentalId}. Reconcile manually.`
            );
          }
        } catch (ledgerErr) {
          console.error("[cancel-rental-refund] refund ledger write failed (non-fatal):", ledgerErr);
        }
      }
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
      rentalId: rental.id,
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

    // Calculate total insurance premium that was cancelled
    const insurancePremiumTotal = cancelledPolicies?.reduce((sum, p) => sum + (p.premium_amount || 0), 0) || 0;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Rental cancelled successfully",
        refund: refundResult,
        cancelledPolicies: cancelledPolicies?.length || 0,
        insurancePremiumCancelled: insurancePremiumTotal,
        notificationData: notificationData,
        // Other Stripe payments on this rental that were NOT refunded by this
        // cancellation. Empty in the ordinary single-payment case. For a
        // charged-deposit rental this is how the operator learns the rent (or
        // the deposit) is still sitting with them.
        unrefundedOtherPayments,
        unrefundedWarning: unrefundedOtherPayments.length > 0
          ? `This rental has ${unrefundedOtherPayments.length + 1} Stripe payments and only the most recent was refunded. Review the others on the rental page and refund them individually if the customer is owed them.`
          : undefined,
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
