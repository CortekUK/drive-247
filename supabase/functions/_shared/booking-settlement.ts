// Booking payment settlement — the single place a captured booking payment is
// turned into ledger movement, notifications and a deposit hold.
//
// WHY THIS FILE EXISTS
//
// Every settlement in this codebase used to live inline in
// `case "checkout.session.completed"` of stripe-webhook-{test,live}. That was
// fine while the ONLY way to take a booking payment was a redirect to Stripe's
// hosted Checkout, because that flow is the only one that emits
// checkout.session.completed.
//
// Embedded Stripe Elements does not create a Checkout Session at all. It emits
// `payment_intent.succeeded` and NOTHING ELSE. Pointed at the old webhook that
// meant: money captured on the customer's card, `rentals.payment_status` never
// set, no payments row completed, no apply-payment, no booking email, no
// deposit hold. A silent, total settlement failure on a real charge.
//
// So the work is extracted here and called from BOTH events in BOTH webhooks.
//
// IDEMPOTENCY IS THE WHOLE POINT
//
// A hosted Checkout emits checkout.session.completed AND payment_intent.succeeded
// for the same money. Stripe also redelivers events (~15 attempts) and does not
// guarantee ordering. So this function keys every decision off the OBSERVED
// STATE of the payments row, never off which event invoked it:
//
//   * a payments row that is already {Completed|Applied} + captured means the
//     money-moving steps (apply-payment, PAYG/installment settlement, the
//     customer email) have already run — they are skipped.
//   * the idempotent steps (rentals.payment_status, place-deposit-hold) run
//     regardless, so a first pass that half-failed can still self-heal.
//
// The downstream functions carry their own guards too (apply-payment tracks
// allocated totals, notify-booking-pending dedupes per rental,
// place-deposit-hold no-ops on an existing hold, bonzah-confirm-payment skips
// an already-active policy), so this is belt AND braces. The one genuinely
// destructive re-run this guard prevents is stomping a row apply-payment has
// already advanced to 'Applied' back down to 'Completed'.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import type { PlatformAccount } from "./stripe-client.ts";

/**
 * Stripe metadata as it reaches us. `session.metadata` on the hosted path,
 * `paymentIntent.metadata` on the Elements path — identical shape, because
 * create-booking-payment-intent copies create-checkout-session's block verbatim.
 */
export type BookingSettlementMetadata = Record<string, string | undefined> | null;

export interface BookingSettlementContext {
  supabase: SupabaseClient;
  /** Client for the platform account the event was verified against. */
  stripe: Stripe;
  /**
   * `{ stripeAccount }` when the event came from a connected account.
   *
   * Accepted but intentionally NOT used inside settleBookingPayment: the one
   * Stripe read in here (the installment-plan payment-method lookup) reproduces
   * the original's omission of it on purpose — see the note at that call site.
   * Callers pass it so this stays a drop-in for the inline code and so a future
   * connected-account read has it to hand.
   */
  stripeOptions: Stripe.RequestOptions | undefined;
  /** Which platform account new payments rows belong to. */
  platformAccount: PlatformAccount;
  /** "[TEST MODE]" / "[LIVE MODE]" — keeps log lines greppable per webhook. */
  logPrefix: string;
}

export interface BookingSettlementInput {
  /** rentals.id. `session.client_reference_id ?? metadata.rental_id`. */
  rentalId: string | null;
  /**
   * Correlation key for the hosted path. Null on the Elements path, where no
   * Checkout Session exists.
   */
  checkoutSessionId: string | null;
  /** Correlation key for the Elements path; also stamped on the hosted path. */
  paymentIntentId: string | null;
  /** session.metadata or paymentIntent.metadata. */
  metadata: BookingSettlementMetadata;
  /** session.amount_total or paymentIntent.amount_received, in MINOR units. */
  amountMinorUnits: number | null;
}

export interface BookingSettlementResult {
  /** False when we declined to act (no rental, no correlation key). */
  handled: boolean;
  /** The payments row this settlement is about, when one was found or created. */
  paymentId: string | null;
  /** True when the row was already settled, so money-moving steps were skipped. */
  alreadySettled: boolean;
  /** Machine-readable explanation when handled === false. */
  reason?: string;
}

const FUNCTIONS_BASE = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const SERVICE_AUTH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
});

/**
 * The rental shape the booking notification needs.
 *
 * `customer` and `vehicle` are to-ONE embeds (rentals.customer_id / vehicle_id),
 * so PostgREST returns an object for each. supabase-js infers an ARRAY for any
 * embed when the client carries no Database generic — which is why the inline
 * original compiled (its client was untyped so every field was `any`) and why
 * this one needs the shape stated. The cast at the query below is that
 * statement, not a papering-over: the runtime value really is an object.
 */
interface RentalNotificationRow {
  id: string;
  start_date: string;
  end_date: string;
  monthly_amount: number | null;
  tenant_id: string | null;
  customer: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; make: string | null; model: string | null; reg: string | null } | null;
}

/**
 * A payments row is settled when the money is captured AND the row has been
 * advanced past 'Pending'. apply-payment moves 'Completed' -> 'Applied', so both
 * count. This is the ONLY idempotency test — deliberately a property of the row,
 * not of the event, so it holds whichever event arrives first or twice.
 */
function isSettledRow(row: { status?: string | null; capture_status?: string | null } | null): boolean {
  if (!row) return false;
  return row.capture_status === "captured" && (row.status === "Completed" || row.status === "Applied");
}

/**
 * Settle a captured booking payment.
 *
 * This is a line-for-line extraction of the "Auto mode: Payment was captured"
 * else-branch of `checkout.session.completed`. It deliberately does NOT cover the
 * branches that break out before it — invoice payments, installment checkouts,
 * extensions, excess mileage, security-deposit holds, hold-as-credit and the
 * pre-auth path all keep their own inline handlers, untouched.
 *
 * It also deliberately does NOT do the two steps that sit AFTER the
 * preauth/auto fork in the webhook (the payment-intent-id backfill and the
 * Bonzah confirmation), because those run for the pre-auth path too. The
 * backfill stays inline; Bonzah is `confirmBonzahPolicy` below so both entry
 * points can call it.
 */
export async function settleBookingPayment(
  ctx: BookingSettlementContext,
  input: BookingSettlementInput,
): Promise<BookingSettlementResult> {
  const { supabase, stripe, platformAccount, logPrefix } = ctx;
  const { rentalId, checkoutSessionId, paymentIntentId, metadata, amountMinorUnits } = input;

  // The original reached this code only via `if (!rentalId && !isInvoicePayment) break`,
  // which lets a malformed invoice_payment session through with a null rental and
  // then runs `.eq("id", null)` against rentals. Refuse instead of writing nowhere.
  if (!rentalId) {
    console.log(`${logPrefix} Booking settlement skipped: no rental id`);
    return { handled: false, paymentId: null, alreadySettled: false, reason: "no_rental_id" };
  }
  if (!checkoutSessionId && !paymentIntentId) {
    console.error(`${logPrefix} Booking settlement skipped: no Stripe correlation key for rental`, rentalId);
    return { handled: false, paymentId: null, alreadySettled: false, reason: "no_correlation_key" };
  }

  const isPortalPayment = metadata?.source === "portal";
  console.log(
    `${logPrefix} Booking settlement:`,
    rentalId,
    isPortalPayment ? "(portal-initiated)" : "(booking flow)",
    checkoutSessionId ? `session=${checkoutSessionId}` : `pi=${paymentIntentId}`,
  );

  // ---- 1. Rental payment_status -----------------------------------------
  // Plain idempotent write, so it runs on every delivery — a redelivery after a
  // partial failure is exactly when we want it to land.
  if (!isPortalPayment) {
    const { error: rentalUpdateError } = await supabase
      .from("rentals")
      .update({ payment_status: "fulfilled", updated_at: new Date().toISOString() })
      .eq("id", rentalId);

    if (rentalUpdateError) {
      console.error(`${logPrefix} Failed to update rental payment_status:`, rentalUpdateError);
    } else {
      console.log(`${logPrefix} Rental payment_status updated to fulfilled`);
    }
  }

  // ---- 2. Locate the pre-inserted payments row ---------------------------
  // Correlate on the session when there is one (hosted path, unchanged), else on
  // the PaymentIntent (Elements path — create-booking-payment-intent pre-inserts
  // the row stamped with the PI id for exactly this lookup).
  //
  // DELIBERATE DEVIATION from the original `.single()`: ordered `.limit(1)
  // .maybeSingle()`. `.single()` errors on >1 row, the error was discarded, and
  // the code then fell through to the INSERT branch — minting a SECOND
  // Completed/captured payments row for the full amount whenever legacy
  // duplicates or a webhook race left two rows on one session. Preferring the
  // newest row is what the extension branch in this same webhook already does,
  // for the same stated reason. For 0 and 1 rows the behaviour is identical.
  let paymentQuery = supabase.from("payments").select("id, status, capture_status");
  paymentQuery = checkoutSessionId
    ? paymentQuery.eq("stripe_checkout_session_id", checkoutSessionId)
    : paymentQuery.eq("stripe_payment_intent_id", paymentIntentId as string);

  const { data: existingPayment } = await paymentQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const alreadySettled = isSettledRow(existingPayment);
  let finalPaymentId: string | null = existingPayment?.id ?? null;

  if (existingPayment) {
    if (alreadySettled) {
      // Re-running the money-moving steps below is what would actually hurt, so
      // stop short of them — but say so loudly, because this is also the log line
      // that tells an operator a duplicate delivery was absorbed rather than lost.
      console.log(
        `${logPrefix} Payment already settled, skipping allocation/notification:`,
        existingPayment.id,
        `(status=${existingPayment.status}, capture=${existingPayment.capture_status})`,
      );
    } else {
      const updates: Record<string, unknown> = {
        status: "Completed",
        capture_status: "captured",
        verification_status: "auto_approved",
        updated_at: new Date().toISOString(),
      };
      // Only stamp identifiers we actually have — the Elements path has no
      // session id and must not null out a column it never populated.
      if (paymentIntentId) updates.stripe_payment_intent_id = paymentIntentId;
      if (checkoutSessionId) updates.stripe_checkout_session_id = checkoutSessionId;

      const { error: updateError } = await supabase
        .from("payments")
        .update(updates)
        .eq("id", existingPayment.id);

      if (updateError) {
        console.error(`${logPrefix} Failed to update payment to Completed:`, updateError);
      } else {
        console.log(`${logPrefix} Payment updated to Completed:`, existingPayment.id);
      }
    }
  } else {
    // ---- 2b. No pre-inserted row — create one (legacy booking flow) -------
    const { data: rental } = await supabase
      .from("rentals")
      .select("customer_id, vehicle_id, monthly_amount, tenant_id")
      .eq("id", rentalId)
      .single();

    if (rental) {
      const paymentAmount = amountMinorUnits ? amountMinorUnits / 100 : rental.monthly_amount;
      const today = new Date().toISOString().split("T")[0];

      const paymentData: Record<string, unknown> = {
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
        capture_status: "captured",
        // payments_booking_source_check allows only ('admin','website').
        booking_source: "website",
        platform_account: platformAccount,
      };
      if (checkoutSessionId) paymentData.stripe_checkout_session_id = checkoutSessionId;
      if (paymentIntentId) paymentData.stripe_payment_intent_id = paymentIntentId;
      if (rental.tenant_id) paymentData.tenant_id = rental.tenant_id;

      const { data: newPayment, error: paymentError } = await supabase
        .from("payments")
        .insert(paymentData)
        .select()
        .single();

      if (paymentError) {
        console.error(`${logPrefix} Failed to create payment record:`, paymentError);
      } else {
        console.log(`${logPrefix} Payment record created from webhook:`, newPayment.id);
        finalPaymentId = newPayment.id;
      }
    }
  }

  // ---- 3. Ledger allocation + invoice settlement -------------------------
  // Everything in this block moves money in the ledger. Gated on !alreadySettled.
  if (finalPaymentId && !alreadySettled) {
    try {
      const targetCategories = metadata?.target_categories
        ? JSON.parse(metadata.target_categories)
        : undefined;

      console.log(
        `${logPrefix} Triggering apply-payment for:`,
        finalPaymentId,
        targetCategories ? `categories: ${targetCategories.join(", ")}` : "(universal FIFO)",
      );

      const applyResponse = await fetch(`${FUNCTIONS_BASE()}/apply-payment`, {
        method: "POST",
        headers: SERVICE_AUTH(),
        body: JSON.stringify({
          paymentId: finalPaymentId,
          ...(targetCategories ? { targetCategories } : {}),
        }),
      });
      if (applyResponse.ok) {
        console.log(`${logPrefix} Payment FIFO allocation completed`);
      } else {
        console.error(`${logPrefix} FIFO allocation failed:`, await applyResponse.text());
      }
    } catch (applyError) {
      console.error(`${logPrefix} Error applying payment:`, applyError);
    }

    const paygAccrualId = metadata?.payg_accrual_id;
    if (paygAccrualId) {
      const { error: settleErr } = await supabase.rpc("payg_settle_invoice", {
        p_payment_id: finalPaymentId,
        p_accrual_id: paygAccrualId,
      });
      if (settleErr) {
        console.error(`${logPrefix} PAYG settle_invoice failed:`, settleErr);
      } else {
        console.log(`${logPrefix} PAYG invoice settled:`, paygAccrualId);
      }
    }

    let installmentId = metadata?.installment_id;
    const installmentPlanId = metadata?.installment_plan_id;

    // SELF-HEAL FALLBACK: when the caller forgot to stamp installment_id
    // (typically a stale bundle that didn't forward the prop, but possible for
    // any consumer that doesn't know about installments), discover it
    // server-side. rental_id is always on metadata, and the rental either has an
    // installment plan or doesn't. If it does AND the payment looks like a
    // rental-installment payment (not an extension/bonzah/etc.), settle the
    // latest overdue or due-today open slot. installment_settle_invoice
    // cumulatively supersedes earlier opens, so this matches the PAYG-style
    // "pay the latest invoice and earlier ones clear" behaviour already wired
    // for paygAccrualId.
    //
    // CRITICAL GUARD: skip self-heal when this payment is category-targeted to
    // fees only (Tax, Service Fee, etc.). A Tax payment must never settle an
    // installment slot — that corrupts the plan (flips upfront_paid=true, stamps
    // upfront_payment_id with the wrong payment) and leaves the Tax ledger entry
    // untouched, so the UI shows "Tax: Not Paid" while the installment side
    // records the money. The explicit case (installment_id stamped by the
    // caller) is unaffected.
    const rentalIdFromMeta = metadata?.rental_id;
    const hasExtensionId = !!metadata?.extension_id;
    const hasBonzahId = !!metadata?.bonzah_policy_id;
    const targetCategoriesMeta: string[] | null = metadata?.target_categories
      ? (() => {
          try {
            return JSON.parse(metadata.target_categories as string);
          } catch {
            return null;
          }
        })()
      : null;
    const isCategoryTargeted = Array.isArray(targetCategoriesMeta) && targetCategoriesMeta.length > 0;
    const targetsIncludeRental = isCategoryTargeted && targetCategoriesMeta.includes("Rental");
    const allowInstallmentSelfHeal = !isCategoryTargeted || targetsIncludeRental;

    if (!installmentId && rentalIdFromMeta && !hasExtensionId && !hasBonzahId && allowInstallmentSelfHeal) {
      try {
        const todayStr = new Date().toISOString().split("T")[0];
        // Latest (highest installment_number) is the PAYG-style cumulative
        // target — settling it auto-clears earlier ones via supersession.
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
          console.log(
            `${logPrefix} Installment self-heal: resolved`,
            targetSlot.id,
            "from rental",
            rentalIdFromMeta,
            `(slot ${targetSlot.installment_number})`,
          );
        }
      } catch (fbErr) {
        console.error(`${logPrefix} Installment self-heal lookup failed:`, fbErr);
      }
    } else if (!installmentId && rentalIdFromMeta && !hasExtensionId && !hasBonzahId && !allowInstallmentSelfHeal) {
      console.log(
        `${logPrefix} Skipping installment self-heal: payment is targeted to non-Rental categories (${targetCategoriesMeta?.join(", ")}). Installment plan untouched.`,
      );
    }

    if (installmentId) {
      const { error: instSettleErr } = await supabase.rpc("installment_settle_invoice", {
        p_payment_id: finalPaymentId,
        p_installment_id: installmentId,
      });
      if (instSettleErr) {
        console.error(`${logPrefix} Installment settle_invoice failed:`, instSettleErr);
      } else {
        console.log(`${logPrefix} Installment invoice settled:`, installmentId);
        if (installmentPlanId) {
          let paymentMethodId: string | undefined;
          if (paymentIntentId) {
            try {
              // PRESERVED AS-IS: the original omits stripeOptions here, so on a
              // connected account this retrieve 404s, paymentMethodId stays
              // undefined and collection_mode falls back to 'manual'. Fixing it
              // would silently flip live plans to auto-collection, which is a
              // behaviour change well outside this refactor. Flagged, not fixed.
              const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
              paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
            } catch (piErr) {
              console.error(`${logPrefix} Failed to retrieve PI for installment plan:`, piErr);
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

  // Payment received: both the in-app BELL and the operator EMAIL are emitted
  // universally by DB triggers (notify_payment_received on payments, and the
  // notify-operator-email dispatch on notifications), which fire from EVERY
  // settlement path — so nothing is emitted here.

  // ---- 4. Customer booking notification ----------------------------------
  // notify-booking-pending dedupes per rental on its own, but gate it anyway so a
  // redelivery doesn't even make the call.
  if (!isPortalPayment && finalPaymentId && !alreadySettled) {
    try {
      const { data: rentalRow } = await supabase
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

      // See RentalNotificationRow: the to-one embeds really are objects at runtime.
      const rentalWithDetails = rentalRow as unknown as RentalNotificationRow | null;

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
          pickupDate: new Date(rentalWithDetails.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          returnDate: new Date(rentalWithDetails.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          amount: rentalWithDetails.monthly_amount || (amountMinorUnits ? amountMinorUnits / 100 : 0),
          bookingRef: rentalId.substring(0, 8).toUpperCase(),
          paymentMode: "auto",
        };

        console.log(`${logPrefix} Sending booking pending notification for auto mode:`, notificationData.bookingRef);

        const notifyResponse = await fetch(`${FUNCTIONS_BASE()}/notify-booking-pending`, {
          method: "POST",
          headers: SERVICE_AUTH(),
          body: JSON.stringify(notificationData),
        });

        if (notifyResponse.ok) {
          console.log(`${logPrefix} Booking notification sent successfully`);
        } else {
          console.error(`${logPrefix} Failed to send booking notification:`, await notifyResponse.text());
        }
      }
    } catch (notifyError) {
      console.error(`${logPrefix} Error sending booking notification:`, notifyError);
    }
  }

  // ---- 5. Auto-place the deposit hold ------------------------------------
  // When the caller stamped place_deposit_hold='true', the payment we just
  // captured saved the customer's card (setup_future_usage: 'off_session' on
  // both the Checkout Session and the Elements PaymentIntent). Authorise the
  // deposit on that same card without prompting the customer —
  // place-deposit-hold creates a manual-capture PaymentIntent and writes
  // deposit_hold_status='held' on the rental.
  //
  // NOT gated on !alreadySettled, on purpose: place-deposit-hold is itself
  // idempotent (existing hold or deposits-disabled => safe no-op), so letting a
  // redelivery reach it is how a hold that failed on the first pass gets a
  // second chance instead of being stranded behind the idempotency guard.
  if (metadata?.place_deposit_hold === "true") {
    console.log(`${logPrefix} place_deposit_hold flag detected, placing off-session hold for rental:`, rentalId);
    try {
      const holdResponse = await fetch(`${FUNCTIONS_BASE()}/place-deposit-hold`, {
        method: "POST",
        headers: SERVICE_AUTH(),
        body: JSON.stringify({ rentalId }),
      });
      const holdResult = await holdResponse.json().catch(() => ({}));
      if (holdResponse.ok) {
        if (holdResult.skipped) {
          console.log(`${logPrefix} Deposit hold skipped:`, holdResult.message);
        } else if (holdResult.alreadyHeld) {
          console.log(`${logPrefix} Deposit hold already active`);
        } else {
          console.log(`${logPrefix} Deposit hold placed:`, holdResult.paymentIntentId, "amount:", holdResult.amount);
        }
      } else {
        // Don't fail the webhook — the rental payment is already captured. The
        // hold can be placed manually from the rental detail page.
        console.error(`${logPrefix} place-deposit-hold failed:`, holdResult?.error || holdResponse.statusText);
        await supabase
          .from("rentals")
          .update({ deposit_hold_status: "failed" })
          .eq("id", rentalId)
          .is("deposit_hold_status", null);
      }
    } catch (holdError) {
      console.error(`${logPrefix} Error invoking place-deposit-hold:`, holdError);
    }
  }

  return { handled: true, paymentId: finalPaymentId, alreadySettled };
}

/**
 * Confirm a Bonzah insurance payment and issue the policy.
 *
 * Extracted verbatim from the tail of `checkout.session.completed`, where it sits
 * OUTSIDE the preauth/auto fork and therefore runs for both. Kept as its own
 * export (rather than folded into settleBookingPayment) precisely so that
 * property is preserved: the webhook still calls it after either branch.
 *
 * bonzah-confirm-payment short-circuits on an already-active policy, so this is
 * safe to call on every delivery.
 */
export async function confirmBonzahPolicy(
  ctx: Pick<BookingSettlementContext, "logPrefix">,
  params: { bonzahPolicyId: string; paymentIntentId: string | null },
): Promise<void> {
  const { logPrefix } = ctx;
  const { bonzahPolicyId, paymentIntentId } = params;

  console.log(`${logPrefix} Confirming Bonzah insurance payment for policy:`, bonzahPolicyId);
  try {
    const bonzahResponse = await fetch(`${FUNCTIONS_BASE()}/bonzah-confirm-payment`, {
      method: "POST",
      headers: SERVICE_AUTH(),
      body: JSON.stringify({
        policy_record_id: bonzahPolicyId,
        stripe_payment_intent_id: paymentIntentId,
      }),
    });

    if (bonzahResponse.ok) {
      const bonzahResult = await bonzahResponse.json();
      console.log(`${logPrefix} Bonzah policy issued successfully:`, bonzahResult.policy_no);
    } else {
      const errorText = await bonzahResponse.text();
      console.error(`${logPrefix} Failed to confirm Bonzah payment:`, errorText);
    }
  } catch (bonzahError) {
    // Don't fail the webhook for Bonzah errors — payment was still successful.
    console.error(`${logPrefix} Error calling bonzah-confirm-payment:`, bonzahError);
  }
}
