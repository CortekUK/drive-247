/**
 * Finance Sync — Sprint 6 patch: canonical rental-status sets.
 *
 * `rentals.status` is a free-form TEXT column with capitalised values used
 * across the codebase. Different parts compare against different casing,
 * which used to leave the sync layer treating any unknown status as "still
 * open" (creating duplicate invoices).
 *
 * One source of truth for what counts as an OPEN rental vs a CLOSED rental
 * vs a CANCELLED rental, with case-insensitive matching.
 *
 * Spec §8.3 — the rental-to-invoice grouping rule depends on these.
 */

/** A rental in any of these statuses has a still-open invoice to append to. */
const OPEN_STATUSES = new Set([
  "active",
  "ongoing",
  "upcoming",
  "reserved",
  "pending",
  "confirmed",
]);

/** A rental in any of these statuses has its invoice finalised — no more lines. */
const CLOSED_STATUSES = new Set([
  "closed",
  "completed",
  "returned",
  "finished",
]);

/** A rental in any of these statuses was cancelled — the invoice (if any) should be voided. */
const CANCELLED_STATUSES = new Set([
  "cancelled",
  "canceled",
  "void",
  "voided",
  "aborted",
]);

function normalise(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase();
}

export function isOpenStatus(status: string | null | undefined): boolean {
  return OPEN_STATUSES.has(normalise(status));
}

export function isClosedStatus(status: string | null | undefined): boolean {
  return CLOSED_STATUSES.has(normalise(status));
}

export function isCancelledStatus(status: string | null | undefined): boolean {
  return CANCELLED_STATUSES.has(normalise(status));
}

/** A rental is "finalised" if its invoice should no longer accept new lines.
 *  Closed + cancelled both qualify. */
export function isFinalisedStatus(status: string | null | undefined): boolean {
  return isClosedStatus(status) || isCancelledStatus(status);
}
