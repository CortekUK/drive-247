import { hasProcessorHandle } from "../_shared/payments/predicates.ts";
import { authorizeStaff, checkStaffTenant, type StaffAuthClient } from "../_shared/staff-auth.ts";

/**
 * reverse-payment — the handler. index.ts only wires the clients, so the
 * offline contract test (tests/integrations/money-auth/reverse-payment-contract.test.ts)
 * can drive this exact code with a recording fake.
 *
 * Reversal is a book-keeping correction for a payment recorded by hand: it
 * restores the charges the payment paid, deletes its allocations and P&L rows,
 * posts an offsetting Adjustment and marks the payment Reversed.
 *
 * WHO MAY (added 2026-09-26). This function used to verify nobody: it built a
 * service-role client and acted on any `paymentId`. With no config.toml block
 * the gateway accepts any valid project JWT — including the public anon key in
 * the booking site's bundle — so anyone holding that key and a payment id could
 * reopen a tenant's charges. Now, before the body is even read, the caller must
 * be an active member of staff whose role may edit payments (head_admin, admin,
 * ops, a super admin, or a manager with an EDITOR grant on `payments` — the
 * portal's canEdit('payments'), which gates every Reverse button), and the
 * payment must belong to the caller's own tenant. See _shared/staff-auth.ts.
 *
 * A REFUNDED PAYMENT IS NOT REVERSIBLE (added 2026-09-26). The old guard only
 * looked at refund_status 'completed' / 'processing'. A manual refund records
 * itself as refund_amount + status 'Refunded' / 'Partial Refund' without that
 * column, so a refunded manual payment passed, and reversing it reopened every
 * charge it had paid while the refund stood — the customer was asked to pay
 * again for money already handed back. Refused now, before any write.
 */

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

const LOG = "[reverse-payment]";

/** The manager tab whose editor grant stands in for "may change payments". */
export const REVERSE_PAYMENT_MANAGER_TABS = ["payments"] as const;

/** Payment statuses that mean money has already gone back to the customer. */
export const REFUNDED_STATUSES = ["Refunded", "Partial Refund"] as const;

/** True when any part of this payment has been refunded. */
export function isRefunded(payment: { refund_amount?: unknown; status?: unknown } | null | undefined): boolean {
  if (!payment) return false;
  const refunded = Number(payment.refund_amount ?? 0);
  if (Number.isFinite(refunded) && refunded > 0) return true;
  return (REFUNDED_STATUSES as readonly string[]).includes(String(payment.status ?? ""));
}

export interface ReversePaymentDeps {
  /** Builds the service-role client — inside the handler's try, where the original built it. */
  createAdminClient: () => any;
  /** Builds the anon-key client that verifies the caller's JWT; null falls back to the admin client. */
  createAuthClient?: () => StaffAuthClient | null;
  /** Environment reader (defaults to Deno.env.get). */
  env?: (name: string) => string | undefined;
}

export async function handleReversePayment(req: Request, deps: ReversePaymentDeps): Promise<Response> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = deps.createAdminClient();

    // 0. Who is asking — before the body is read or any row is looked up, so an
    //    unidentified caller learns nothing, not even whether the id exists.
    const auth = await authorizeStaff(
      req,
      { db: supabase, authClient: deps.createAuthClient?.() ?? null, env: deps.env },
      { logPrefix: LOG, managerTabs: REVERSE_PAYMENT_MANAGER_TABS },
    );
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ success: false, error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // 1b. The payment must belong to the caller's own tenant. The tenant comes
    //     from the ROW — the payment's, else its customer's — never the body.
    let paymentTenantId: string | null = payment.tenant_id ?? null;
    if (!paymentTenantId && payment.customer_id && !auth.caller.isSuperAdmin) {
      const { data: owner, error: ownerError } = await supabase
        .from("customers")
        .select("tenant_id")
        .eq("id", payment.customer_id)
        .maybeSingle();
      if (ownerError) console.error("Customer tenant lookup failed; denying:", ownerError);
      paymentTenantId = owner?.tenant_id ?? null;
    }
    const tenantCheck = checkStaffTenant(auth.caller, paymentTenantId, LOG);
    if (!tenantCheck.ok) {
      return new Response(
        JSON.stringify({ success: false, error: tenantCheck.error }),
        { status: tenantCheck.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Validate payment can be reversed
    //
    // Reversal is a BOOK-KEEPING correction for a payment that was recorded by
    // hand: it rewrites the ledger and moves no money. Anything a processor
    // touched must go through refund instead, so the money actually comes back.
    //
    // This used to test `stripe_payment_intent_id` alone. That was the same
    // question while Stripe was the only rail, but the live
    // `payments_provider_handle_exclusivity_check` forbids a Square row from
    // carrying any stripe_* handle — so every genuine Square charge read as
    // "manual" and was reversible from one click, silently detaching the ledger
    // from money still sitting at Square. See hasProcessorHandle() for why the
    // widening cannot change the answer for a Stripe row.
    if (hasProcessorHandle(payment)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cannot reverse a card payment. Use refund instead."
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

    // ...nor one refunded in full or in part by any other route. A manual refund
    // records refund_amount and status 'Refunded' / 'Partial Refund' without
    // touching refund_status, so the check above let it through — and reversing
    // it reopened every charge it paid while the refund still stood.
    if (isRefunded(payment)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cannot reverse a payment that has been refunded, in full or in part. Reversing it would ask the customer to pay again for money already returned."
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
}
