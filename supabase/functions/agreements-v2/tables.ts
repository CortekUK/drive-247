/**
 * agreements-v2 edge function — the table it owns, and how "not there yet"
 * looks. PURE.
 */

export const INDIVIDUAL_TABLE = 'individual_agreements_v2';

/**
 * The table is not there at all, which is what `individual_agreements_v2`
 * looks like until ops/agreements_v2.sql is applied.
 *
 * A copy of `isMissingTableError` in apps/portal/src/lib/agreements-v2/status.ts
 * (tests/integrations/agreements-v2/edge-function.test.ts runs both over the
 * same errors). Codes before message text: `42P01` is Postgres's
 * `undefined_table`, `PGRST205` is PostgREST failing to find it in its schema
 * cache. A missing COLUMN (`42703`) is NOT a missing table: that is schema
 * drift on a table that exists.
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
