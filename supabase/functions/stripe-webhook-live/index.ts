// Stripe Webhook Handler - LIVE MODE
// Handles webhook events from Stripe live mode

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { formatCurrency } from '../_shared/format-utils.ts';
import { getStripeClientForAccount, getWebhookSecretCandidates } from '../_shared/stripe-client.ts';
import { notifyOperatorsInApp } from '../_shared/notify-inapp.ts';
import { sendEmail, getTenantNotificationRecipient, isOperatorEmailEnabled } from '../_shared/resend-service.ts';

// Initialize Stripe with LIVE secret key (legacy UK platform)
const ukStripe = new Stripe(Deno.env.get("STRIPE_LIVE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

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

    const signature = req.headers.get("stripe-signature");
    const body = await req.text();
    const connectSecret = Deno.env.get("STRIPE_LIVE_CONNECT_WEBHOOK_SECRET");
    const uaeSecret = Deno.env.get("STRIPE_UAE_LIVE_WEBHOOK_SECRET");
    // During the UAE migration this endpoint is registered on BOTH platform
    // accounts, so verification must try every candidate secret:
    // legacy platform, UAE platform, then the legacy Connect endpoint secret.
    const secretCandidates = [
      ...getWebhookSecretCandidates("live"),
      ...(connectSecret ? [connectSecret] : []),
    ];

    // Downstream Stripe API calls must use the platform account the event came
    // from — default to the legacy UK client, swap to UAE if its secret verifies.
    let stripe = ukStripe;
    let platformAccount: "uk" | "uae" = "uk";

    let event: Stripe.Event;

    // Verify webhook signature - try each candidate secret until one succeeds
    if (signature && secretCandidates.length > 0) {
      let verified = false;
      let lastErr: any = null;

      for (const secret of secretCandidates) {
        try {
          event = stripe.webhooks.constructEvent(body, signature, secret);
          verified = true;
          if (uaeSecret && secret === uaeSecret) {
            stripe = getStripeClientForAccount("uae", "live");
            platformAccount = "uae";
            console.log("[LIVE MODE] Verified with UAE platform webhook secret");
          } else {
            console.log("[LIVE MODE] Verified with legacy webhook secret");
          }
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!verified) {
        console.error("[LIVE MODE] Webhook signature verification failed with all secrets:", lastErr?.message);
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // For testing without signature verification
      event = JSON.parse(body) as Stripe.Event;
      console.warn("[LIVE MODE] Webhook signature not verified - no secret configured");
    }

    console.log("[LIVE MODE] Stripe webhook received:", event.type);

    // For direct charges with Stripe Connect, events from connected accounts
    // will have event.account set to the connected account ID
    const connectedAccountId = (event as any).account as string | undefined;
    if (connectedAccountId) {
      console.log("Event from connected account:", connectedAccountId);
    }

    // stripeOptions for any Stripe API calls that need to target the connected account
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session completed:", session.id);

        const rentalId = session.client_reference_id || session.metadata?.rental_id;
        const isPreAuth = session.metadata?.preauth_mode === "true";
        const isExtension = session.metadata?.type === "extension";
        const isExcessMileage = session.metadata?.type === "excess_mileage";
        const isInstallment = session.metadata?.checkout_type === "installment" || session.metadata?.checkout_type === "installment_upfront";

        // Handle invoice payments (emailed payment links)
        const isInvoicePayment = session.metadata?.type === "invoice_payment";
        const invoiceId = session.metadata?.invoice_id;

        // Account-level "collect then decide": commit captured money as
        // UNALLOCATED account credit (no rental). Runs before the rental-id
        // skip below because these sessions intentionally have no rental.
        if (session.metadata?.hold_as_credit === "true") {
          const creditCustomerId = session.metadata?.customer_id || null;
          const paidAmount = (session.amount_total || 0) / 100;
          const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

          const { data: existingCredit } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .maybeSingle();

          let creditPaymentId: string | null = existingCredit?.id ?? null;
          if (creditPaymentId) {
            await supabase.from("payments").update({
              status: "Completed",
              capture_status: "captured",
              verification_status: "auto_approved",
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: paymentIntentId || null,
            }).eq("id", creditPaymentId);
          } else if (creditCustomerId) {
            // Fallback: create-checkout-session didn't pre-create the row.
            const { data: newCredit } = await supabase.from("payments").insert({
              customer_id: creditCustomerId,
              tenant_id: session.metadata?.tenant_id || null,
              amount: paidAmount,
              payment_date: new Date().toISOString().split("T")[0],
              method: "Card",
              payment_type: "Payment",
              status: "Completed",
              remaining_amount: paidAmount,
              capture_status: "captured",
              verification_status: "auto_approved",
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: paymentIntentId || null,
              stripe_checkout_session_id: session.id,
              booking_source: "admin",
              platform_account: platformAccount,
            }).select("id").single();
            creditPaymentId = newCredit?.id ?? null;
          }

          if (creditPaymentId) {
            const { error: applyError } = await supabase.functions.invoke("apply-payment", {
              body: { paymentId: creditPaymentId, holdAsCredit: true },
            });
            if (applyError) console.error("[LIVE MODE] hold-as-credit apply-payment error:", applyError);
            else console.log("[LIVE MODE] payment held as account credit:", creditPaymentId);
          } else {
            console.warn("[LIVE MODE] hold_as_credit session with no payment row and no customer_id:", session.id);
          }
          break;
        }

        if (!rentalId && !isInvoicePayment) {
          console.log("No rental ID in session and not an invoice payment, skipping");
          break;
        }

        if (isInvoicePayment && invoiceId) {
          console.log("[LIVE MODE] Invoice payment completed. Invoice:", invoiceId);

          const paidAmount = (session.amount_total || 0) / 100;
          const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
          const invoiceRentalId = session.metadata?.rental_id || null;

          // Find the pre-created payment record
          const { data: existingPayment } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .maybeSingle();

          if (existingPayment) {
            await supabase
              .from("payments")
              .update({
                status: "Completed",
                capture_status: "captured",
                paid_at: new Date().toISOString(),
                stripe_payment_intent_id: paymentIntentId || null,
                // Stripe captured the money — nothing left for staff to verify.
                // Pre-created rows default to 'pending', which (among other
                // things) hides the revenue from owner payouts (GMT incident).
                verification_status: "auto_approved",
              })
              .eq("id", existingPayment.id);

            console.log("[LIVE MODE] Payment updated:", existingPayment.id);

            const { data: applyResult, error: applyError } = await supabase.functions.invoke("apply-payment", {
              body: { paymentId: existingPayment.id },
            });

            if (applyError) {
              console.error("[LIVE MODE] apply-payment error:", applyError);
            } else {
              console.log("[LIVE MODE] apply-payment result:", applyResult?.status, "allocated:", applyResult?.allocated);
            }
          } else {
            console.log("[LIVE MODE] No pre-created payment found for session:", session.id, "— creating one");

            if (invoiceRentalId) {
              const { data: invoice } = await supabase.from("invoices").select("customer_id, vehicle_id").eq("id", invoiceId).maybeSingle();

              const { data: newPayment } = await supabase
                .from("payments")
                .insert({
                  customer_id: invoice?.customer_id || null,
                  vehicle_id: invoice?.vehicle_id || null,
                  rental_id: invoiceRentalId,
                  amount: paidAmount,
                  payment_type: "Payment",
                  status: "Completed",
                  capture_status: "captured",
                  method: "Card",
                  paid_at: new Date().toISOString(),
                  stripe_payment_intent_id: paymentIntentId || null,
                  stripe_checkout_session_id: session.id,
                  tenant_id: session.metadata?.tenant_id || null,
                  platform_account: platformAccount,
                  verification_status: "auto_approved",
                })
                .select()
                .single();

              if (newPayment) {
                const { data: applyResult } = await supabase.functions.invoke("apply-payment", {
                  body: { paymentId: newPayment.id },
                });
                console.log("[LIVE MODE] Fallback payment created and applied:", newPayment.id, applyResult?.status);
              }
            }
          }

          await supabase.from("invoices").update({ status: "paid" }).eq("id", invoiceId);
          console.log("[LIVE MODE] Invoice marked as paid:", invoiceId);

          break;
        }

        // Handle installment checkout completion
        if (isInstallment) {
          console.log("[LIVE MODE] Installment checkout completed for rental:", rentalId);

          // Update upfront payment record with payment intent ID
          const { data: existingPaymentRecord, error: paymentRecordError } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .maybeSingle();

          if (paymentRecordError) {
            console.error("[LIVE MODE] Error fetching payment record for session:", session.id, paymentRecordError);
          }

          let upfrontPaymentId: string | null = null;

          if (existingPaymentRecord) {
            await supabase
              .from("payments")
              .update({
                stripe_payment_intent_id: session.payment_intent as string,
                status: "Applied",
                capture_status: "captured",
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingPaymentRecord.id);
            upfrontPaymentId = existingPaymentRecord.id;
            console.log("[LIVE MODE] Updated upfront payment:", existingPaymentRecord.id);
          } else {
            // Payment record missing (e.g. portal-created plan) — create it from session data
            console.log("[LIVE MODE] No upfront payment record found for session — creating one");
            const upfrontAmount = session.amount_total ? session.amount_total / 100 : 0;
            const customerId = session.metadata?.customer_id;
            const sessionTenantId = session.metadata?.tenant_id;

            if (upfrontAmount > 0 && customerId) {
              const { data: rental } = await supabase
                .from("rentals")
                .select("vehicle_id")
                .eq("id", rentalId)
                .single();

              const { data: newPayment } = await supabase
                .from("payments")
                .insert({
                  customer_id: customerId,
                  rental_id: rentalId,
                  vehicle_id: rental?.vehicle_id,
                  amount: upfrontAmount,
                  payment_date: new Date().toISOString().split("T")[0],
                  method: "Card",
                  payment_type: "InitialFee",
                  status: "Applied",
                  verification_status: "auto_approved",
                  stripe_checkout_session_id: session.id,
                  stripe_payment_intent_id: session.payment_intent as string,
                  capture_status: "captured",
                  booking_source: "website",
                  platform_account: platformAccount,
                  ...(sessionTenantId ? { tenant_id: sessionTenantId } : {}),
                })
                .select()
                .single();

              if (newPayment) {
                upfrontPaymentId = newPayment.id;
                console.log("[LIVE MODE] Created upfront payment record:", newPayment.id);
              }
            }
          }

          // Activate the installment plan
          console.log("[LIVE MODE] Looking for pending installment plan for rental:", rentalId);
          const { data: installmentPlans, error: planError } = await supabase
            .from("installment_plans")
            .select("id")
            .eq("rental_id", rentalId)
            .eq("status", "pending");

          if (planError) {
            console.error("[LIVE MODE] Error fetching installment plan for rental:", rentalId, planError);
          }

          console.log("[LIVE MODE] Installment plans query result:", JSON.stringify(installmentPlans));
          const installmentPlan = installmentPlans && installmentPlans.length > 0 ? installmentPlans[0] : null;

          if (!installmentPlan) {
            console.error("[LIVE MODE] No pending installment plan found for rental:", rentalId, "- skipping activation. Plans found:", installmentPlans?.length ?? 0);
          }

          if (installmentPlan) {
            // Get the payment method ID from the PaymentIntent
            let paymentMethodId: string | null = null;
            if (session.payment_intent) {
              try {
                const paymentIntent = await stripe.paymentIntents.retrieve(
                  session.payment_intent as string,
                  stripeOptions
                );
                paymentMethodId = paymentIntent.payment_method as string;
                console.log("[LIVE MODE] Retrieved payment method from PaymentIntent:", paymentMethodId);
              } catch (err) {
                console.error("[LIVE MODE] Error retrieving PaymentIntent for payment method:", err);
              }
            }

            // Check if first installment was charged upfront
            const chargeFirstUpfront = session.metadata?.charge_first_upfront !== 'false';
            let paidInstallments = 0;
            let totalPaidAmount = 0;

            if (chargeFirstUpfront) {
              // Mark the first installment as paid
              const { data: firstInstallment } = await supabase
                .from("scheduled_installments")
                .select("id, amount")
                .eq("installment_plan_id", installmentPlan.id)
                .eq("installment_number", 1)
                .single();

              if (firstInstallment) {
                await supabase
                  .from("scheduled_installments")
                  .update({
                    status: "paid",
                    paid_at: new Date().toISOString(),
                    payment_id: upfrontPaymentId,
                    stripe_payment_intent_id: session.payment_intent as string,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", firstInstallment.id);
                console.log("[LIVE MODE] First installment marked as paid:", firstInstallment.id);
                paidInstallments = 1;
                totalPaidAmount = firstInstallment.amount;
              }
            }

            // Activate the plan and update counters
            const stripeCustomerId = session.customer as string;
            const { error: activateError } = await supabase
              .from("installment_plans")
              .update({
                status: "active",
                upfront_paid: true,
                upfront_payment_id: upfrontPaymentId,
                stripe_payment_method_id: paymentMethodId,
                ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
                paid_installments: paidInstallments,
                total_paid: totalPaidAmount,
                updated_at: new Date().toISOString(),
              })
              .eq("id", installmentPlan.id);

            if (activateError) {
              console.error("[LIVE MODE] Error activating installment plan:", activateError);
            } else {
              console.log("[LIVE MODE] Installment plan activated:", installmentPlan.id);
            }

            // Update rental status
            const { error: rentalUpdateError } = await supabase
              .from("rentals")
              .update({
                payment_status: "fulfilled",
                updated_at: new Date().toISOString(),
              })
              .eq("id", rentalId);

            if (rentalUpdateError) {
              console.error("[LIVE MODE] Error updating rental payment status:", rentalUpdateError);
            }

            // Trigger FIFO ledger allocation for the upfront payment
            if (upfrontPaymentId) {
              try {
                const applyResponse = await fetch(
                  `${Deno.env.get("SUPABASE_URL")}/functions/v1/apply-payment`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                    },
                    body: JSON.stringify({ paymentId: upfrontPaymentId }),
                  }
                );
                if (applyResponse.ok) {
                  console.log("[LIVE MODE] Installment upfront payment FIFO allocation completed");
                } else {
                  console.error("[LIVE MODE] Installment FIFO allocation failed:", await applyResponse.text());
                }
              } catch (applyError) {
                console.error("[LIVE MODE] Error applying installment payment:", applyError);
              }
            }
          }

          // Send booking confirmation notification
          try {
            const { data: rental } = await supabase
              .from("rentals")
              .select(`
                id, start_date, end_date, monthly_amount, tenant_id,
                customer:customers(id, name, email, phone),
                vehicle:vehicles(id, make, model, reg)
              `)
              .eq("id", rentalId)
              .single();

            if (rental && rental.customer && rental.vehicle) {
              const vehicleName = rental.vehicle.make && rental.vehicle.model
                ? `${rental.vehicle.make} ${rental.vehicle.model}`
                : rental.vehicle.reg;

              await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-booking-pending`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({
                    paymentId: upfrontPaymentId || '',
                    rentalId,
                    tenantId: rental.tenant_id,
                    customerId: rental.customer.id,
                    customerName: rental.customer.name,
                    customerEmail: rental.customer.email,
                    customerPhone: rental.customer.phone,
                    vehicleName,
                    vehicleMake: rental.vehicle.make,
                    vehicleModel: rental.vehicle.model,
                    vehicleReg: rental.vehicle.reg,
                    pickupDate: new Date(rental.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                    returnDate: new Date(rental.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                    amount: rental.monthly_amount || (session.amount_total ? session.amount_total / 100 : 0),
                    bookingRef: rentalId.substring(0, 8).toUpperCase(),
                    paymentMode: 'installment',
                  }),
                }
              );
              console.log("[LIVE MODE] Installment booking notification sent");
            }
          } catch (notifyError) {
            console.error("[LIVE MODE] Error sending installment booking notification:", notifyError);
          }

          break;
        }

        // Handle extension payment completion
        if (isExtension) {
          console.log("Extension checkout completed for rental:", rentalId);

          // Find payment by stripe_checkout_session_id and update status.
          // Use .maybeSingle() + deterministic ordering: duplicates exist in legacy
          // data and webhook retries can race. Prefer the most recent row.
          const { data: extensionPayment, error: extPaymentError } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (extensionPayment) {
            await supabase
              .from("payments")
              .update({
                status: "Completed",
                capture_status: "captured",
                stripe_payment_intent_id: session.payment_intent as string,
                // Stripe captured the money — auto-approve. Extension payments
                // were inserted as 'pending' and never flipped, which hid ALL
                // long-running-rental revenue from owner payouts (GMT incident).
                verification_status: "auto_approved",
                updated_at: new Date().toISOString(),
              })
              .eq("id", extensionPayment.id);

            console.log("Updated extension payment to Completed:", extensionPayment.id);

            // Trigger FIFO allocation via apply-payment
            try {
              const applyResponse = await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/apply-payment`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({
                    paymentId: extensionPayment.id,
                    targetCategories: session.metadata?.target_categories
                      ? JSON.parse(session.metadata.target_categories)
                      : ['Extension Rental', 'Extension Tax', 'Extension Service Fee', 'Extension Insurance'],
                  }),
                }
              );
              if (applyResponse.ok) {
                console.log("Extension payment allocation completed");
              } else {
                console.error("FIFO allocation failed:", await applyResponse.text());
              }
            } catch (applyError) {
              console.error("Error applying extension payment:", applyError);
            }

            // Roll the rental forward + mark the extension paid (idempotent).
            // The booking-success page finalizes too, but the webhook is the
            // authoritative signal — finalize here so auto-extension renewals
            // sync even if the customer never completes the browser redirect.
            //
            // Read the rental's auto-extend state up front so we can (a) fall back
            // to its parked pending extension when session.metadata.extension_id is
            // missing — otherwise auto-extension pay-links whose session lacked the
            // metadata never finalized, the payment stranded as an unallocated
            // Credit, the extension stayed "approved", and the rental sat paused —
            // and (b) reuse it for the auto-extend sync below.
            const { data: aeRental } = await supabase
              .from("rentals")
              .select("auto_extend_enabled, auto_extend_pending_extension_id, auto_extend_charge_count")
              .eq("id", rentalId)
              .maybeSingle();

            let extIdMeta = session.metadata?.extension_id as string | undefined;
            if (!extIdMeta && aeRental?.auto_extend_pending_extension_id) {
              extIdMeta = aeRental.auto_extend_pending_extension_id;
              console.log("Resolved extension_id from parked pending extension:", extIdMeta);
            }

            let finalizeOk = false;
            if (extIdMeta) {
              const { error: finalizeErr } = await supabase.rpc("finalize_rental_extension", {
                p_extension_id: extIdMeta,
                p_payment_id: extensionPayment.id,
              });
              if (finalizeErr) {
                console.error("[LIVE MODE] finalize_rental_extension error:", finalizeErr);
              } else {
                finalizeOk = true;
                console.log("Extension finalized via webhook:", extIdMeta);
              }
            }

            // Auto-extension: a paid pay-link must return the rental to "active"
            // right away. finalize_rental_extension rolls end_date forward and
            // marks the extension paid, but it does NOT touch the auto_extend_*
            // columns — so without this the rental lingered in "awaiting_payment"
            // (pending id still set) until the next 15-min cron tick, and the
            // charge_count that drives auto_extend_max_periods never advanced for
            // pay-link renewals. Guarded by pending_extension_id === extIdMeta so
            // webhook retries can't double-increment. Also clears the paused flag:
            // a rental that had auto-paused past the grace window must un-pause
            // when its renewal is finally paid, or both crons keep skipping it.
            // Gated on finalizeOk: if finalize failed, end_date was NOT rolled and
            // the extension was NOT marked paid — so we must leave the rental paused
            // with its pending id intact (recoverable) rather than clear the parked
            // week and advance charge_count against a period that was never applied.
            if (
              finalizeOk &&
              aeRental?.auto_extend_enabled &&
              aeRental.auto_extend_pending_extension_id &&
              aeRental.auto_extend_pending_extension_id === extIdMeta
            ) {
              try {
                await supabase
                  .from("rentals")
                  .update({
                    auto_extend_pending_extension_id: null,
                    auto_extend_status: "active",
                    auto_extend_paused: false,
                    auto_extend_paused_at: null,
                    auto_extend_charge_count: (aeRental.auto_extend_charge_count || 0) + 1,
                    auto_extend_failed_attempts: 0,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", rentalId);
                console.log("Auto-extend rental returned to active after payment:", rentalId);
              } catch (aeErr) {
                console.error("Auto-extend post-payment sync error:", aeErr);
              }
            }
          } else {
            console.error("No extension payment found for session:", session.id, extPaymentError?.message);
          }

          break;
        }

        // Handle excess mileage payment
        if (isExcessMileage) {
          console.log("[LIVE MODE] Excess mileage payment completed for rental:", rentalId);

          // Find payment by stripe_checkout_session_id and update status
          const { data: excessPayment } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .single();

          if (excessPayment) {
            await supabase
              .from("payments")
              .update({
                status: "Completed",
                capture_status: "captured",
                stripe_payment_intent_id: session.payment_intent as string,
                updated_at: new Date().toISOString(),
              })
              .eq("id", excessPayment.id);

            console.log("[LIVE MODE] Updated excess mileage payment to Completed:", excessPayment.id);
          }

          // Find the Excess Mileage charge and mark it as paid
          const excessRentalId = session.metadata?.rental_id || rentalId;
          if (excessRentalId) {
            const { data: excessCharge } = await supabase
              .from("ledger_entries")
              .select("id, remaining_amount")
              .eq("rental_id", excessRentalId)
              .eq("type", "Charge")
              .eq("category", "Excess Mileage")
              .single();

            if (excessCharge) {
              const paidAmount = session.amount_total ? session.amount_total / 100 : excessCharge.remaining_amount;
              const newRemaining = Math.max(0, excessCharge.remaining_amount - paidAmount);

              await supabase
                .from("ledger_entries")
                .update({ remaining_amount: newRemaining })
                .eq("id", excessCharge.id);

              console.log("[LIVE MODE] Excess mileage charge updated:", excessCharge.id, "remaining:", newRemaining);
            }
          }

          break;
        }

        if (isPreAuth) {
          // Pre-auth mode: Just log - payment is held, not captured
          console.log("Pre-auth checkout completed, awaiting admin approval");

          // Update payment record - look up by stripe_checkout_session_id since payment_id
          // is not in metadata (Stripe doesn't allow updating session metadata after creation)
          const { data: existingPaymentRecord, error: paymentLookupError } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .single();

          if (existingPaymentRecord) {
            const { error: updateError } = await supabase
              .from("payments")
              .update({
                stripe_payment_intent_id: session.payment_intent as string,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingPaymentRecord.id);

            if (updateError) {
              console.error("Failed to update payment with stripe_payment_intent_id:", updateError);
            } else {
              console.log("Updated payment", existingPaymentRecord.id, "with stripe_payment_intent_id:", session.payment_intent);
            }
          } else if (paymentLookupError) {
            console.log("No existing payment record found for session:", session.id, paymentLookupError.message);
          }

          // Get paymentId for notification (from lookup or metadata fallback)
          const paymentId = existingPaymentRecord?.id || session.metadata?.payment_id;

          // Send booking pending notification emails
          try {
            // Get rental details with customer and vehicle info
            const { data: rental } = await supabase
              .from("rentals")
              .select(`
                id,
                start_date,
                end_date,
                monthly_amount,
                tenant_id,
                customer:customers(id, name, email, phone),
                vehicle:vehicles(id, make, model, reg)
              `)
              .eq("id", rentalId)
              .single();

            if (rental && rental.customer && rental.vehicle) {
              const vehicleName = rental.vehicle.make && rental.vehicle.model
                ? `${rental.vehicle.make} ${rental.vehicle.model}`
                : rental.vehicle.reg;

              const notificationData = {
                paymentId: paymentId || '',
                rentalId: rentalId,
                tenantId: rental.tenant_id, // Required for tenant-specific templates and admin email
                customerId: rental.customer.id,
                customerName: rental.customer.name,
                customerEmail: rental.customer.email,
                customerPhone: rental.customer.phone,
                vehicleName: vehicleName,
                vehicleMake: rental.vehicle.make,
                vehicleModel: rental.vehicle.model,
                vehicleReg: rental.vehicle.reg,
                pickupDate: new Date(rental.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                returnDate: new Date(rental.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                amount: rental.monthly_amount || (session.amount_total ? session.amount_total / 100 : 0),
                bookingRef: rentalId.substring(0, 8).toUpperCase(),
              };

              console.log("Sending booking pending notification:", notificationData.bookingRef);

              const notifyResponse = await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-booking-pending`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify(notificationData),
                }
              );

              if (notifyResponse.ok) {
                console.log("Booking notification sent successfully");
              } else {
                console.error("Failed to send booking notification:", await notifyResponse.text());
              }
            }
          } catch (notifyError) {
            console.error("Error sending booking notification:", notifyError);
            // Don't fail the webhook for notification errors
          }
        } else {
          // Auto mode: Payment was captured
          const isPortalPayment = session.metadata?.source === 'portal';
          console.log("Auto checkout completed:", rentalId, isPortalPayment ? "(portal-initiated)" : "(booking flow)");

          // For booking flow payments, update rental payment_status
          if (!isPortalPayment) {
            const { error: rentalUpdateError } = await supabase
              .from("rentals")
              .update({
                payment_status: "fulfilled",
                updated_at: new Date().toISOString(),
              })
              .eq("id", rentalId);

            if (rentalUpdateError) {
              console.error("Failed to update rental payment_status:", rentalUpdateError);
            } else {
              console.log("Rental payment_status updated to fulfilled");
            }
          }

          // Find existing payment (created by create-checkout-session with Pending status)
          const { data: existingPayment } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .single();

          let finalPaymentId: string | null = null;

          if (existingPayment) {
            // Update existing Pending payment to Completed
            const { error: updateError } = await supabase
              .from("payments")
              .update({
                status: "Completed",
                capture_status: "captured",
                verification_status: "auto_approved",
                stripe_payment_intent_id: session.payment_intent as string,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingPayment.id);

            if (updateError) {
              console.error("Failed to update payment to Completed:", updateError);
            } else {
              console.log("Payment updated to Completed:", existingPayment.id);
            }
            finalPaymentId = existingPayment.id;
          } else {
            // No existing payment — create one (legacy booking flow)
            const { data: rental } = await supabase
              .from("rentals")
              .select("customer_id, vehicle_id, monthly_amount, tenant_id")
              .eq("id", rentalId)
              .single();

            if (rental) {
              const paymentAmount = session.amount_total ? session.amount_total / 100 : rental.monthly_amount;
              const today = new Date().toISOString().split("T")[0];

              const paymentData: any = {
                rental_id: rentalId,
                customer_id: rental.customer_id,
                vehicle_id: rental.vehicle_id,
                amount: paymentAmount,
                payment_date: today,
                apply_from_date: today,
                method: "Card",
                payment_type: "Payment",
                status: "Completed",
                remaining_amount: paymentAmount,
                verification_status: "auto_approved",
                stripe_checkout_session_id: session.id,
                stripe_payment_intent_id: session.payment_intent as string,
                capture_status: "captured",
                booking_source: "website",
                platform_account: platformAccount,
              };

              if (rental.tenant_id) {
                paymentData.tenant_id = rental.tenant_id;
              }

              const { data: newPayment, error: paymentError } = await supabase
                .from("payments")
                .insert(paymentData)
                .select()
                .single();

              if (paymentError) {
                console.error("Failed to create payment record:", paymentError);
              } else {
                console.log("Payment record created from webhook:", newPayment.id);
                finalPaymentId = newPayment.id;
              }
            }
          }

          // Trigger FIFO allocation via apply-payment
          if (finalPaymentId) {
            try {
              const targetCategories = session.metadata?.target_categories
                ? JSON.parse(session.metadata.target_categories)
                : undefined;

              console.log("Triggering apply-payment for:", finalPaymentId, targetCategories ? `categories: ${targetCategories.join(', ')}` : "(universal FIFO)");

              const applyResponse = await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/apply-payment`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({
                    paymentId: finalPaymentId,
                    ...(targetCategories ? { targetCategories } : {}),
                  }),
                }
              );
              if (applyResponse.ok) {
                console.log("Payment FIFO allocation completed");
              } else {
                console.error("FIFO allocation failed:", await applyResponse.text());
              }
            } catch (applyError) {
              console.error("Error applying payment:", applyError);
            }

            const paygAccrualId = session.metadata?.payg_accrual_id;
            if (paygAccrualId) {
              const { error: settleErr } = await supabase.rpc("payg_settle_invoice", {
                p_payment_id: finalPaymentId,
                p_accrual_id: paygAccrualId,
              });
              if (settleErr) {
                console.error("PAYG settle_invoice failed:", settleErr);
              } else {
                console.log("PAYG invoice settled:", paygAccrualId);
              }
            }

            let installmentId = session.metadata?.installment_id;
            const installmentPlanId = session.metadata?.installment_plan_id;

            // SELF-HEAL FALLBACK (mirrors stripe-webhook-test). When the
            // dialog forgot to stamp installment_id but the rental has an
            // installment plan and the payment isn't for an extension/
            // bonzah/etc., resolve the latest overdue or due-today open
            // slot from the DB. installment_settle_invoice cumulatively
            // supersedes earlier opens so this matches PAYG-style
            // "pay latest, earlier ones clear" behavior.
            //
            // CRITICAL GUARD: skip self-heal when this payment is
            // category-targeted to fees only (Tax, Service Fee, etc.). A
            // Tax payment must never settle an installment slot — that
            // corrupts the plan (flips upfront_paid=true, stamps
            // upfront_payment_id with the wrong payment) and leaves the
            // Tax ledger entry untouched, so the UI shows "Tax: Not Paid"
            // while the installment side records the money. The explicit
            // case (installmentId stamped by the dialog) is unaffected.
            const rentalIdFromMeta = session.metadata?.rental_id;
            const hasExtensionId = !!session.metadata?.extension_id;
            const hasBonzahId = !!session.metadata?.bonzah_policy_id;
            const targetCategoriesMeta: string[] | null = session.metadata?.target_categories
              ? (() => { try { return JSON.parse(session.metadata!.target_categories!); } catch { return null; } })()
              : null;
            const isCategoryTargeted = Array.isArray(targetCategoriesMeta) && targetCategoriesMeta.length > 0;
            const targetsIncludeRental = isCategoryTargeted && targetCategoriesMeta!.includes("Rental");
            const allowInstallmentSelfHeal = !isCategoryTargeted || targetsIncludeRental;
            if (!installmentId && finalPaymentId && rentalIdFromMeta && !hasExtensionId && !hasBonzahId && allowInstallmentSelfHeal) {
              try {
                const todayStr = new Date().toISOString().split("T")[0];
                const { data: targetSlot } = await supabase
                  .from("scheduled_installments")
                  .select("id, installment_number, due_date, installment_plan_id")
                  .eq("rental_id", rentalIdFromMeta)
                  .eq("invoice_status", "open")
                  .lte("due_date", todayStr)
                  .order("installment_number", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (targetSlot) {
                  installmentId = targetSlot.id;
                  console.log("Installment self-heal: resolved", targetSlot.id, "from rental", rentalIdFromMeta, "(slot", targetSlot.installment_number + ")");
                }
              } catch (fbErr) {
                console.error("Installment self-heal lookup failed:", fbErr);
              }
            } else if (!installmentId && finalPaymentId && rentalIdFromMeta && !hasExtensionId && !hasBonzahId && !allowInstallmentSelfHeal) {
              console.log(`[LIVE MODE] Skipping installment self-heal: payment is targeted to non-Rental categories (${targetCategoriesMeta!.join(", ")}). Installment plan untouched.`);
            }

            if (installmentId && finalPaymentId) {
              const { error: instSettleErr } = await supabase.rpc("installment_settle_invoice", {
                p_payment_id: finalPaymentId,
                p_installment_id: installmentId,
              });
              if (instSettleErr) {
                console.error("Installment settle_invoice failed:", instSettleErr);
              } else {
                console.log("Installment invoice settled:", installmentId);
                if (installmentPlanId) {
                  // Activate the plan + capture the saved card on first settlement
                  const paymentIntentId = typeof session.payment_intent === "string"
                    ? session.payment_intent
                    : session.payment_intent?.id;
                  let paymentMethodId: string | undefined;
                  if (paymentIntentId) {
                    try {
                      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
                      paymentMethodId = typeof pi.payment_method === "string"
                        ? pi.payment_method
                        : pi.payment_method?.id;
                    } catch (piErr) {
                      console.error("Failed to retrieve PI for installment plan:", piErr);
                    }
                  }
                  await supabase
                    .from("installment_plans")
                    .update({
                      status: "active",
                      upfront_paid: true,
                      upfront_payment_id: finalPaymentId,
                      stripe_payment_method_id: paymentMethodId ?? null,
                      collection_mode: paymentMethodId ? "auto" : "manual",
                    })
                    .eq("id", installmentPlanId);
                }
              }
            }
          }

          // PORTAL BELL: a captured payment just landed — notify all operators
          // of the tenant. Fires once per settled payment; dedupe on the payment
          // id guards webhook retries. notifyOperatorsInApp never throws.
          if (finalPaymentId) {
            let bellTenantId = (session.metadata?.tenant_id as string | undefined) || undefined;
            if (!bellTenantId) {
              const { data: bellPayment } = await supabase
                .from("payments")
                .select("tenant_id")
                .eq("id", finalPaymentId)
                .maybeSingle();
              bellTenantId = bellPayment?.tenant_id ?? undefined;
            }
            if (bellTenantId) {
              const bellAmount = session.amount_total ? session.amount_total / 100 : 0;
              const bellCurrency = (session.currency || "USD").toUpperCase();
              const bellRef = rentalId ? rentalId.substring(0, 8).toUpperCase() : "";
              await notifyOperatorsInApp({
                tenantId: bellTenantId,
                type: "payment_received",
                title: "Payment received",
                message: `Payment of ${formatCurrency(bellAmount, bellCurrency)} received for booking ${bellRef}`,
                link: rentalId ? `/rentals/${rentalId}` : "/invoices",
                metadata: { rental_id: rentalId, payment_id: finalPaymentId, amount: bellAmount },
                dedupeKey: finalPaymentId,
              });

              // OPERATOR EMAIL (in addition to the always-on bell above). Gated on
              // the master email switch + "payments" category pref, and sent to the
              // configured notification recipient (notification_recipient_email ->
              // contact_email -> admin_email -> env ADMIN_EMAIL). Bell + customer
              // emails are untouched. Wrapped so a mail failure never fails the webhook.
              try {
                if (await isOperatorEmailEnabled(supabase, bellTenantId, "payments")) {
                  const operatorEmail = await getTenantNotificationRecipient(supabase, bellTenantId);
                  if (operatorEmail) {
                    await sendEmail(
                      operatorEmail,
                      `Payment received${bellRef ? ` - ${bellRef}` : ""} - ${formatCurrency(bellAmount, bellCurrency)}`,
                      `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
                        <h2 style="color: #16a34a; margin: 0 0 16px;">Payment received</h2>
                        <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.6;">A payment of <strong>${formatCurrency(bellAmount, bellCurrency)}</strong> has been received${bellRef ? ` for booking <strong>${bellRef}</strong>` : ""}.</p>
                        <p style="margin: 0; color: #666; font-size: 13px;">You are receiving this because payment email notifications are enabled for your account.</p>
                      </div>`,
                      supabase,
                      bellTenantId
                    );
                    console.log("Operator payment-received email sent to:", operatorEmail);
                  }
                }
              } catch (opEmailErr) {
                console.error("Operator payment-received email failed (non-fatal):", opEmailErr);
              }
            }
          }

          // Send booking pending notification for booking flow (not portal)
          if (!isPortalPayment && finalPaymentId) {
            try {
              const { data: rentalWithDetails } = await supabase
                .from("rentals")
                .select(`
                  id,
                  start_date,
                  end_date,
                  monthly_amount,
                  tenant_id,
                  customer:customers(id, name, email, phone),
                  vehicle:vehicles(id, make, model, reg)
                `)
                .eq("id", rentalId)
                .single();

              if (rentalWithDetails && rentalWithDetails.customer && rentalWithDetails.vehicle) {
                const vehicleName = rentalWithDetails.vehicle.make && rentalWithDetails.vehicle.model
                  ? `${rentalWithDetails.vehicle.make} ${rentalWithDetails.vehicle.model}`
                  : rentalWithDetails.vehicle.reg;

                const notificationData = {
                  paymentId: finalPaymentId,
                  rentalId: rentalId,
                  tenantId: rentalWithDetails.tenant_id,
                  customerId: rentalWithDetails.customer.id,
                  customerName: rentalWithDetails.customer.name,
                  customerEmail: rentalWithDetails.customer.email,
                  customerPhone: rentalWithDetails.customer.phone,
                  vehicleName: vehicleName,
                  vehicleMake: rentalWithDetails.vehicle.make,
                  vehicleModel: rentalWithDetails.vehicle.model,
                  vehicleReg: rentalWithDetails.vehicle.reg,
                  pickupDate: new Date(rentalWithDetails.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  returnDate: new Date(rentalWithDetails.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  amount: rentalWithDetails.monthly_amount || (session.amount_total ? session.amount_total / 100 : 0),
                  bookingRef: rentalId.substring(0, 8).toUpperCase(),
                  paymentMode: 'auto',
                };

                console.log("Sending booking pending notification for auto mode:", notificationData.bookingRef);

                const notifyResponse = await fetch(
                  `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-booking-pending`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                    },
                    body: JSON.stringify(notificationData),
                  }
                );

                if (notifyResponse.ok) {
                  console.log("Booking notification sent successfully");
                } else {
                  console.error("Failed to send booking notification:", await notifyResponse.text());
                }
              }
            } catch (notifyError) {
              console.error("Error sending booking notification:", notifyError);
            }
          }

          // AUTO-PLACE DEPOSIT HOLD: when the portal's new-rental flow stamps
          // place_deposit_hold='true', the rental payment we just captured
          // saved the customer's card (setup_future_usage: 'off_session' in
          // create-checkout-session). Now authorise the deposit on that same
          // card without prompting the customer — place-deposit-hold creates
          // a manual-capture PaymentIntent and writes deposit_hold_status='held'
          // on the rental. The function is idempotent; if the rental already
          // has a hold or the tenant has deposits disabled, it no-ops safely.
          if (session.metadata?.place_deposit_hold === "true" && rentalId) {
            console.log("[LIVE MODE] place_deposit_hold flag detected, placing off-session hold for rental:", rentalId);
            try {
              const holdResponse = await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/place-deposit-hold`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({ rentalId }),
                }
              );
              const holdResult = await holdResponse.json().catch(() => ({}));
              if (holdResponse.ok) {
                if (holdResult.skipped) {
                  console.log("[LIVE MODE] Deposit hold skipped:", holdResult.message);
                } else if (holdResult.alreadyHeld) {
                  console.log("[LIVE MODE] Deposit hold already active");
                } else {
                  console.log("[LIVE MODE] Deposit hold placed:", holdResult.paymentIntentId, "amount:", holdResult.amount);
                }
              } else {
                // Don't fail the webhook — the rental payment is already captured.
                // The hold can be placed manually from the rental detail page.
                console.error("[LIVE MODE] place-deposit-hold failed:", holdResult?.error || holdResponse.statusText);
                await supabase
                  .from("rentals")
                  .update({ deposit_hold_status: "failed" })
                  .eq("id", rentalId)
                  .is("deposit_hold_status", null);
              }
            } catch (holdError) {
              console.error("[LIVE MODE] Error invoking place-deposit-hold:", holdError);
            }
          }
        }

        // BACKFILL: Ensure stripe_payment_intent_id is saved for ALL matching payments
        // This catches any race conditions where the payment record was created after the webhook
        if (session.payment_intent && session.id) {
          const { data: backfilledPayments, error: backfillError } = await supabase
            .from("payments")
            .update({
              stripe_payment_intent_id: session.payment_intent as string,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_checkout_session_id", session.id)
            .is("stripe_payment_intent_id", null)
            .select("id");

          if (!backfillError && backfilledPayments && backfilledPayments.length > 0) {
            console.log(
              "Backfilled stripe_payment_intent_id for",
              backfilledPayments.length,
              "payments with session:",
              session.id
            );
          }
        }

        // BONZAH INSURANCE: Confirm payment and issue policy if bonzah_policy_id is present
        const bonzahPolicyId = session.metadata?.bonzah_policy_id;
        if (bonzahPolicyId) {
          console.log("[LIVE MODE] Confirming Bonzah insurance payment for policy:", bonzahPolicyId);
          try {
            const bonzahResponse = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/bonzah-confirm-payment`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  policy_record_id: bonzahPolicyId,
                  stripe_payment_intent_id: session.payment_intent as string,
                }),
              }
            );

            if (bonzahResponse.ok) {
              const bonzahResult = await bonzahResponse.json();
              console.log("[LIVE MODE] Bonzah policy issued successfully:", bonzahResult.policy_no);
            } else {
              const errorText = await bonzahResponse.text();
              console.error("[LIVE MODE] Failed to confirm Bonzah payment:", errorText);
            }
          } catch (bonzahError) {
            console.error("[LIVE MODE] Error calling bonzah-confirm-payment:", bonzahError);
            // Don't fail the webhook for Bonzah errors - payment was still successful
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent succeeded:", paymentIntent.id);

        // Update payment record if exists
        const { data: payment } = await supabase
          .from("payments")
          .select("id, capture_status")
          .eq("stripe_payment_intent_id", paymentIntent.id)
          .single();

        if (payment) {
          // Only update if this is a capture (not a hold)
          if (paymentIntent.capture_method !== "manual" || paymentIntent.status === "succeeded") {
            await supabase
              .from("payments")
              .update({
                status: "Applied",
                capture_status: "captured",
                updated_at: new Date().toISOString(),
              })
              .eq("id", payment.id);
            console.log("Payment record updated:", payment.id);
          }
        }
        break;
      }

      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent canceled:", paymentIntent.id);

        // Update payment record
        const { data: payment } = await supabase
          .from("payments")
          .select("id, rental_id")
          .eq("stripe_payment_intent_id", paymentIntent.id)
          .single();

        if (payment) {
          await supabase
            .from("payments")
            .update({
              capture_status: "cancelled",
              verification_status: "rejected",
              status: "Refunded",
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);

          // Cancel the rental
          if (payment.rental_id) {
            await supabase
              .from("rentals")
              .update({
                status: "Cancelled",
                updated_at: new Date().toISOString(),
              })
              .eq("id", payment.rental_id);
          }

          console.log("Payment and rental cancelled from webhook");
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent failed:", paymentIntent.id);

        // Notify customer of failed payment
        const rentalId = paymentIntent.metadata?.rental_id;
        if (rentalId) {
          // Get customer details
          const { data: rental } = await supabase
            .from("rentals")
            .select("customer:customers(name, email, phone)")
            .eq("id", rentalId)
            .single();

          if (rental?.customer) {
            // Could trigger a notification here
            console.log("Payment failed for customer:", rental.customer.email);
          }
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session expired:", session.id);

        const rentalId = session.client_reference_id;
        if (rentalId) {
          // Check if rental is still in Pending status
          const { data: rental } = await supabase
            .from("rentals")
            .select("id, status")
            .eq("id", rentalId)
            .single();

          if (rental?.status === "Pending") {
            // Cancel the rental since checkout expired
            await supabase
              .from("rentals")
              .update({
                status: "Cancelled",
                updated_at: new Date().toISOString(),
              })
              .eq("id", rentalId);

            console.log("Cancelled expired checkout rental:", rentalId);
          }
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        console.log("Charge refunded:", charge.id, "for payment_intent:", charge.payment_intent);

        if (!charge.payment_intent) {
          console.log("No payment_intent on charge, skipping");
          break;
        }

        // Find payment by payment_intent
        const { data: payment } = await supabase
          .from("payments")
          .select("id, rental_id, tenant_id, amount")
          .eq("stripe_payment_intent_id", charge.payment_intent as string)
          .single();

        if (payment) {
          console.log("Found payment for refund:", payment.id);

          const refundAmount = charge.amount_refunded / 100;
          const isFullRefund = refundAmount >= payment.amount;

          // Update payment status
          const { error: updateError } = await supabase
            .from("payments")
            .update({
              refund_status: "completed",
              status: isFullRefund ? "Refunded" : "Partial Refund",
              refund_processed_at: new Date().toISOString(),
              refund_amount: refundAmount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);

          if (updateError) {
            console.error("Failed to update payment refund status:", updateError);
          } else {
            console.log("Updated payment", payment.id, "with refund status");
          }

          // Create portal (operator bell) notification
          if (payment.tenant_id) {
            // Get tenant currency for formatting
            let refundCurrencyCode = 'USD';
            const { data: refundTenant } = await supabase
              .from("tenants")
              .select("currency_code")
              .eq("id", payment.tenant_id)
              .single();
            if (refundTenant?.currency_code) refundCurrencyCode = refundTenant.currency_code;

            await notifyOperatorsInApp({
              tenantId: payment.tenant_id,
              type: "refund_processed",
              title: "Refund Processed",
              message: `Refund of ${formatCurrency(refundAmount, refundCurrencyCode)} has been processed successfully`,
              link: payment.rental_id ? `/rentals/${payment.rental_id}` : "/invoices",
              metadata: {
                rental_id: payment.rental_id,
                payment_id: payment.id,
                amount: refundAmount,
                stripe_charge_id: charge.id,
              },
              dedupeKey: payment.id,
            });
          }
        } else {
          console.log("No payment found for payment_intent:", charge.payment_intent);
        }
        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
