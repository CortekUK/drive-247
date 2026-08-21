// audit-stripe-payment — READ-ONLY reconciliation helper.
//
// Fetches a PaymentIntent, its charges and its refunds straight from Stripe and
// returns them alongside what our database believes, so the two can be compared
// without anyone having to hold the Stripe secret locally.
//
// It performs NO writes, creates nothing at Stripe, and moves no money. It exists
// because "the numbers look right on screen" is not the same claim as "Stripe
// agrees with us", and only the second one is worth anything on a money path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getStripeClientForRecord, getConnectAccountId, type StripeMode } from "../_shared/stripe-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { rentalId, paymentIntentId, tenantSlug } = await req.json();
    if (!rentalId && !paymentIntentId) {
      return errorResponse("rentalId or paymentIntentId is required", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Orphan mode: look a PaymentIntent up directly, with no rental behind it.
    // This is how you check money that outlived its record — e.g. a rental that
    // was deleted while it still held a captured charge.
    if (paymentIntentId) {
      const { data: t } = await supabase
        .from("tenants")
        .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id")
        .eq("slug", tenantSlug || "test")
        .maybeSingle();
      const m: StripeMode = (t?.stripe_mode as StripeMode) || "test";
      const s2 = getStripeClientForRecord({ platform_account: "uae" }, m);
      const acct = getConnectAccountId({ ...(t ?? {}), payment_model: "own" });
      const o = acct ? { stripeAccount: acct } : undefined;
      const pi = await s2.paymentIntents.retrieve(paymentIntentId, {}, o);
      const rf = await s2.refunds.list({ payment_intent: paymentIntentId, limit: 100 }, o);
      const refunded = (rf.data ?? [])
        .filter((r: Record<string, any>) => r.status === "succeeded")
        .reduce((acc: number, r: Record<string, any>) => acc + Number(r.amount || 0), 0);
      const { count } = await supabase
        .from("payments").select("id", { count: "exact", head: true })
        .eq("stripe_payment_intent_id", paymentIntentId);
      const held = (pi.amount - refunded) / 100;
      return jsonResponse({
        orphan_check: {
          payment_intent: pi.id,
          status: pi.status,
          amount: pi.amount / 100,
          refunded: refunded / 100,
          still_held_at_stripe: held,
          db_payment_rows: count ?? 0,
          verdict: (count ?? 0) === 0 && held > 0
            ? "ORPHANED — captured at Stripe with no payment record in the database"
            : "has a database record",
        },
      });
    }

    const { data: rental } = await supabase
      .from("rentals")
      .select("id, rental_number, tenant_id, platform_account")
      .eq("id", rentalId)
      .maybeSingle();
    if (!rental) return errorResponse("Rental not found", 404);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
      .eq("id", rental.tenant_id)
      .maybeSingle();

    const mode: StripeMode = (tenant?.stripe_mode as StripeMode) || "test";

    const { data: payments } = await supabase
      .from("payments")
      .select("id, amount, status, refund_amount, capture_status, stripe_payment_intent_id, stripe_refund_id, platform_account, target_categories")
      .eq("rental_id", rentalId)
      .not("stripe_payment_intent_id", "is", null);

    const results: unknown[] = [];

    for (const p of payments ?? []) {
      // Record-anchored: an object created on one platform account must be read
      // with that account's credentials, even if the tenant has since flipped.
      const stripe = getStripeClientForRecord(p, mode);
      const connectAccountId = getConnectAccountId({
        ...(tenant ?? {}),
        payment_model: p.platform_account === "uae" ? "own" : "managed",
      });
      const opts = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

      try {
        const pi = await stripe.paymentIntents.retrieve(
          p.stripe_payment_intent_id as string,
          { expand: ["charges", "latest_charge"] },
          opts,
        );

        const refunds = await stripe.refunds.list(
          { payment_intent: p.stripe_payment_intent_id as string, limit: 100 },
          opts,
        );

        const latestCharge = (pi as Record<string, any>).latest_charge;
        const chargeObj = typeof latestCharge === "object" ? latestCharge : null;

        const stripeRefundedMinor = (refunds.data ?? [])
          .filter((r: Record<string, any>) => r.status === "succeeded")
          .reduce((s: number, r: Record<string, any>) => s + Number(r.amount || 0), 0);

        const dbAmountMinor = Math.round(Number(p.amount || 0) * 100);
        const dbRefundedMinor = Math.round(Number(p.refund_amount || 0) * 100);

        results.push({
          db: {
            payment_id: p.id,
            amount: p.amount,
            status: p.status,
            refund_amount: p.refund_amount,
            capture_status: p.capture_status,
            target_categories: p.target_categories,
            stripe_refund_ids: p.stripe_refund_id,
          },
          stripe: {
            payment_intent: pi.id,
            status: pi.status,
            currency: pi.currency,
            amount: pi.amount / 100,
            amount_received: (pi.amount_received ?? 0) / 100,
            captured: chargeObj ? chargeObj.captured : null,
            amount_refunded_on_charge: chargeObj ? (chargeObj.amount_refunded ?? 0) / 100 : null,
            connect_account: connectAccountId ?? "platform",
            refunds: (refunds.data ?? []).map((r: Record<string, any>) => ({
              id: r.id, amount: r.amount / 100, status: r.status, reason: r.reason,
            })),
          },
          reconciliation: {
            amount_matches: dbAmountMinor === pi.amount,
            refund_total_matches: dbRefundedMinor === stripeRefundedMinor,
            db_refunded: dbRefundedMinor / 100,
            stripe_refunded: stripeRefundedMinor / 100,
            net_at_stripe: (pi.amount - stripeRefundedMinor) / 100,
          },
        });
      } catch (err) {
        results.push({
          db: { payment_id: p.id, amount: p.amount, stripe_payment_intent_id: p.stripe_payment_intent_id },
          stripe_error: (err as { message?: string })?.message ?? String(err),
        });
      }
    }

    return jsonResponse({
      rental: { id: rental.id, rental_number: rental.rental_number },
      mode,
      payments: results,
    });
  } catch (err) {
    return errorResponse((err as { message?: string })?.message ?? "audit failed", 500);
  }
});
