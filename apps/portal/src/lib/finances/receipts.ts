/**
 * The Received view — `payments` rows as receipts. Pure.
 *
 * Status, in the order it is decided:
 *   rejected            verification_status 'rejected', or the row was voided
 *                       (status 'Reversed' / 'Cancelled') — no money is kept
 *   pending_review      verification_status 'pending' on a row that is still
 *                       actionable (the Payments tab's `isPendingActionable`:
 *                       not reversed, capture not cancelled)
 *   refunded            money landed and was returned in full
 *   partially_refunded  money landed and part was returned
 *   approved            money landed (lib/payment-status `isMoneyReceived`:
 *                       a received status and not `requires_capture`)
 *   refunded            status 'Refunded' (money that never counts again)
 *   pending             everything else — a checkout link not yet paid, a hold
 *                       awaiting capture. A placeholder, not money.
 *
 * Unapplied is the allocator's own `remaining_amount`, and only on captured
 * credit (Applied/Credit/Partial, not requires_capture) — the same rule as the
 * customer balance's credit (lib/finances/balance.ts `isCapturedCredit`).
 */

import { isMoneyReceived } from "@/lib/payment-status";
import { isCapturedCredit, toCents } from "./balance";
import { rentalRefOf, UNKNOWN_CUSTOMER, type FinanceLookups } from "./lookups";
import { dayOf, instantDay } from "./period";
import type { FinanceContext, FinanceRawData, RawAttempt, RawPayment, ReceiptRow, ReceiptStatus } from "./types";

export function receiptStatus(p: RawPayment): ReceiptStatus {
  const v = p.verification_status ?? null;
  const s = p.status ?? null;
  if (v === "rejected") return "rejected";
  if (s === "Reversed" || s === "Cancelled") return "rejected";
  if (v === "pending" && p.capture_status !== "cancelled") return "pending_review";
  if (isMoneyReceived(p)) {
    const amount = toCents(p.amount);
    const refunded = toCents(p.refund_amount);
    if (refunded > 0 && refunded >= amount) return "refunded";
    if (refunded > 0 || s === "Partial Refund") return "partially_refunded";
    return "approved";
  }
  if (s === "Refunded") return "refunded";
  return "pending";
}

const SESSION_MODE = /^cs_(live|test)_/;

export interface ProviderFacts {
  provider: ReceiptRow["provider"];
  providerRef: string | null;
  references: string[];
  sessionMode: "test" | "live" | null;
}

/**
 * Which processor holds this money, told apart by the ids on the row — not by
 * `payment_provider`, which defaults to 'stripe' on rows no processor ever saw.
 */
export function providerFacts(p: RawPayment, attempt?: RawAttempt | null): ProviderFacts {
  const stripe = [p.stripe_payment_intent_id, p.stripe_checkout_session_id].filter((x): x is string => !!x);
  const square = [p.square_payment_id, p.square_order_id, p.square_payment_link_id].filter((x): x is string => !!x);
  const references = [...stripe, ...square];
  const session = p.stripe_checkout_session_id ?? null;
  const sessionMode = session && SESSION_MODE.test(session) ? (SESSION_MODE.exec(session)![1] as "test" | "live") : null;

  if (attempt?.provider === "manual") return { provider: "manual", providerRef: null, references, sessionMode };
  if (square.length > 0 && (p.payment_provider === "square" || stripe.length === 0)) {
    return { provider: "square", providerRef: p.square_payment_id ?? p.square_order_id ?? p.square_payment_link_id ?? null, references, sessionMode };
  }
  if (stripe.length > 0) {
    return { provider: "stripe", providerRef: p.stripe_payment_intent_id ?? p.stripe_checkout_session_id ?? null, references, sessionMode };
  }
  return { provider: "manual", providerRef: null, references, sessionMode };
}

/** The attempt that produced each payment (a plan payment), preferring the succeeded one. */
export function attemptsByPayment(attempts: RawAttempt[]): Map<string, RawAttempt> {
  const out = new Map<string, RawAttempt>();
  for (const a of attempts) {
    if (!a.payment_id) continue;
    const prev = out.get(a.payment_id);
    if (!prev || (prev.status !== "succeeded" && a.status === "succeeded") || (prev.status === a.status && a.attempt_no > prev.attempt_no)) {
      out.set(a.payment_id, a);
    }
  }
  return out;
}

export function buildReceipts(
  raw: FinanceRawData,
  lk: FinanceLookups,
  labels: Map<string, string>,
  ctx?: Pick<FinanceContext, "timeZone">,
): ReceiptRow[] {
  const attemptFor = attemptsByPayment(raw.attempts);
  const rows: ReceiptRow[] = raw.payments.map((p) => {
    const attempt = attemptFor.get(p.id) ?? null;
    const facts = providerFacts(p, attempt);
    const rental = p.rental_id ? lk.rentalById.get(p.rental_id) ?? null : null;
    const vehicleId = p.vehicle_id ?? rental?.vehicle_id ?? null;
    const amountCents = toCents(p.amount);
    const refundedCents = toCents(p.refund_amount);
    const countsAsReceived = isMoneyReceived(p);
    const mode = attempt?.provider_mode === "live" || attempt?.provider_mode === "test" ? attempt.provider_mode : facts.sessionMode;
    // `payments.payment_plan_occurrence_id` and the attempt's `payment_id` are
    // written together (pp_record_success); either names the occurrence.
    const occurrenceId = p.payment_plan_occurrence_id ?? attempt?.occurrence_id ?? null;

    const appliedTo = (lk.allocationsByPayment.get(p.id) ?? []).map((a) => {
      const charge = lk.chargeById.get(a.chargeId) ?? null;
      const chargeRental = charge?.rental_id ? lk.rentalById.get(charge.rental_id) ?? null : null;
      return {
        chargeId: a.chargeId,
        category: charge?.category ?? "Unknown charge",
        rentalRef: charge?.rental_id ? rentalRefOf(chargeRental, charge.rental_id) : null,
        amountCents: a.amountCents,
      };
    });

    return {
      paymentId: p.id,
      // payment_date is the operator-recorded NOT NULL date the portal shows.
      date: dayOf(p.payment_date) ?? instantDay(p.created_at, ctx?.timeZone ?? null) ?? "",
      customerId: p.customer_id ?? "",
      customerName: (p.customer_id && lk.customerNameById.get(p.customer_id)) || UNKNOWN_CUSTOMER,
      rentalId: p.rental_id ?? null,
      rentalRef: p.rental_id ? rentalRefOf(rental, p.rental_id) : null,
      vehicleReg: vehicleId ? lk.vehicleRegById.get(vehicleId) ?? null : null,
      amountCents,
      refundedCents,
      unappliedCents: isCapturedCredit(p) ? Math.max(0, toCents(p.remaining_amount)) : 0,
      method: p.method ?? null,
      provider: facts.provider,
      providerRef: facts.providerRef,
      providerMode: mode,
      status: receiptStatus(p),
      appliedTo,
      planLabel: occurrenceId ? labels.get(occurrenceId) ?? null : null,
      occurrenceId,
      rawStatus: p.status ?? null,
      paymentType: p.payment_type ?? "Payment",
      countsAsReceived,
      netCents: countsAsReceived ? Math.max(0, amountCents - refundedCents) : 0,
      references: facts.references,
      providerAccount: attempt?.provider_account ?? null,
      checkoutSessionId: p.stripe_checkout_session_id ?? attempt?.checkout_session_id ?? null,
      verificationStatus: p.verification_status ?? null,
      recordedById: attempt?.created_by ?? null,
      recordedAt: p.created_at ?? null,
      extensionId: p.extension_id ?? null,
      vehicleId,
      // The old "Payment Requests" list's own selection, on the row itself —
      // not `checkoutSessionId`, which also falls back to a plan attempt's session.
      isPaymentRequest: !!p.stripe_checkout_session_id || !!p.square_payment_link_id,
    };
  });

  return rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ra = a.recordedAt ?? "";
    const rb = b.recordedAt ?? "";
    if (ra !== rb) return ra < rb ? 1 : -1;
    return a.paymentId < b.paymentId ? -1 : 1;
  });
}
