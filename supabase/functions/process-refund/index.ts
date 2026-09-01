import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getConnectAccountId, getStripeClientForRecord, type StripeMode } from '../_shared/stripe-client.ts';
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

    // Resolve the owning tenant BEFORE anything else — authorization has to run
    // ahead of every read, or an unauthorized caller still learns this rental's
    // deposit totals from the validation error below.
    const { data: owningRental } = await supabase
      .from("rentals")
      .select("tenant_id")
      .eq("id", rentalId)
      .maybeSingle();
    const owningTenantId = owningRental?.tenant_id ?? null;

    // ---------------------------------------------------------------------
    // Authorization. This function had NONE: `verify_jwt` only proves the
    // caller holds *some* valid token, and there was no check that the caller's
    // tenant owns this rental and no role check. Under authorization holds that
    // was low-stakes — a hold cannot be refunded (Stripe rejects
    // `requires_capture`). Now that deposits are CAPTURED, this endpoint moves
    // real money, so any authenticated user of any tenant could have drained
    // another operator's Stripe balance.
    // ---------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Trusted internal callers (other edge functions, cron) present the service
    // role key and are allowed through without a user identity.
    const isInternalCaller = !!serviceKey && bearer === serviceKey;

    if (!isInternalCaller) {
      const callerClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: authData, error: authErr } = await callerClient.auth.getUser();
      const authUser = authData?.user;
      if (authErr || !authUser) {
        return new Response(
          JSON.stringify({ error: "Invalid session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: appUser } = await supabase
        .from("app_users")
        .select("id, role, is_active, tenant_id, is_super_admin")
        .eq("auth_user_id", authUser.id)
        .maybeSingle();

      if (!appUser || appUser.is_active === false) {
        return new Response(
          JSON.stringify({ error: "No active portal profile for this account" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isSuper = appUser.is_super_admin === true;

      // Tenant ownership: a refund may only be issued against a rental
      // belonging to the caller's own tenant.
      if (!isSuper && appUser.tenant_id !== owningTenantId) {
        return new Response(
          JSON.stringify({ error: "This rental belongs to another tenant" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Role: refunds move money, so mirror charge-saved-card — full-access
      // roles, or a manager explicitly granted EDITOR on the payments tab.
      // Mirrors FULL_ACCESS_ROLES in charge-saved-card exactly — the other
      // money-moving endpoint. Do not widen one without the other.
      let allowed = isSuper || ["head_admin", "admin"].includes(String(appUser.role));
      if (!allowed && appUser.role === "manager") {
        const { data: perm } = await supabase
          .from("manager_permissions")
          .select("access_level")
          .eq("app_user_id", appUser.id)
          .eq("tab_key", "payments")
          .maybeSingle();
        allowed = perm?.access_level === "editor";
      }
      if (!allowed) {
        return new Response(
          JSON.stringify({ error: "Your role cannot issue refunds" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }


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
      .select("id, status, customer_id, vehicle_id, monthly_amount, tenant_id, rental_number")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      console.error("Rental not found:", rentalError);
      return new Response(
        JSON.stringify({ error: "Rental not found", details: rentalError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get tenant's Stripe mode and Connect account.
    // The RENTAL decides which tenant's Stripe account is used, not the request
    // body. Preferring a caller-supplied tenantId let a caller route a refund
    // through a different tenant's Connect account.
    tenantId = rental.tenant_id || requestTenantId;
    let stripeAccountId: string | null = null;
    let stripeMode: StripeMode = 'test';
    let tenantData: any = null;

    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
        .eq("id", tenantId)
        .single();

      if (tenant) {
        tenantData = tenant;
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test';
        stripeAccountId = getConnectAccountId(tenant);
        if (tenant.currency_code) {
          currencyCode = tenant.currency_code;
        }
        console.log("Refund - tenantId:", tenantId, "mode:", stripeMode, "connectAccount:", stripeAccountId);
      }
    }

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

      // Fallback for non-extension categories: find the Stripe payment that
      // was actually applied to this category's charges (not just the most
      // recent Stripe payment on the rental — that could be a deposit-capture
      // charge unrelated to the category being refunded).
      if (!payment && !category.startsWith('Extension')) {
        const { data: catCharges } = await supabase
          .from("ledger_entries")
          .select("id")
          .eq("rental_id", rentalId)
          .eq("type", "Charge")
          .eq("category", category);

        if (catCharges && catCharges.length > 0) {
          const chargeIds = catCharges.map(c => c.id);
          const { data: apps } = await supabase
            .from("payment_applications")
            .select("payment_id, amount_applied")
            .in("charge_entry_id", chargeIds);

          if (apps && apps.length > 0) {
            const paymentIds = [...new Set(apps.map(a => a.payment_id))];
            const { data: eligible } = await supabase
              .from("payments")
              .select("*")
              .in("id", paymentIds)
              .not("stripe_payment_intent_id", "is", null)
              .order("amount", { ascending: false });

            if (eligible && eligible.length > 0) {
              // Prefer a payment whose REMAINING unrefunded Stripe amount is
              // enough to cover this refund. Otherwise fall back to the one
              // with the most unrefunded left (admin can retry a smaller amt).
              const withRemaining = eligible.map((p: any) => ({
                ...p,
                _unrefunded: Number(p.amount) - Number(p.refund_amount || 0),
              }));
              payment =
                withRemaining.find((p: any) => p._unrefunded >= refundAmount) ||
                withRemaining.sort((a: any, b: any) => b._unrefunded - a._unrefunded)[0];
            }
          }
        }
        console.log(`Non-extension refund: found ${payment ? 'Stripe' : 'no Stripe'} payment for ${category} (via applications, unrefunded=${(payment as any)?._unrefunded ?? 'n/a'})`);
      }
    }

    // Cross-category cap. A single PaymentIntent routinely settles several
    // categories at once — 224 such payments already exist — and "what this PI
    // has left" is NOT "what it put into THIS category". Without this clamp a
    // Security Deposit refund can hand back money that actually paid Rental,
    // with no Rental refund ever recorded.
    //
    // This became live rather than theoretical the moment the deposit joined the
    // invoice total: one checkout PaymentIntent now covers Rental + Tax +
    // Security Deposit for a charged tenant, and FIFO settles the deposit last.
    //
    // Infinity when the applications cannot account for the money (legacy rows,
    // NULL amount_applied), so the previous behaviour is reproduced exactly
    // rather than silently under-refunding.
    let categoryCap = Number.POSITIVE_INFINITY;
    if ((payment as any)?.id) {
      try {
        let capChargeQ = supabase
          .from("ledger_entries")
          .select("id")
          .eq("rental_id", rentalId)
          .eq("type", "Charge")
          .eq("category", category);
        if (extensionId) capChargeQ = capChargeQ.eq("extension_id", extensionId);
        const { data: capCharges } = await capChargeQ;
        const capChargeIds = (capCharges || []).map((c: any) => c.id);
        if (capChargeIds.length > 0) {
          const { data: capApps } = await supabase
            .from("payment_applications")
            .select("amount_applied")
            .eq("payment_id", (payment as any).id)
            .in("charge_entry_id", capChargeIds);
          if (capApps && capApps.length > 0) {
            const appliedToCategory = capApps.reduce(
              (s: number, a: any) => s + Number(a.amount_applied || 0), 0);
            if (appliedToCategory > 0) {
              // Subtract what has already been refunded FROM THIS PAYMENT, not
              // the category-wide total. Those are different scopes: the
              // category total spans every payment that ever settled it, so
              // subtracting it here under-refunds by whatever OTHER payments
              // already gave back. Caught in live testing — a $1.50 refund was
              // silently clamped to $1.00 because $3 refunded from an earlier
              // payment was charged against this payment's $4 contribution.
              //
              // payments.refund_amount spans categories, so on a mixed payment
              // this can still under-estimate. That is the safe direction: the
              // operator can refund again, whereas over-refunding hands back
              // money that belongs to another category.
              categoryCap = Math.max(0, appliedToCategory - Number((payment as any).refund_amount || 0));
            }
          }
        }
      } catch (capErr) {
        console.warn("[process-refund] category cap unavailable, falling back to uncapped:", capErr);
      }
    }

    let refundResult = null;
    let stripeRefundId = null;

    // Non-null when the ledger write failed AFTER Stripe already moved money.
    // The Stripe refund and the ledger row are two unbatched writes with no
    // transaction between them, so this outcome is possible and permanent.
    let ledgerRecordFailed: string | null = null;

    let ledgerOnlyFallbackReason: string | null = null;
    // What Stripe actually returned, which can be less than requested when the
    // PaymentIntent had little headroom left. The customer must be told this
    // figure, not the requested one.
    let actualStripeRefunded = 0;
    // True when this refund pushes a payment into a refunded status for the
    // FIRST time — that transition fires on_refund_processed_notify, which
    // raises the operator bell. On every later partial refund the status is
    // already 'Partial Refund', the trigger's guard blocks it, and its
    // payment_id dedupe blocks it forever after — so the bell must come from
    // the notifier instead, or repeat partials are completely silent.
    let bellRaisedByTrigger = false;

    // Process Stripe refund if applicable. Stripe is the source of truth for
    // how much is still refundable on a PaymentIntent — our local
    // payment.refund_amount can drift when manual refunds, mixed payments, or
    // earlier failures leave it stale. So we query Stripe first, and decide
    // based on paymentIntent.amount vs amount_refunded what to actually do.
    if (payment?.stripe_payment_intent_id) {
      try {
        const paymentIntentId = payment.stripe_payment_intent_id;
        // Refund with the keys + connected account of the platform this payment
        // was CREATED on (payments.platform_account) — never the tenant's
        // current model, which may have flipped since.
        const stripe = getStripeClientForRecord(payment, stripeMode);
        if (tenantData) {
          stripeAccountId = getConnectAccountId({
            ...tenantData,
            payment_model: payment.platform_account === 'uae' ? 'own' : 'managed',
          });
        }
        const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions);
        console.log("Payment intent status:", paymentIntent.status, "amount:", paymentIntent.amount, "amount_refunded:", (paymentIntent as any).amount_refunded);

        if (paymentIntent.status === "requires_capture") {
          refundResult = {
            type: "error",
            message: "Cannot process refund on pre-authorized payment. Please capture first."
          };
        } else if (paymentIntent.status === "succeeded") {
          const stripeAmount = paymentIntent.amount / 100;
          const stripeRefunded = ((paymentIntent as any).amount_refunded || 0) / 100;
          const stripeUnrefunded = stripeAmount - stripeRefunded;

          if (stripeUnrefunded <= 0.005) {
            // Stripe has nothing left to refund — record ledger-only.
            ledgerOnlyFallbackReason = `Stripe payment ${paymentIntentId} is fully refunded (${formatCurrency(stripeRefunded, currencyCode)} of ${formatCurrency(stripeAmount, currencyCode)}). Recorded as manual refund — reconcile with Stripe separately if needed.`;
            console.log(ledgerOnlyFallbackReason);
            payment = null;
          } else {
            // Stripe has room. If admin wants more than what's left, refund
            // only what Stripe allows and mark the rest as manual.
            // Clamp by what this payment actually put into THIS category, so a
            // refund cannot reach across into another category's money.
            const stripeRefundAmount = Math.min(refundAmount, stripeUnrefunded, categoryCap);
            actualStripeRefunded = stripeRefundAmount;
            const manualRemainder = refundAmount - stripeRefundAmount;

            const refundParams: Stripe.RefundCreateParams = {
              payment_intent: paymentIntentId,
              amount: Math.round(stripeRefundAmount * 100),
              reason: "requested_by_customer",
              metadata: { category, rental_id: rentalId, refund_reason: reason },
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
            if (manualRemainder > 0.005) {
              ledgerOnlyFallbackReason = `Stripe refunded ${formatCurrency(stripeRefundAmount, currencyCode)} (its remaining balance on this payment). The additional ${formatCurrency(manualRemainder, currencyCode)} is recorded as manual — reconcile with Stripe separately if needed.`;
            }
            // Sync our local refund_amount with Stripe's authoritative value
            // so future refunds on this payment don't see a stale value.
            const newRefundAmount = Number(payment.refund_amount || 0) + stripeRefundAmount;
            await supabase.from('payments').update({ refund_amount: newRefundAmount }).eq('id', payment.id);
          }
        } else {
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
      // No Stripe payment (or Stripe PI was exhausted) — record as manual refund.
      console.log("No Stripe payment found, recording as manual refund");
      refundResult = {
        type: refundType,
        amount: refundAmount,
        status: "manual",
        message: ledgerOnlyFallbackReason || "Refund recorded (no Stripe payment to process)",
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
            .select("amount, refund_amount, refund_reason, stripe_refund_id, status")
            .eq("id", pid)
            .single();
          if (!pRec) continue;

          // The Stripe block above already added this refund to `payment.id`'s
          // refund_amount (the "sync with Stripe's authoritative value" update).
          // Re-adding `allocateToThisPayment` here would count the SAME refund a
          // second time — the $1.22 charge → $2.44 refund_amount bug. So for that
          // one payment keep the already-synced value and only refresh its
          // status/reason below; every OTHER (manual) contributing payment still
          // needs its share added here.
          const alreadyCountedByStripeBlock = !!(stripeRefundId && payment && pid === payment.id);
          const newTotalRefund = alreadyCountedByStripeBlock
            ? Number(pRec.refund_amount || 0)
            : Number(pRec.refund_amount || 0) + allocateToThisPayment;
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

          // Was this payment already in a refunded state? If not, the status
          // write below is a first transition and the DB trigger will raise the
          // operator bell on its own.
          if (!["Refunded", "Partial Refund", "Reversed"].includes(String(pRec.status || ""))) {
            bellRaisedByTrigger = true;
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
    // The ledger is the customer-owes ledger, and availableForRefund is derived
    // from it — so recording a Refund row for money still sitting in the Stripe
    // balance marks the category settled and permanently blocks the retry. That
    // is the exact mechanism that strands a customer short.
    //
    // actualStripeRefunded is > 0 only on the succeeded-with-headroom path, where
    // it IS the amount Stripe moved. Every other path (manual/ledger-only,
    // requires_capture, skipped, exhausted PI) leaves it 0, so movedAmount ===
    // refundAmount and those paths are byte-identical to before.
    const movedAmount = actualStripeRefunded > 0 ? actualStripeRefunded : refundAmount;
    const unrecordedRemainder = Math.round((refundAmount - movedAmount) * 100) / 100;

    const shouldCreateLedger = refundResult && refundResult.type !== "error";
    console.log("Should create ledger entry:", shouldCreateLedger, "refundResult:", JSON.stringify(refundResult));

    if (shouldCreateLedger) {
      const today = new Date().toISOString().split('T')[0];
      const refundReference = `Refund: ${reason}${stripeRefundId ? ` (Stripe: ${stripeRefundId})` : ''}`;

      // The unique index (rental_id, due_date, type, category, extension_id)
      // means two refunds on the same category on the same day collide. Merge
      // into the existing refund row by adding to its amount, instead of
      // trying to INSERT a duplicate.
      let existingQuery = supabase
        .from("ledger_entries")
        .select("id, amount, reference")
        .eq("rental_id", rentalId)
        .eq("type", "Refund")
        .eq("category", category)
        .eq("due_date", today);
      if (extensionId) {
        existingQuery = existingQuery.eq("extension_id", extensionId);
      } else {
        existingQuery = existingQuery.is("extension_id", null);
      }
      const { data: existingRefund } = await existingQuery.maybeSingle();

      let ledgerError: any = null;
      if (existingRefund) {
        const mergedAmount = Number(existingRefund.amount) + (-Math.abs(movedAmount));
        const mergedRef = existingRefund.reference
          ? `${existingRefund.reference}; ${refundReference}`
          : refundReference;
        const { error } = await supabase
          .from("ledger_entries")
          .update({ amount: mergedAmount, reference: mergedRef })
          .eq("id", existingRefund.id);
        ledgerError = error;
        console.log("Merged refund into existing ledger entry:", existingRefund.id, "newAmount:", mergedAmount);
      } else {
        const ledgerEntry: Record<string, any> = {
          rental_id: rentalId,
          customer_id: rental.customer_id,
          vehicle_id: rental.vehicle_id,
          tenant_id: tenantId,
          entry_date: today,
          due_date: today,
          type: 'Refund',
          category: category,
          amount: -Math.abs(movedAmount),
          remaining_amount: 0,
          reference: refundReference,
        };
        if (extensionId) ledgerEntry.extension_id = extensionId;

        console.log("Creating ledger entry:", JSON.stringify(ledgerEntry));
        const { error } = await supabase.from("ledger_entries").insert(ledgerEntry);
        ledgerError = error;
      }

      if (ledgerError) {
        console.error("Failed to create/update ledger entry:", JSON.stringify(ledgerError));

        if (stripeRefundId) {
          // MONEY HAS ALREADY LEFT THE STRIPE BALANCE. Returning 500/success:false
          // here made the operator see "Refund Failed" and click again — and
          // because availableForRefund is derived ONLY from ledger_entries, which
          // is exactly the write that just failed, the retry re-passed validation
          // and issued a SECOND real Stripe refund. A ledger failure after a
          // successful refund is a RECONCILIATION problem, never a retryable one.
          ledgerRecordFailed = ledgerError.message || "unknown ledger error";
          console.error(
            `[process-refund][RECONCILE] Stripe refund ${stripeRefundId} SUCCEEDED but ledger write failed. rental=${rentalId} category=${category} extension=${extensionId ?? "-"} amount=${refundAmount} tenant=${tenantId}`
          );
        } else {
          // No Stripe refund was issued — a manual / ledger-only refund that
          // failed to write is a true no-op, so it stays a retryable 500.
          return new Response(
            JSON.stringify({
              success: false,
              error: `Failed to record refund ledger entry: ${ledgerError.message}`,
              refund: refundResult,
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

    }

    // Get customer and vehicle details for response
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("id", rental.customer_id)
      .single();

    // -------------------------------------------------------------------
    // Tell the customer and the operator. Before this, a refund — including a
    // partial deposit refund — notified NOBODY on this path: process-refund
    // invoked nothing, and notify-refund-processed's only caller was itself
    // unreachable. Verified live: two successive $1 partial refunds moved real
    // money and produced zero new bells and zero emails.
    //
    // Deliberately non-fatal: the money has already moved, so a mail failure
    // must never turn a successful refund into an error the operator retries.
    // -------------------------------------------------------------------
    if (refundResult && (refundResult as { type?: string }).type !== "error") {
      try {
        const totalRefundedForCategory = Number(totalAlreadyRefunded || 0) + Number(movedAmount || 0);
        const remainingHeld = Math.max(0, Number(totalPaid || 0) - totalRefundedForCategory);

        await supabase.functions.invoke("notify-refund-processed", {
          body: {
            customerName: customer?.name || "Customer",
            customerEmail: customer?.email || "",
            customerPhone: (customer as { phone?: string } | null)?.phone || undefined,
            bookingRef: rental.rental_number || rentalId.slice(0, 8).toUpperCase(),
            refundAmount: movedAmount,
            stripeRefundAmount: actualStripeRefunded || movedAmount,
            stripeRefundId: stripeRefundId || undefined,
            refundType,
            refundReason: reason,
            category,
            totalRefunded: totalRefundedForCategory,
            remainingHeld,
            rentalId,
            tenantId: rental.tenant_id || undefined,
            operatorBellAlreadyRaised: bellRaisedByTrigger,
          },
        });
      } catch (notifyErr) {
        console.error("[process-refund] notification failed (non-fatal):", notifyErr);
      }
    }

    return new Response(
      JSON.stringify({
        // `success` means "the refund is settled at Stripe", NOT "everything was
        // recorded". Callers must read requiresReconciliation to tell a clean
        // success from money-moved-but-unrecorded, and must NEVER treat
        // requiresReconciliation as a retry signal.
        success: true,
        ledgerRecorded: !ledgerRecordFailed,
        requiresReconciliation: !!ledgerRecordFailed,
        // What was asked for vs what actually moved and was recorded. These
        // differ only when the PaymentIntent had less headroom than requested;
        // the shortfall is deliberately NOT recorded, so it stays refundable
        // rather than leaving the customer short against a settled-looking
        // ledger.
        requestedAmount: refundAmount,
        recordedAmount: movedAmount,
        unrecordedRemainder: unrecordedRemainder > 0 ? unrecordedRemainder : 0,
        shortfallWarning: unrecordedRemainder > 0
          ? `Stripe could only return ${formatCurrency(movedAmount, currencyCode)} of the ${formatCurrency(refundAmount, currencyCode)} requested — that PaymentIntent had no more left. The remaining ${formatCurrency(unrecordedRemainder, currencyCode)} has NOT been refunded and has NOT been recorded, so it is still owed and still refundable.`
          : undefined,
        warning: ledgerRecordFailed
          ? `Stripe refund ${stripeRefundId} of ${formatCurrency(actualStripeRefunded || refundAmount, currencyCode)} SUCCEEDED, but the ledger entry could not be saved (${ledgerRecordFailed}). The money has already left the Stripe balance — do NOT retry this refund; it must be reconciled manually.`
          : undefined,
        message: ledgerRecordFailed
          ? `${category} refund sent to Stripe but NOT recorded in the ledger — reconciliation required`
          : `${category} refund processed successfully`,
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
