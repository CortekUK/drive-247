/**
 * Square integration — the ONLY sanctioned provider predicates.
 *
 * BINDING RULE: `.eq('payment_provider','stripe')` is the only permitted form.
 * `.neq('payment_provider','square')` and `.is('payment_provider', null)` are
 * banned and CI-grepped.
 *
 * WHY THIS IS NOT PEDANTRY
 *
 * The column is `text NOT NULL DEFAULT 'stripe'`, so today all 52 tenants and all
 * 1,026 payments carry 'stripe' and `.eq(...,'stripe')` is a provably verifiable
 * no-op. Had the column been nullable-with-no-default — as five area plans
 * assumed — every one of those rows would be NULL and the SAME predicate would
 * match ZERO rows. These fences go on recover-pending-stripe-payments
 * (pg_cron jobid 34, every minute), the only webhook-miss recovery in the
 * system. Under nullable, a defence-in-depth line becomes a silent kill switch
 * on real Stripe money recovery. The predicate and the DDL are one decision.
 */

/** Column name, centralised so a rename is one edit rather than a grep-and-pray. */
export const PROVIDER_COLUMN = "payment_provider";

export const STRIPE = "stripe" as const;
export const SQUARE = "square" as const;

/**
 * Restrict a PostgREST query to Stripe rows.
 *
 *   applyStripeOnly(supabase.from('payments').select('*'))
 *
 * Typed loosely on purpose: PostgREST builder generics differ across the
 * versions pinned in this repo, and a precise type here would break callers.
 */
// deno-lint-ignore no-explicit-any
export function applyStripeOnly<T extends { eq: (c: string, v: string) => any }>(query: T): T {
  return query.eq(PROVIDER_COLUMN, STRIPE) as T;
}

// deno-lint-ignore no-explicit-any
export function applySquareOnly<T extends { eq: (c: string, v: string) => any }>(query: T): T {
  return query.eq(PROVIDER_COLUMN, SQUARE) as T;
}

/**
 * "This row represents real electronic money at a processor."
 *
 * Ten sites across server and portal encode that idea as
 * `stripe_payment_intent_id IS NOT NULL`. That was a correct definition while
 * Stripe was the only rail; it silently becomes "this is a Stripe payment" the
 * moment a second processor exists, and every one of those sites then treats a
 * genuine Square charge as a MANUAL payment — refundable only on paper,
 * un-voidable, and misclassified in the ledger.
 *
 * The two handles are mutually exclusive at the database level
 * (`payments_provider_handle_exclusivity_check`), so this widening cannot make
 * a Stripe row match differently than it did before: for every existing row
 * `square_payment_id` is NULL, and the OR collapses to the original term. That
 * is what makes it safe to ship while all 1,026 rows are still Stripe.
 */
export const STRIPE_PAYMENT_HANDLE = "stripe_payment_intent_id";
export const SQUARE_PAYMENT_HANDLE = "square_payment_id";

/**
 * Widen a PostgREST query from "has a Stripe PaymentIntent" to "has a processor
 * handle on either rail".
 *
 *   applyElectronicPaymentFilter(supabase.from('payments').select('*'))
 *
 * NOTE ON `.or()`: PostgREST applies `.or()` at the top level of the WHERE
 * clause, so it composes with the `.eq()`/`.in()` terms already on the builder
 * as AND(existing…, OR(stripe, square)). Callers that need the two handles
 * scoped inside a larger disjunction must build that explicitly rather than
 * chaining a second `.or()`.
 */
// deno-lint-ignore no-explicit-any
export function applyElectronicPaymentFilter<T extends { or: (f: string) => any }>(query: T): T {
  return query.or(
    `${STRIPE_PAYMENT_HANDLE}.not.is.null,${SQUARE_PAYMENT_HANDLE}.not.is.null`,
  ) as T;
}

/**
 * The in-memory twin, for rows already fetched.
 *
 * Kept beside the query helper deliberately: when these two disagree, a row is
 * selected for refund and then classified as manual, which is precisely the
 * bug this module exists to prevent.
 */
export function isElectronicPayment(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  return Boolean(row[STRIPE_PAYMENT_HANDLE]) || Boolean(row[SQUARE_PAYMENT_HANDLE]);
}
