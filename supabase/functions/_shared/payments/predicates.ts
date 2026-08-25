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
