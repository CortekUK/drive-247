// notification-test-v2 / rate-limit
//
// The test-send rate limit, as PURE functions over a PostgREST read result, so
// the rule can be driven from the portal's vitest suite (nothing here imports
// Deno or a URL module; see
// apps/portal/src/__tests__/lib/notifications-v2-test-send-limit.test.ts).
// index.ts does the query and hands the result straight to `rateLimitDecision`.
//
// FAIL CLOSED. The limit is counted in notification_test_sends_v2
// (ops/notifications_v2.sql). That SQL is applied to production by hand and the
// function is the visible half of the pair, so "function deployed, SQL not yet"
// is the likely order. While the table is missing there is no counter at all,
// and the send is an authenticated head_admin/admin of any tenant posting
// arbitrary branded HTML to an arbitrary address through the platform's shared
// Resend account. So a missing table REFUSES, in the same spirit as the
// Notifications page refusing to save while its storage is missing — rather
// than letting every send through uncounted.

/** The refusal shape index.ts already speaks (`fail`). */
export type RateLimitFailure = { ok: false; status: number; error: string; code: string };

/** Tests per user per rolling hour. */
export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

/** What an operator is told when the log table (and so the limit) isn't there. */
export const TEST_SENDING_OFF_MESSAGE = "Test sending isn't switched on yet.";
export const TEST_SENDING_OFF_CODE = 'test_sending_off';

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A missing table (the SQL is not applied yet), from PostgREST or Postgres. */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

/** What the `notification_test_sends_v2` read gave back. */
export interface RateLimitRead {
  data?: readonly { created_at?: string | null }[] | null;
  error?: { code?: string; message?: string } | null;
}

/**
 * `null` to let the send go ahead, otherwise the refusal to return.
 *
 * `now` is a parameter so the window arithmetic is testable; index.ts passes
 * nothing and gets the clock.
 */
export function rateLimitDecision(read: RateLimitRead, now: number = Date.now()): RateLimitFailure | null {
  const error = read?.error;
  if (error) {
    if (isMissingRelation(error)) {
      return { ok: false, status: 503, code: TEST_SENDING_OFF_CODE, error: TEST_SENDING_OFF_MESSAGE };
    }
    return {
      ok: false,
      status: 500,
      code: 'rate_check_failed',
      error: "Couldn't check your recent tests. Try again in a moment.",
    };
  }

  const rows = read?.data ?? [];
  if (rows.length < RATE_LIMIT) return null;

  // The rows come back oldest first, so the window frees up when the first one
  // ages out. An unparsable timestamp falls back to a whole window.
  const oldest = Date.parse(String(rows[0]?.created_at ?? ''));
  const waitMs = Number.isFinite(oldest) ? oldest + RATE_WINDOW_MS - now : RATE_WINDOW_MS;
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return {
    ok: false,
    status: 429,
    code: 'rate_limited',
    error: `You can send ${RATE_LIMIT} tests an hour. Try again in ${plural(minutes, 'minute', 'minutes')}.`,
  };
}
