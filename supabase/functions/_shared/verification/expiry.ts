// feat-003: the licence expiry rule against a rental's return date (spec 11.4 to 11.6).
// No imports: the portal keeps a byte-for-byte copy (apps/portal/src/lib/verification-v2/expiry.ts),
// and evals/11-rental-warning.mjs fails if the two differ.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** True when the licence is still valid on the return date. An unknown expiry is never valid. */
export function licenceValidThrough(expiry: string | null | undefined, returnDate: string | null | undefined): boolean {
  if (!expiry || !returnDate || !ISO.test(expiry.slice(0, 10)) || !ISO.test(returnDate.slice(0, 10))) return false;
  return expiry.slice(0, 10) >= returnDate.slice(0, 10);
}
