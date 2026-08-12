// Stripe Webhook Handler - TEST MODE
// Handles webhook events from Stripe test mode

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { formatCurrency } from '../_shared/format-utils.ts';
import { getStripeClientForAccount, getWebhookSecretCandidates, readHoldCaptureFacts } from '../_shared/stripe-client.ts';
import { notifyOperatorsInApp } from '../_shared/notify-inapp.ts';
import { sendEmail, getTenantNotificationRecipient, isOperatorEmailEnabled } from '../_shared/resend-service.ts';

// Initialize Stripe with TEST secret key (legacy UK platform)
const ukStripe = new Stripe(Deno.env.get("STRIPE_TEST_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// ---------------------------------------------------------------------------
// sync-deposit-hold failure classification — mirrors stripe-webhook-live
// ---------------------------------------------------------------------------
// A `security_deposit_hold` checkout is delegated to the `sync-deposit-hold`
// edge function (see the branch in checkout.session.completed below). When that
// call fails we must pick between two bad outcomes:
//
//   return 500 -> Stripe redelivers (~15 attempts over ~3 days) and books every
//                 failure against this endpoint's auto-disable budget. A
//                 disabled endpoint stops checkout.session.completed,
//                 invoice.paid and installment settlement for ALL tenants.
//   return 200 -> the authorisation stays live on the customer's card with
//                 nothing recorded on the rental until the portal redirect or
//                 verify-deposit-hold reconciles it.
//
// The status code alone cannot decide, because sync-deposit-hold funnels every
// thrown error through a single outer catch that answers 500 — including
// permanent ones like `No such checkout.session` (session created on the other
// platform account) or `Missing Stripe secret key for account=… mode=…`.
// Retrying those can never succeed, so the retry is BOUNDED: only known-
// transient failures are retried, only while the event is still young, and a
// give-up raises an operator-visible alert instead of a lone log line.

/** How long after `event.created` we are still willing to ask for redelivery. */
const HOLD_SYNC_MAX_RETRY_AGE_MS = 60 * 60 * 1000; // 1 hour

/** Stripe abandons a delivery at ~30s and books it as failed — bail earlier. */
const HOLD_SYNC_TIMEOUT_MS = 15_000;

/**
 * PaymentIntent statuses that mean "not settled YET". sync-deposit-hold answers
 * 422 `Hold not active (PI status: …)` for these when the webhook beats 3DS or
 * async confirmation — the authorisation is real and a redelivery finds it.
 * Terminal statuses (canceled, succeeded, requires_payment_method) are
 * deliberately absent: for those a retry can only ever fail again.
 */
const HOLD_SYNC_RETRYABLE_PI_STATUSES = ["processing", "requires_action", "requires_confirmation"];

/** Substrings that mark a sync 5xx as transient rather than permanent. */
const HOLD_SYNC_TRANSIENT_PATTERNS = [
  "failed to persist hold",   // sync's own DB write failed
  "connection to stripe",     // StripeConnectionError
  "timed out",
  "timeout",
  "rate limit",               // StripeRateLimitError
  "fetch failed",
  "econnreset",
  "service unavailable",
  "internal server error",    // Stripe's own 5xx (StripeAPIError)
];

function classifyHoldSyncFailure(
  status: number,
  message: string
): { retryable: boolean; reason: string } {
  const msg = (message || "").toLowerCase();

  // The Functions gateway answered, not sync itself — sync never ran.
  if ([408, 425, 429, 502, 503, 504, 546].includes(status)) {
    return { retryable: true, reason: `gateway status ${status}` };
  }

  if (status === 422) {
    const pending = HOLD_SYNC_RETRYABLE_PI_STATUSES.find((s) => msg.includes(s));
    return pending
      ? { retryable: true, reason: `PaymentIntent still ${pending}` }
      : { retryable: false, reason: `terminal 422: ${message}` };
  }

  if (status >= 500) {
    const transient = HOLD_SYNC_TRANSIENT_PATTERNS.find((p) => msg.includes(p));
    return transient
      ? { retryable: true, reason: `transient sync failure (${transient})` }
      : { retryable: false, reason: `permanent failure reported as ${status}: ${message}` };
  }

  return { retryable: false, reason: `terminal ${status}: ${message}` };
}

// ---------------------------------------------------------------------------
// Security-deposit authorisations vs booking pre-auths — mirrors stripe-webhook-live
// ---------------------------------------------------------------------------
/**
 * PaymentIntent metadata `type` values that mark a SECURITY-DEPOSIT
 * authorisation. These are owned end-to-end by the deposit-hold engine, which
 * keeps their lifetime on rentals.deposit_hold_* — never on payments. Two
 * handlers below need to tell them apart from a booking pre-auth:
 * `payment_intent.canceled` (a routine hold release must not cancel a live
 * rental) and `payment_intent.amount_capturable_updated` (a hold's deadline
 * does not belong in payments.preauth_expires_at).
 *
 * Module-level so the two cannot drift apart.
 */
const DEPOSIT_HOLD_PI_TYPES = ["deposit_hold", "deposit_hold_rollover", "security_deposit_hold"];

// ---------------------------------------------------------------------------
// payments.preauth_expires_at reconciliation — mirrors stripe-webhook-live
// ---------------------------------------------------------------------------
// create-preauth-checkout has to write preauth_expires_at at SESSION-CREATION
// time — before the customer has completed Checkout, so before any
// authorisation exists and before Stripe can possibly know its deadline. What
// it writes is a deliberately conservative FLOOR (now + the shared fallback
// days), and it is measured from the wrong moment: the authorisation clock only
// starts when the card is actually authorised, which can be minutes or days
// later. Nothing used to correct it, so the portal's pending-bookings expiry
// badge and the payment-links panel were presenting that guess to operators as
// fact — and a booking authorised two days after checkout was created showed a
// deadline two days earlier than the truth.
//
// The real deadline only becomes knowable when the authorisation happens, and
// that arrives here, as
// latest_charge.payment_method_details.card.capture_before. So this is where
// the column is corrected.
//
// ONLY EVER PERSISTS A VALUE READ FROM STRIPE. readHoldCaptureFacts returns
// null when Stripe has published no capture_before, and null means LEAVE THE
// STORED VALUE ALONE. It deliberately does NOT use resolveHoldExpiry* — those
// layer a computed `now + fallback` on top, and writing a computed fallback as
// though Stripe had supplied it is precisely what hid dying authorisations from
// the refresh window in the original incident.
//
// Never throws: a webhook 500 costs Stripe redeliveries against this endpoint's
// auto-disable budget, and an unreconciled expiry column is not worth that.
async function reconcilePreauthExpiry(
  supabase: any,
  stripe: Stripe,
  stripeOptions: Stripe.RequestOptions | undefined,
  args: {
    paymentIntentId: string;
    /** Known payments row. When absent the row is matched on the PI id. */
    paymentId?: string | null;
    /** Event payload, if the handler already has it. Re-fetched when latest_charge isn't expanded. */
    paymentIntent?: Stripe.PaymentIntent | null;
  },
  logPrefix: string
): Promise<void> {
  try {
    let pi = args.paymentIntent ?? null;

    // Webhook payloads never expand latest_charge, and readHoldCaptureFacts can
    // only fall back to a charges.retrieve when the id is present at all — on a
    // freshly authorised PI it may not be. Re-read with the expansion.
    const chargeExpanded =
      !!pi && typeof (pi as any).latest_charge === "object" && (pi as any).latest_charge !== null;
    if (!pi || !chargeExpanded) {
      pi = await stripe.paymentIntents.retrieve(
        args.paymentIntentId,
        { expand: ["latest_charge"] },
        stripeOptions
      );
    }

    // Only manual-capture intents have a capture deadline at all.
    if (pi.capture_method !== "manual") {
      console.log(
        `${logPrefix} ${args.paymentIntentId} is not a manual-capture intent — no preauth expiry to reconcile`
      );
      return;
    }

    // A deposit hold's deadline lives on rentals.deposit_hold_expires_at and is
    // maintained by the hold engine. Never let one write into payments.
    const piType = pi.metadata?.type ?? "";
    if (DEPOSIT_HOLD_PI_TYPES.includes(piType)) {
      console.log(
        `${logPrefix} ${args.paymentIntentId} is a deposit hold (type: ${piType}) — preauth_expires_at not applicable`
      );
      return;
    }

    const facts = await readHoldCaptureFacts(stripe, pi, stripeOptions);
    if (!facts) {
      // Not an error: Stripe often has not published capture_before at the
      // instant the checkout event lands. The stored floor stays as-is, and
      // amount_capturable_updated (or the next reconciliation) can still fix it.
      console.log(
        `${logPrefix} Stripe has published no capture_before for ${args.paymentIntentId} yet — preauth_expires_at left untouched`
      );
      return;
    }

    // Scoped to rows still awaiting capture: a late or duplicate delivery must
    // not rewrite the expiry of a booking that has since been captured, voided
    // or refunded.
    let update = supabase
      .from("payments")
      .update({
        preauth_expires_at: facts.captureBefore,
        updated_at: new Date().toISOString(),
      })
      .eq("capture_status", "requires_capture");
    update = args.paymentId
      ? update.eq("id", args.paymentId)
      : update.eq("stripe_payment_intent_id", args.paymentIntentId);

    const { data: reconciled, error: reconcileError } = await update.select("id");

    if (reconcileError) {
      console.error(
        `${logPrefix} Failed to write reconciled preauth_expires_at for ${args.paymentIntentId}:`,
        reconcileError.message
      );
      return;
    }

    // extended_authorization is logged, not stored: `payments` has no column for
    // it (only rentals.deposit_hold_extended_auth exists, and that belongs to the
    // deposit-hold chain, not to booking pre-auths). Persisting it would need DDL.
    console.log(
      `${logPrefix} preauth_expires_at reconciled from Stripe for ${args.paymentIntentId}: ` +
        `${facts.captureBefore} (window=${facts.windowSeconds !== null ? Math.round(facts.windowSeconds / 3600) : "?"}h, ` +
        `extended_auth=${facts.extendedAuthStatus ?? "not_reported"}, rows=${reconciled?.length ?? 0})`
    );
  } catch (err) {
    // Includes Stripe transport/auth failures. A throw is NOT "no deadline" —
    // it means we did not learn one, so the stored value is left alone.
    console.error(
      `${logPrefix} preauth expiry reconciliation failed for ${args.paymentIntentId}; stored value left untouched:`,
      err
    );
  }
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

    const signature = req.headers.get("stripe-signature");
    const body = await req.text();
    const connectSecret = Deno.env.get("STRIPE_TEST_CONNECT_WEBHOOK_SECRET");
    const uaeSecret = Deno.env.get("STRIPE_UAE_TEST_WEBHOOK_SECRET");
    // During the UAE migration this endpoint is registered on BOTH platform
    // accounts, so verification must try every candidate secret:
    // legacy platform, UAE platform, then the legacy Connect endpoint secret.
    const secretCandidates = [
      ...getWebhookSecretCandidates("test"),
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
          // MUST be constructEventAsync. The synchronous constructEvent() throws
          // "SubtleCryptoProvider cannot be used in a synchronous context" on Deno,
          // because WebCrypto there is async-only. It threw for EVERY candidate
          // secret, so verification always fell through to HTTP 400 and Stripe read
          // it as a hard failure — 84 consecutive failures and a pending
          // auto-disable notice. Nothing to do with which secret is configured.
          event = await stripe.webhooks.constructEventAsync(body, signature, secret);
          verified = true;
          if (uaeSecret && secret === uaeSecret) {
            stripe = getStripeClientForAccount("uae", "test");
            platformAccount = "uae";
            console.log("[TEST MODE] Verified with UAE platform webhook secret");
          } else {
            console.log("[TEST MODE] Verified with legacy webhook secret");
          }
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!verified) {
        console.error("[TEST MODE] Webhook signature verification failed with all secrets:", lastErr?.message);
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // FAIL CLOSED — see the matching comment in stripe-webhook-live. Omitting
      // the stripe-signature header short-circuited the AND above and landed
      // here, where the raw body was trusted as a genuine Stripe event while a
      // service_role client was already in scope. Confirmed exploitable against
      // production (unsigned POST returned HTTP 200) before this change.
      const missingSignature = !signature;
      console.error(
        `[TEST MODE] Rejected unverified webhook: ${missingSignature ? "missing stripe-signature header" : "no webhook secret configured"}`
      );
      return new Response(
        JSON.stringify({ error: missingSignature ? "Missing stripe-signature header" : "Webhook not configured" }),
        {
          status: missingSignature ? 400 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[TEST MODE] Stripe webhook received:", event.type);

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
            if (applyError) console.error("[TEST MODE] hold-as-credit apply-payment error:", applyError);
            else console.log("[TEST MODE] payment held as account credit:", creditPaymentId);
          } else {
            console.warn("[TEST MODE] hold_as_credit session with no payment row and no customer_id:", session.id);
          }
          break;
        }

        // SECURITY DEPOSIT HOLD (create-hold-checkout) — mirrors
        // stripe-webhook-live. These sessions authorise money WITHOUT capturing
        // it and carry no preauth_mode flag, so they used to fall through to the
        // "Auto mode: Payment was captured" else-branch, which marked the rental
        // payment_status='fulfilled', inserted a Completed/captured payments row
        // for the full UNCAPTURED amount and ran apply-payment against real rent
        // charges. Record the hold and stop. Delegating to sync-deposit-hold
        // (the same function the portal's return URL calls) also closes the
        // closed-tab orphan, where an authorisation existed on Stripe with
        // nothing recorded on the rental.
        if (session.metadata?.type === "security_deposit_hold") {
          // Reuse the rentalId this case already resolved. Re-deriving it with
          // the opposite precedence (metadata first) was a divergence trap:
          // inert today only because create-hold-checkout writes no
          // client_reference_id.
          const holdRentalId = rentalId;
          const holdTenantId = session.metadata?.tenant_id || "";
          if (!holdRentalId) {
            console.error("[TEST MODE] security_deposit_hold session with no rental_id:", session.id);
            break;
          }

          console.log("[TEST MODE] Deposit hold checkout completed for rental:", holdRentalId);

          const holdEventAgeMs = Date.now() - (event.created || 0) * 1000;
          let holdSyncFailure: { retryable: boolean; reason: string } | null = null;

          try {
            const syncResponse = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-deposit-hold`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  sessionId: session.id,
                  rentalId: holdRentalId,
                  // The authoritative account: resolved from WHICH webhook secret
                  // verified this event, not from tenants.payment_model — the very
                  // column the UK->UAE migration is flipping this week.
                  // sync-deposit-hold still re-derives it via
                  // getChargePlatformAccount(); these fields are passed so it can
                  // prefer them once it accepts them (harmlessly ignored today).
                  platformAccount,
                  connectedAccountId,
                }),
                // Stripe abandons a delivery at ~30s and records the timeout as a
                // failed delivery, feeding the same auto-disable budget. Bail well
                // before that; the abort lands in the catch as transport failure.
                signal: AbortSignal.timeout(HOLD_SYNC_TIMEOUT_MS),
              }
            );
            const syncResult = await syncResponse.json().catch(() => ({}));

            if (syncResponse.ok) {
              if (syncResult.skipped) {
                console.log("[TEST MODE] Deposit hold sync skipped:", syncResult.skipped);
              } else {
                console.log("[TEST MODE] Deposit hold recorded:", syncResult.paymentIntentId, "amount:", syncResult.amount);
              }
            } else {
              const syncMessage = String(syncResult?.error || syncResponse.statusText || "");
              holdSyncFailure = classifyHoldSyncFailure(syncResponse.status, syncMessage);
              console.error(
                "[TEST MODE] sync-deposit-hold failed for session:",
                session.id,
                `status=${syncResponse.status}`,
                syncMessage,
                `->`,
                holdSyncFailure.retryable ? "retryable" : "permanent",
                holdSyncFailure.reason
              );
            }
          } catch (syncError) {
            // Transport: unreachable, DNS/TLS, or our own 15s abort. Nothing was
            // observed of sync's outcome, so one redelivery is worth attempting.
            const detail = syncError instanceof Error ? syncError.message : String(syncError);
            holdSyncFailure = { retryable: true, reason: `sync-deposit-hold unreachable: ${detail}` };
            console.error("[TEST MODE] Error invoking sync-deposit-hold:", syncError);
          }

          if (holdSyncFailure) {
            if (holdSyncFailure.retryable && holdEventAgeMs < HOLD_SYNC_MAX_RETRY_AGE_MS) {
              console.warn(
                "[TEST MODE] Requesting Stripe redelivery for deposit-hold session:",
                session.id,
                holdSyncFailure.reason
              );
              return new Response(
                JSON.stringify({ error: `sync-deposit-hold failed: ${holdSyncFailure.reason}` }),
                {
                  status: 500,
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
              );
            }

            // Out of retries, or never worth one. The authorisation is LIVE on the
            // customer's card and unrecorded, so this must not die in a log line:
            // alert the operators, who can reconcile from the rental page.
            console.error(
              "[TEST MODE] GIVING UP on deposit-hold sync — session:",
              session.id,
              "rental:",
              holdRentalId,
              holdSyncFailure.retryable
                ? `(retry window exhausted after ${Math.round(holdEventAgeMs / 60000)}m)`
                : `(permanent: ${holdSyncFailure.reason})`
            );
            await notifyOperatorsInApp({
              tenantId: holdTenantId,
              type: "deposit_hold_sync_failed",
              title: "Deposit hold not recorded",
              message:
                "A security deposit authorisation completed on Stripe but could not be recorded against this rental. Open the rental and verify the hold before placing another one.",
              link: `/rentals/${holdRentalId}`,
              metadata: {
                rental_id: holdRentalId,
                checkout_session_id: session.id,
                platform_account: platformAccount,
                reason: holdSyncFailure.reason,
              },
              dedupeKey: session.id,
            });
          }
          break;
        }

        if (!rentalId && !isInvoicePayment) {
          console.log("No rental ID in session and not an invoice payment, skipping");
          break;
        }

        if (isInvoicePayment && invoiceId) {
          console.log("[TEST MODE] Invoice payment completed. Invoice:", invoiceId);

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
            // Update existing payment to Completed
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

            console.log("[TEST MODE] Payment updated:", existingPayment.id);

            // Apply payment to ledger
            const { data: applyResult, error: applyError } = await supabase.functions.invoke("apply-payment", {
              body: { paymentId: existingPayment.id },
            });

            if (applyError) {
              console.error("[TEST MODE] apply-payment error:", applyError);
            } else {
              console.log("[TEST MODE] apply-payment result:", applyResult?.status, "allocated:", applyResult?.allocated);
            }
          } else {
            console.log("[TEST MODE] No pre-created payment found for session:", session.id, "— creating one");

            // Fallback: create payment record now
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
                console.log("[TEST MODE] Fallback payment created and applied:", newPayment.id, applyResult?.status);
              }
            }
          }

          // Update invoice status
          await supabase.from("invoices").update({ status: "paid" }).eq("id", invoiceId);
          console.log("[TEST MODE] Invoice marked as paid:", invoiceId);

          break;
        }

        // Handle installment checkout completion
        if (isInstallment) {
          console.log("[TEST MODE] Installment checkout completed for rental:", rentalId);

          // Update upfront payment record with payment intent ID
          const { data: existingPaymentRecord, error: paymentRecordError } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .maybeSingle();

          if (paymentRecordError) {
            console.error("[TEST MODE] Error fetching payment record for session:", session.id, paymentRecordError);
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
            console.log("[TEST MODE] Updated upfront payment:", existingPaymentRecord.id);
          } else {
            // Payment record missing (e.g. portal-created plan) — create it from session data
            console.log("[TEST MODE] No upfront payment record found for session — creating one");
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
                console.log("[TEST MODE] Created upfront payment record:", newPayment.id);
              }
            }
          }

          // Activate the installment plan
          console.log("[TEST MODE] Looking for pending installment plan for rental:", rentalId);
          const { data: installmentPlans, error: planError } = await supabase
            .from("installment_plans")
            .select("id")
            .eq("rental_id", rentalId)
            .eq("status", "pending");

          if (planError) {
            console.error("[TEST MODE] Error fetching installment plan for rental:", rentalId, planError);
          }

          console.log("[TEST MODE] Installment plans query result:", JSON.stringify(installmentPlans));
          const installmentPlan = installmentPlans && installmentPlans.length > 0 ? installmentPlans[0] : null;

          if (!installmentPlan) {
            console.error("[TEST MODE] No pending installment plan found for rental:", rentalId, "- skipping activation. Plans found:", installmentPlans?.length ?? 0);
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
                console.log("[TEST MODE] Retrieved payment method from PaymentIntent:", paymentMethodId);
              } catch (err) {
                console.error("[TEST MODE] Error retrieving PaymentIntent for payment method:", err);
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
                console.log("[TEST MODE] First installment marked as paid:", firstInstallment.id);
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
              console.error("[TEST MODE] Error activating installment plan:", activateError);
            } else {
              console.log("[TEST MODE] Installment plan activated:", installmentPlan.id);
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
              console.error("[TEST MODE] Error updating rental payment status:", rentalUpdateError);
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
                  console.log("[TEST MODE] Installment upfront payment FIFO allocation completed");
                } else {
                  console.error("[TEST MODE] Installment FIFO allocation failed:", await applyResponse.text());
                }
              } catch (applyError) {
                console.error("[TEST MODE] Error applying installment payment:", applyError);
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
              console.log("[TEST MODE] Installment booking notification sent");
            }
          } catch (notifyError) {
            console.error("[TEST MODE] Error sending installment booking notification:", notifyError);
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
            // Mirrors stripe-webhook-live: read the rental's auto-extend state so
            // we can (a) fall back to its parked pending extension when
            // session.metadata.extension_id is missing (else the payment strands
            // as an unallocated Credit and the rental sits paused) and (b) sync the
            // auto_extend_* columns — which this TEST-mode handler previously never
            // did at all, so test-mode renewals never returned to active.
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
                console.error("[TEST MODE] finalize_rental_extension error:", finalizeErr);
              } else {
                finalizeOk = true;
                console.log("Extension finalized via webhook:", extIdMeta);
              }
            }

            // Auto-extension: a paid pay-link must return the rental to "active"
            // and un-pause it (a rental that auto-paused past grace must un-pause
            // when finally paid, or both crons keep skipping it). Guarded by
            // pending_extension_id === extIdMeta so retries can't double-increment.
            // Gated on finalizeOk: if finalize failed, leave the rental paused with
            // its pending id intact (recoverable) rather than clear the parked week
            // and advance charge_count against a period that was never applied.
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
          console.log("[TEST MODE] Excess mileage payment completed for rental:", rentalId);

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

            console.log("[TEST MODE] Updated excess mileage payment to Completed:", excessPayment.id);
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

              console.log("[TEST MODE] Excess mileage charge updated:", excessCharge.id, "remaining:", newRemaining);
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

          // The authorisation now exists, so the REAL capture deadline is
          // knowable for the first time. Replace the session-creation-time floor
          // create-preauth-checkout stored with Stripe's own capture_before.
          const preauthPiId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null;
          if (preauthPiId) {
            await reconcilePreauthExpiry(
              supabase,
              stripe,
              stripeOptions,
              { paymentIntentId: preauthPiId, paymentId: existingPaymentRecord?.id ?? null },
              "[TEST MODE]"
            );
          } else {
            console.warn(
              "[TEST MODE] Pre-auth session exposed no PaymentIntent id; preauth_expires_at left at its floor:",
              session.id
            );
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

            // SELF-HEAL FALLBACK: when the dialog forgot to stamp
            // installment_id (typically a stale dev bundle that didn't
            // forward the prop, but possible for any consumer that doesn't
            // know about installments), discover it server-side. We have
            // enough signal: rental_id is always on metadata, and the
            // rental either has an installment plan or doesn't. If it does
            // AND the payment looks like a rental-installment payment (not
            // an extension/bonzah/etc.), settle the latest overdue or
            // due-today open slot. installment_settle_invoice cumulatively
            // supersedes earlier opens, so this matches the
            // PAYG-style "pay the latest invoice and earlier ones clear"
            // behavior that's already wired for paygAccrualId.
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
                // Find the latest overdue/due-today open installment for
                // this rental. Latest (highest installment_number) is the
                // PAYG-style cumulative target — settling it auto-clears
                // earlier ones via supersession.
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
              console.log(`[TEST MODE] Skipping installment self-heal: payment is targeted to non-Rental categories (${targetCategoriesMeta!.join(", ")}). Installment plan untouched.`);
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

          // Payment received: both the in-app BELL and the operator EMAIL are now
          // emitted universally by DB triggers (notify_payment_received on payments,
          // and the notify-operator-email dispatch on notifications), which fire from
          // EVERY settlement path — so nothing is emitted here.

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
            console.log("[TEST MODE] place_deposit_hold flag detected, placing off-session hold for rental:", rentalId);
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
                  console.log("[TEST MODE] Deposit hold skipped:", holdResult.message);
                } else if (holdResult.alreadyHeld) {
                  console.log("[TEST MODE] Deposit hold already active");
                } else {
                  console.log("[TEST MODE] Deposit hold placed:", holdResult.paymentIntentId, "amount:", holdResult.amount);
                }
              } else {
                // Don't fail the webhook — the rental payment is already captured.
                // The hold can be placed manually from the rental detail page.
                console.error("[TEST MODE] place-deposit-hold failed:", holdResult?.error || holdResponse.statusText);
                await supabase
                  .from("rentals")
                  .update({ deposit_hold_status: "failed" })
                  .eq("id", rentalId)
                  .is("deposit_hold_status", null);
              }
            } catch (holdError) {
              console.error("[TEST MODE] Error invoking place-deposit-hold:", holdError);
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
          console.log("[TEST MODE] Confirming Bonzah insurance payment for policy:", bonzahPolicyId);
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
              console.log("[TEST MODE] Bonzah policy issued successfully:", bonzahResult.policy_no);
            } else {
              const errorText = await bonzahResponse.text();
              console.error("[TEST MODE] Failed to confirm Bonzah payment:", errorText);
            }
          } catch (bonzahError) {
            console.error("[TEST MODE] Error calling bonzah-confirm-payment:", bonzahError);
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

      case "payment_intent.amount_capturable_updated": {
        // Fires the moment a manual-capture authorisation becomes capturable —
        // i.e. the exact moment the real deadline first exists. For a booking
        // pre-auth that is usually the same instant as
        // checkout.session.completed (reconciled there too), but the two are
        // independent deliveries: when the checkout event wins the race against
        // 3DS/async confirmation, its charge carries no capture_before yet and
        // this is the delivery that actually knows the answer.
        //
        // Purely corrective — it writes nothing but payments.preauth_expires_at,
        // and only on a row still awaiting capture. Deposit-hold authorisations
        // emit this event too and are filtered inside the helper.
        //
        // NOTE: this only ever runs if `payment_intent.amount_capturable_updated`
        // is in this endpoint's enabled-events list on the platform account.
        // When it isn't, the branch is simply never delivered and the
        // checkout.session.completed path above remains the reconciler.
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent amount_capturable_updated:", paymentIntent.id);
        await reconcilePreauthExpiry(
          supabase,
          stripe,
          stripeOptions,
          { paymentIntentId: paymentIntent.id, paymentIntent },
          "[TEST MODE]"
        );
        break;
      }

      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent canceled:", paymentIntent.id);

        // GUARD 1: a cancelled security-deposit authorisation is NOT a cancelled
        // booking. Holds are cancelled routinely — released at the end of a
        // rental, rolled over after a partial capture, or voided by the card
        // network when the authorisation expires. Some of those PI ids DO appear
        // in payments.stripe_payment_intent_id (capture-deposit-hold stamps the
        // hold PI onto the revenue row it inserts), and the handler below would
        // then mark that money Refunded and take the rental to Cancelled — a
        // live 90-day rental killed by a routine deposit release. Chained hold
        // refreshes turn one cancel per rental into 4-18, so filter first.
        // (DEPOSIT_HOLD_PI_TYPES is module-level so this guard and the
        // preauth-expiry guard cannot drift apart.)
        const holdPiType = paymentIntent.metadata?.type;
        let isDepositHoldPi = !!holdPiType && DEPOSIT_HOLD_PI_TYPES.includes(holdPiType);
        let holdDetectionReason = isDepositHoldPi ? `type: ${holdPiType}` : "";

        // Metadata alone isn't enough: holds placed before the metadata existed
        // carry none, and after a refresh the rental may already point at the
        // replacement PI. Anything the rental records as its deposit hold is a
        // hold, whatever its metadata says.
        if (!isDepositHoldPi) {
          let holdRentalQuery = supabase
            .from("rentals")
            .select("id")
            .eq("deposit_hold_payment_intent_id", paymentIntent.id);
          const holdMetaRentalId = paymentIntent.metadata?.rental_id;
          if (holdMetaRentalId) holdRentalQuery = holdRentalQuery.eq("id", holdMetaRentalId);
          const { data: holdRental, error: holdLookupError } = await holdRentalQuery.limit(1).maybeSingle();

          if (holdLookupError) {
            // FAIL SAFE, not open. This probe is the ONLY protection legacy,
            // metadata-less holds have; reading a failed query as "not a hold"
            // would let a routine deposit release cancel the rental. Skipping a
            // genuine cancellation of a Pending booking is recoverable by hand;
            // a cancelled live rental is not.
            console.error(
              "[TEST MODE] Deposit-hold lookup failed for",
              paymentIntent.id,
              "- treating as a hold:",
              holdLookupError.message
            );
            isDepositHoldPi = true;
            holdDetectionReason = `lookup failed, assumed hold: ${holdLookupError.message}`;
          } else if (holdRental) {
            isDepositHoldPi = true;
            holdDetectionReason = "matched rentals.deposit_hold_payment_intent_id";
          }
        }

        if (isDepositHoldPi) {
          console.log(
            "[TEST MODE] Ignoring payment_intent.canceled for deposit hold:",
            paymentIntent.id,
            `(${holdDetectionReason})`
          );
          break;
        }

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

          // GUARD 2: only a booking still awaiting payment may be cancelled by a
          // webhook. This update used to be unconditional, so ANY cancelled PI
          // that happened to match a payments row took its rental down with it —
          // including Active and Closed rentals. Mirrors the check the
          // checkout.session.expired handler has always had.
          if (payment.rental_id) {
            const { data: cancelRental, error: cancelRentalError } = await supabase
              .from("rentals")
              .select("id, status")
              .eq("id", payment.rental_id)
              .maybeSingle();

            // An errored read leaves cancelRental null, so the check below is
            // already fail-safe (no cancellation). Log it so it isn't silent.
            if (cancelRentalError) {
              console.error(
                "[TEST MODE] Rental status lookup failed; leaving rental untouched:",
                cancelRentalError.message
              );
            }

            if (cancelRental?.status === "Pending") {
              await supabase
                .from("rentals")
                .update({
                  status: "Cancelled",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", payment.rental_id);
              console.log("Payment and rental cancelled from webhook");
            } else {
              console.log(
                "Payment cancelled; rental left untouched (status:",
                cancelRental?.status ?? "not found",
                ") for rental:",
                payment.rental_id
              );
            }
          } else {
            console.log("Payment cancelled from webhook (no rental attached)");
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("PaymentIntent failed:", paymentIntent.id);

        // Notify customer of failed payment
        const rentalId = paymentIntent.metadata?.rental_id;
        if (rentalId) {
          // Get customer + tenant details
          const { data: rental } = await supabase
            .from("rentals")
            .select("tenant_id, customer:customers(name, email, phone)")
            .eq("id", rentalId)
            .single();

          if (rental?.customer) {
            console.log("Payment failed for customer:", rental.customer.email);
          }

          // Operator bell: a card payment failed. Always-on, broadcast, deduped
          // on the payment_intent id (guards webhook retries). Never throws.
          if (rental?.tenant_id) {
            await notifyOperatorsInApp({
              tenantId: rental.tenant_id,
              type: "payment_failed",
              title: "Payment failed",
              message: `A card payment${paymentIntent.amount ? ` of ${formatCurrency(paymentIntent.amount / 100, (paymentIntent.currency || "usd").toUpperCase())}` : ""} failed${rental.customer?.name ? ` for ${rental.customer.name}` : ""} (booking ${rentalId.substring(0, 8).toUpperCase()}).`,
              link: `/rentals/${rentalId}`,
              metadata: { rental_id: rentalId, payment_intent: paymentIntent.id, amount: paymentIntent.amount ? paymentIntent.amount / 100 : null },
              dedupeKey: paymentIntent.id,
            });
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
