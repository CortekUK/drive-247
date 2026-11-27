import { describe, expect, it } from "vitest";
import { nextJourneyEmail } from "../../../../supabase/functions/_shared/onboarding-call-journey";

// The "book your call" journey reads call_cancelled_at and call_missed_at
// from the company's row (set by the database, 04-company-actions.mjs 04.26).
const NOW = Date.parse("2026-12-03T12:00:00Z");
const base = {
  tenantCreatedAt: "2026-12-01T12:00:00Z", // two days old
  subscriptionStatus: "trialing",
  welcomeSentAt: "2026-12-01T12:05:00Z",
};

describe("04 the journey after a cancel", () => {
  it("04.26 #1 with nothing booked, the reminder is due", () => {
    expect(nextJourneyEmail(base, NOW)).toBe("reminder");
  });

  it("04.26 #2 after a cancel, no journey email is due", () => {
    expect(nextJourneyEmail({ ...base, callCancelledAt: "2026-12-02T12:00:00Z" }, NOW)).toBeNull();
  });

  it("04.26 #3 after a missed call, no journey email is due", () => {
    expect(nextJourneyEmail({ ...base, callMissedAt: "2026-12-02T12:00:00Z" }, NOW)).toBeNull();
  });

  it("04.26 #4 the follow up stays stopped too", () => {
    const later = Date.parse("2026-12-04T13:00:00Z");
    const sent = { ...base, reminderSentAt: "2026-12-02T12:00:00Z" };
    expect(nextJourneyEmail(sent, later)).toBe("follow_up");
    expect(nextJourneyEmail({ ...sent, callCancelledAt: "2026-12-02T18:00:00Z" }, later)).toBeNull();
  });
});
