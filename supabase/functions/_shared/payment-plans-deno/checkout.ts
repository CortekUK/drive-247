// Payment plans — recording a paid plan Checkout Session.
//
// ONE function, two callers, so they cannot drift:
//   * stripe-webhook-live / stripe-webhook-test, on checkout.session.completed
//     with metadata.type === 'payment_plan' (the source of truth);
//   * payment-plan-pay, when the customer lands back on /pay/plan/<token>
//     with ?session_id= — a belt-and-braces confirmation for a webhook that is
//     late or was lost.
// Both end in the engine's onLinkPaid → pp_record_success, which is idempotent
// on the attempt: the second of the two writes nothing (S7). A DIFFERENT paid
// session for an attempt that already succeeded is reported to the operator,
// never dropped.
//
// Returns a status for logging; THROWS on anything that deserves a retry (the
// webhook turns a throw into a 500 and Stripe redelivers). An attempt id that
// does not exist is not retryable — it is logged and answered 200 so it cannot
// eat the endpoint's auto-disable budget.

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import type { PlatformAccount } from "../stripe-client.ts";
import { onLinkPaid } from "../payment-plans/engine.ts";
import { PlanStoreError } from "../payment-plans/errors.ts";
import { SupabasePlanStore, type PlanDbClient } from "./supabase-store.ts";
import { DenoNotifier } from "./notifier.ts";
import { notifyOperatorsInApp } from "../notify-inapp.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlanCheckoutStatus = "recorded" | "already_recorded" | "duplicate_payment" | "not_paid" | "ignored" | "unknown_attempt";

export async function recordPlanCheckoutSession(
  db: PlanDbClient,
  session: Stripe.Checkout.Session,
  opts: {
    stripe: Stripe;
    stripeOptions?: { stripeAccount: string };
    mode: "test" | "live";
    platformAccount: PlatformAccount;
    /** When the money was taken (the event's `created`, or now on the return page). */
    paidAt: string;
  },
): Promise<{ status: PlanCheckoutStatus; paymentId?: string | null }> {
  const attemptId = session.metadata?.attempt_id ?? "";
  if (session.metadata?.type !== "payment_plan" || !UUID.test(attemptId)) {
    console.warn("[payment-plans] checkout session without a usable attempt id:", session.id);
    return { status: "ignored" };
  }
  if (session.payment_status !== "paid") return { status: "not_paid" };

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const amountCents = Number(session.amount_total ?? 0);
  if (!paymentIntentId || !Number.isSafeInteger(amountCents) || amountCents < 1) {
    // Paid with no PaymentIntent or no amount cannot be recorded honestly, and
    // a redelivery will not change that — so no 500 (it would burn the
    // endpoint's auto-disable budget for three days). A person is told.
    await alertUnrecorded(session, "a paid plan session has no PaymentIntent or amount");
    return { status: "ignored" };
  }

  // The card the customer saved (setup_future_usage) becomes the plan's card
  // for later auto-charges. Best effort: the payment is recorded either way.
  let paymentMethodRef: string | null = null;
  try {
    const pi = await opts.stripe.paymentIntents.retrieve(paymentIntentId, opts.stripeOptions);
    if (pi.setup_future_usage && pi.payment_method) {
      paymentMethodRef = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method.id;
    }
  } catch (err) {
    console.warn("[payment-plans] could not read the PaymentIntent for the saved card:", paymentIntentId, (err as Error)?.message);
  }

  try {
    const result = await onLinkPaid(
      { store: new SupabasePlanStore(db), notifier: new DenoNotifier(db) },
      {
        attemptId,
        providerRef: paymentIntentId,
        amountCents,
        paidAt: opts.paidAt,
        checkoutSessionId: session.id,
        paymentMethodRef,
        providerMode: opts.mode,
        platformAccount: opts.platformAccount,
      },
    );
    return { status: result.status, paymentId: result.paymentId };
  } catch (err) {
    if (err instanceof PlanStoreError && err.code === "not_found") {
      console.error("[payment-plans] paid session names an unknown attempt:", attemptId, "session", session.id);
      await alertUnrecorded(session, `the session names attempt ${attemptId}, which does not exist`);
      return { status: "unknown_attempt" };
    }
    if (err instanceof PlanStoreError && (err.code === "invalid_input" || err.code === "illegal_transition")) {
      // The database refused the record on its merits; a redelivery would be
      // refused the same way. Money is at Stripe and not on the ledger.
      console.error("[payment-plans] paid session refused by pp_record_success:", session.id, err.message);
      await alertUnrecorded(session, err.message);
      return { status: "ignored" };
    }
    throw err; // transient (network, lock, outage): let Stripe redeliver
  }
}

/** Money arrived that could not be recorded: ring the tenant's bell. Never throws. */
async function alertUnrecorded(session: Stripe.Checkout.Session, why: string): Promise<void> {
  const tenantId = session.metadata?.tenant_id;
  const rentalId = session.metadata?.rental_id;
  if (!tenantId) return;
  await notifyOperatorsInApp({
    tenantId,
    type: "payment_plan_alert",
    title: "Payment received but not recorded",
    message: `A customer paid ${((session.amount_total ?? 0) / 100).toFixed(2)} ${(session.currency ?? "").toUpperCase()} through a payment-plan link, but it could not be recorded (${why}). Check Stripe session ${session.id} and record it by hand.`.slice(0, 1000),
    link: rentalId ? `/rentals/${rentalId}` : undefined,
    metadata: { checkout_session_id: session.id, rental_id: rentalId ?? null, problem: "unrecorded_link_payment" },
    dedupeKey: `pp-unrecorded:${session.id}`,
  });
}
