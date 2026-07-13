import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  getConnectAccountId,
  getChargePlatformAccount,
  getStripeClientForAccount,
  type StripeMode,
} from "../_shared/stripe-client.ts";

// void-payment-link
// -----------------
// Lets portal staff remove a single DUPLICATE / STALE unpaid payment LINK without
// rejecting the rental. A "payment link" is a `payments` row carrying a
// stripe_checkout_session_id. This is deliberately the OPPOSITE of reject_payment
// (which closes the whole rental, frees the vehicle, and emails the guest):
//   - it touches ONLY the one payments row (never rental_id / rental status / vehicle),
//   - it is fail-closed: it refuses anything that is real money (captured / paid /
//     applied / a deposit hold), so it can never wipe a payment that carries funds,
//   - it best-effort expires the Stripe Checkout session so a still-live link can no
//     longer be paid after it is voided.
// The row is soft-cancelled (status='Reversed', capture_status='cancelled') — never
// hard-deleted — so the history stays auditable, mirroring reverse-payment.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VoidRequest {
  paymentId: string;
  reason?: string;
  voidedBy?: string;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { paymentId, reason, voidedBy }: VoidRequest = await req.json();

    if (!paymentId) {
      return json({ success: false, error: "Payment ID is required" }, 400);
    }

    // 1. Load the payment row.
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      return json({ success: false, error: "Payment not found" }, 404);
    }

    // 1b. Tenant-isolation. The mutation below runs with the service-role client (which
    //     bypasses RLS), and verify_jwt only proves the caller is *some* authenticated
    //     user — so confirm the caller belongs to this payment's tenant. Super admins
    //     (tenant_id NULL) may act on any tenant. Blocks an authed user of tenant A from
    //     voiding tenant B's link.
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: authData } = await supabase.auth.getUser(jwt);
    if (!authData?.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    // Fetch ALL app_users rows for this auth user (staff can belong to more than one
    // tenant) and authorize if ANY is a super admin or matches the payment's tenant.
    // (.maybeSingle() would error->null for multi-tenant staff and falsely 401 them.)
    const { data: callers } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", authData.user.id);
    if (!callers || callers.length === 0) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const authorized = callers.some(
      (c) => c.is_super_admin || c.tenant_id === payment.tenant_id,
    );
    if (!authorized) {
      return json({ success: false, error: "You are not authorized to void this payment link." }, 403);
    }

    // 2. GUARDS — fail closed. Only an unpaid, un-captured, un-applied checkout LINK
    //    may be voided here.

    // Must be a payment link (has a checkout session).
    if (!payment.stripe_checkout_session_id) {
      return json({
        success: false,
        error: "This payment is not a payment link and cannot be voided here.",
      }, 400);
    }

    // Already voided — idempotent no-op guard.
    if (payment.capture_status === "cancelled" || payment.status === "Reversed") {
      return json({
        success: false,
        error: "This payment link has already been voided.",
      }, 400);
    }

    // Real money? Mirror isCaptured() from use-payment-links.ts EXACTLY so the UI and
    // the server agree on what counts as "paid". An uncaptured pre-auth hold carries
    // capture_status='requires_capture' and must NOT be treated as captured.
    const isCaptured =
      payment.capture_status === "captured" ||
      payment.stripe_payment_intent_id != null ||
      payment.paid_at != null ||
      (["Applied", "Completed", "Partial"].includes(payment.status) &&
        payment.capture_status !== "requires_capture");

    if (isCaptured) {
      return json({
        success: false,
        error:
          "This link has already been paid or captured — it cannot be voided. Use a refund instead.",
      }, 400);
    }

    // Deposit holds are live authorizations released via the deposit flow, not here.
    const isDepositHold =
      payment.payment_type === "InitialFee" &&
      payment.capture_status === "requires_capture" &&
      payment.preauth_expires_at != null;

    if (isDepositHold) {
      return json({
        success: false,
        error:
          "This is a deposit hold, not a payment link. Release it from the deposit section instead.",
      }, 400);
    }

    // An unpaid link should have no allocations. If it somehow does, refuse — voiding
    // would silently un-apply money.
    const { data: apps } = await supabase
      .from("payment_applications")
      .select("id")
      .eq("payment_id", paymentId)
      .limit(1);

    if (apps && apps.length > 0) {
      return json({
        success: false,
        error:
          "This payment has allocations against charges and cannot be voided as a link.",
      }, 400);
    }

    // 3. Best-effort: expire the Stripe Checkout session so a still-live (<24h) link
    //    can no longer be paid after we void it. Non-fatal — sessions older than ~24h
    //    are already expired Stripe-side, which throws here and is safely ignored.
    let stripeExpired = false;
    let stripeNote = "";
    try {
      const { data: tenant } = await supabase
        .from("tenants")
        .select(
          "id, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id",
        )
        .eq("id", payment.tenant_id)
        .single();

      if (tenant) {
        const mode = (tenant.stripe_mode as StripeMode) || "test";
        const platformAccount = getChargePlatformAccount(tenant);
        const stripe = getStripeClientForAccount(platformAccount, mode);
        const connectAccountId = getConnectAccountId(tenant);
        const opts = connectAccountId
          ? { stripeAccount: connectAccountId }
          : undefined;
        await stripe.checkout.sessions.expire(
          payment.stripe_checkout_session_id,
          opts as never,
        );
        stripeExpired = true;
      }
    } catch (e) {
      // Already expired / completed / different account — non-fatal. The row is
      // unpaid, so failing to expire the (usually already-dead) session does not
      // block the void.
      stripeNote = (e as { message?: string })?.message ?? String(e);
      console.log("void-payment-link: session expire skipped:", stripeNote);
    }

    // 4. Soft-cancel the payment row ONLY. Never touch rental / vehicle / charges.
    //    The .is(...) filters are a concurrency guard: if a webhook captured this row
    //    between our check and now, stripe_payment_intent_id / paid_at will be set and
    //    the update matches zero rows — we then bail instead of voiding real money.
    const note = `[VOIDED]${reason ? " " + reason : ""}${voidedBy ? " (by " + voidedBy + ")" : ""}`;

    const { data: updated, error: updateError } = await supabase
      .from("payments")
      .update({
        status: "Reversed",
        capture_status: "cancelled",
        remaining_amount: 0,
        refund_reason: note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .is("stripe_payment_intent_id", null)
      .is("paid_at", null)
      .select("id");

    if (updateError) {
      console.error("void-payment-link: update failed:", updateError);
      return json({ success: false, error: "Failed to void the payment link." }, 500);
    }

    if (!updated || updated.length === 0) {
      // The row changed state under us (most likely just got paid). Do not void.
      return json({
        success: false,
        error:
          "This link's state changed (it may have just been paid). Please refresh and try again.",
      }, 409);
    }

    return json({
      success: true,
      message: "Payment link voided",
      details: { paymentId, stripeExpired, stripeNote },
    }, 200);
  } catch (error) {
    console.error("void-payment-link error:", error);
    return json({ success: false, error: (error as { message?: string })?.message ?? "Unexpected error" }, 500);
  }
});
