/**
 * Whether Bonzah cover can still be bought for a rental.
 *
 * A cancelled or rejected rental never puts a car on the road, so a policy for
 * it is money out of the operator's Bonzah wallet for nothing. Mirrors
 * `isRentalClosedForInsurance` in supabase/functions/_shared/bonzah-rental-cancellation.ts,
 * which `bonzah-confirm-payment` enforces server-side; this copy only decides
 * what the portal offers. R-57f385 (Moore Luxe, 2026-11-11) is the case: a
 * "Retry" button left on a rejected booking issued a live policy.
 */
export function isRentalClosedForInsurance(
  rental: { status?: string | null; approval_status?: string | null } | null | undefined,
): boolean {
  if (!rental) return false;
  return (
    String(rental.status ?? "").toLowerCase() === "cancelled" ||
    String(rental.approval_status ?? "").toLowerCase() === "rejected"
  );
}

export const RENTAL_CLOSED_INSURANCE_NOTE =
  "This rental is cancelled, so Bonzah cover can no longer be bought for it.";
