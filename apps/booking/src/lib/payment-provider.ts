/**
 * Provider-aware copy for anything a RENTER reads.
 *
 * Deliberately a sibling of the portal's helper rather than a shared module:
 * the two apps do not share code, and the audiences differ. The portal tells an
 * operator which button to press; this tells a customer whose payment page they
 * are about to be sent to.
 *
 * That distinction is why the checkout footer matters more than it looks. It
 * read "Secured by Stripe. Card details never stored." for every renter,
 * including a Square tenant's — who was then redirected to a Square-hosted page.
 * A payment screen naming the wrong processor is the one place a customer is
 * entitled to stop and wonder whether they are being phished.
 *
 * `undefined` resolves to Stripe, matching the column default
 * (payment_provider NOT NULL DEFAULT 'stripe') and the seam's fail-safe
 * direction: a tenant row that has not loaded must never show Square branding
 * it may not be entitled to.
 */

export type PaymentProviderId = "stripe" | "square";

export function toProviderId(value: unknown): PaymentProviderId {
  return value === "square" ? "square" : "stripe";
}

/** The processor's name, as a renter should see it. */
export function providerName(value: unknown): string {
  return toProviderId(value) === "square" ? "Square" : "Stripe";
}

/** The reassurance line under the pay button. */
export function securedByLine(value: unknown): string {
  return `Secured by ${providerName(value)}. Card details never stored.`;
}

/**
 * "…still being verified by X" and similar. Kept as a function rather than a
 * template at each site so a new processor is one edit, not a search.
 */
export function verifyingLine(value: unknown): string {
  return (
    `Your payment is still being verified by ${providerName(value)}. ` +
    `You'll see it reflect on your account shortly. If you don't see it within a ` +
    `few minutes, please contact support.`
  );
}

/** Failure copy for a payment the processor took but we could not record. */
export function recordedButNotSavedLine(value: unknown): string {
  return `Payment recorded by ${providerName(value)} but failed to save locally. Please contact support.`;
}
