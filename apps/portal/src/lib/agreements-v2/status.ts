import type { AgreementStatusV2 } from './types';

/**
 * The stored `document_status` of an agreement, as the v2 list shows it (D16).
 *
 *  - Signed: `signed`, `completed`.
 *  - Failed: `send_failed`, `credit_failed`, `declined`, `expired`, `failed`.
 *  - Hidden: `voided`, `revoked`. A rental resend voids the earlier row, so
 *    that row is superseded, not a separate agreement, and is not listed.
 *  - Pending signature: everything else, including null, `pending`, `sent`,
 *    `delivered` and `viewed`, and any value this build has never heard of.
 *    An unknown status is an agreement still out with the customer until a
 *    signing event says otherwise, so it must never read as signed.
 *
 * The same vocabulary covers both kinds: `individual_agreements_v2` reuses the
 * strings `rental_agreements` and the BoldSign webhook already write.
 */
// Shared with the customer portal's Agreements list (shared/portal-v2/agreements/list.ts).
export { toAgreementStatus as toStatusV2 } from "../../../../../shared/portal-v2/agreements/list";

/**
 * The table is not there at all, which is what the v2 tables look like until
 * ops/agreements_v2.sql is applied.
 *
 * Codes before message text: `42P01` is Postgres's `undefined_table`, and
 * `PGRST205` is PostgREST failing to find it in its schema cache. The message
 * match is the fallback for older PostgREST builds that sent neither. Same
 * shape as `isNotesTableMissing` in hooks/use-tenant-notes.ts, with one
 * difference: a missing COLUMN (`42703`, "column x does not exist") is NOT a
 * missing table. That is schema drift on a table that exists, and reading it
 * as "not applied yet" would hide real rows behind an empty list.
 */
export function isMissingTableError(
  error: { message?: string | null; code?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  if (error.code === '42703') return false;
  const m = (error.message ?? '').toLowerCase();
  if (m.includes('could not find the table')) return true;
  return m.includes('does not exist') && !m.includes('column');
}
