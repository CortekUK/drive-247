/**
 * notification-test-v2's test-send rate limit (supabase/functions/
 * notification-test-v2/rate-limit.ts).
 *
 * The rule is a pure function over the `notification_test_sends_v2` read so it
 * can be driven from here; index.ts only runs the query and hands the result
 * straight to `rateLimitDecision`. Nothing in this file needs Deno.
 *
 * The point of the suite is the FAIL-CLOSED case. The counter lives in a table
 * created by ops/notifications_v2.sql, which is applied to production by hand,
 * while the function is the visible half of the pair — so "function deployed,
 * SQL not yet" is the likely order. A send is an authenticated head_admin or
 * admin of any tenant posting arbitrary branded HTML to an arbitrary address
 * through the platform's shared Resend account, and the 20-an-hour cap is the
 * only brake on it. It used to be waved through whenever the table was
 * missing; it must refuse instead.
 */

import { describe, it, expect } from "vitest";

import {
  RATE_LIMIT,
  RATE_WINDOW_MS,
  TEST_SENDING_OFF_CODE,
  TEST_SENDING_OFF_MESSAGE,
  isMissingRelation,
  rateLimitDecision,
} from "../../../../../supabase/functions/notification-test-v2/rate-limit";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

/** `n` sends, the oldest `oldestMinutesAgo` minutes back, oldest first (as the query orders them). */
function sends(n: number, oldestMinutesAgo = 10) {
  return Array.from({ length: n }, (_, i) => ({
    created_at: new Date(NOW - oldestMinutesAgo * 60_000 + i * 1_000).toISOString(),
  }));
}

describe("a missing log table refuses the send instead of allowing it", () => {
  const missing = [
    { code: "PGRST205", message: "Could not find the table 'public.notification_test_sends_v2' in the schema cache" },
    { code: "42P01", message: 'relation "notification_test_sends_v2" does not exist' },
    { message: "Could not find the table" },
    { message: 'relation "public.notification_test_sends_v2" does not exist' },
  ];

  for (const error of missing) {
    it(`refuses when the read says ${error.code ?? "(no code)"}`, () => {
      expect(isMissingRelation(error)).toBe(true);
      const decision = rateLimitDecision({ data: null, error }, NOW);
      expect(decision).not.toBeNull();
      expect(decision!.ok).toBe(false);
      expect(decision!.code).toBe(TEST_SENDING_OFF_CODE);
      expect(decision!.status).toBe(503);
    });
  }

  it("says so in words an operator can act on, and does not leak the table name", () => {
    const decision = rateLimitDecision({ error: missing[0] }, NOW)!;
    expect(decision.error).toBe(TEST_SENDING_OFF_MESSAGE);
    expect(TEST_SENDING_OFF_MESSAGE).toBe("Test sending isn't switched on yet.");
    expect(decision.error).not.toMatch(/notification_test_sends_v2|relation|schema|SQL/i);
  });

  it("refuses even when no send has ever been counted, which is exactly the open door", () => {
    // An empty result and a missing table look alike from the outside; only the
    // error tells them apart, and only one of them may go ahead.
    expect(rateLimitDecision({ data: [], error: null }, NOW)).toBeNull();
    expect(rateLimitDecision({ data: [], error: missing[0] }, NOW)?.code).toBe(TEST_SENDING_OFF_CODE);
  });
});

describe("any other read failure also refuses", () => {
  it("a permission or connection error is not a licence to send", () => {
    const decision = rateLimitDecision({ error: { code: "42501", message: "permission denied" } }, NOW);
    expect(decision?.code).toBe("rate_check_failed");
    expect(decision?.status).toBe(500);
    expect(isMissingRelation({ code: "42501", message: "permission denied" })).toBe(false);
  });

  it("an unrelated message is not mistaken for a missing table", () => {
    for (const e of [{ code: "PGRST116", message: "no rows" }, { message: "timeout" }, {}]) {
      expect(isMissingRelation(e)).toBe(false);
    }
    expect(isMissingRelation(null)).toBe(false);
    expect(isMissingRelation(undefined)).toBe(false);
  });
});

describe("the limit itself", () => {
  it("lets a send through below the cap", () => {
    expect(rateLimitDecision({ data: sends(0), error: null }, NOW)).toBeNull();
    expect(rateLimitDecision({ data: sends(RATE_LIMIT - 1), error: null }, NOW)).toBeNull();
  });

  it("refuses at the cap, and says how long until the window frees up", () => {
    // The oldest of the 20 was 10 minutes ago, so 50 minutes remain.
    const decision = rateLimitDecision({ data: sends(RATE_LIMIT, 10), error: null }, NOW);
    expect(decision?.code).toBe("rate_limited");
    expect(decision?.status).toBe(429);
    expect(decision?.error).toBe(`You can send ${RATE_LIMIT} tests an hour. Try again in 50 minutes.`);
  });

  it("counts singular minutes properly, and never promises zero", () => {
    const almostOut = [{ created_at: new Date(NOW - RATE_WINDOW_MS + 30_000).toISOString() }, ...sends(RATE_LIMIT - 1)];
    expect(rateLimitDecision({ data: almostOut, error: null }, NOW)?.error).toContain("in 1 minute.");

    const justOut = [{ created_at: new Date(NOW - RATE_WINDOW_MS - 5_000).toISOString() }, ...sends(RATE_LIMIT - 1)];
    // The row is already outside the window (the query would not return it),
    // but an answer of "0 minutes" or a negative one would be nonsense.
    expect(justOut).toHaveLength(RATE_LIMIT);
    expect(rateLimitDecision({ data: justOut, error: null }, NOW)?.error).toContain("in 1 minute.");
  });

  it("falls back to a whole window when the timestamp is unreadable", () => {
    const rows = [{ created_at: "not a date" }, ...sends(RATE_LIMIT - 1)];
    expect(rateLimitDecision({ data: rows, error: null }, NOW)?.error).toContain("in 60 minutes.");
    const missingStamp = [{ created_at: null }, ...sends(RATE_LIMIT - 1)];
    expect(rateLimitDecision({ data: missingStamp, error: null }, NOW)?.error).toContain("in 60 minutes.");
  });

  it("treats an empty read object as nothing sent, not as a failure", () => {
    expect(rateLimitDecision({}, NOW)).toBeNull();
  });

  it("caps at 20 an hour", () => {
    expect(RATE_LIMIT).toBe(20);
    expect(RATE_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});
