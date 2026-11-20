import {
  bookingLink,
  buildBookingNoticeHtml,
  buildJourneyHtml,
  callEventValues,
  journeySubject,
  nextJourneyEmail,
  type JourneyState,
} from "../../../supabase/functions/_shared/onboarding-call-journey";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-19T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();
const state = (hours: number, extra: Partial<JourneyState> = {}): JourneyState => ({
  tenantCreatedAt: ago(hours),
  subscriptionStatus: "trialing",
  ...extra,
});
const due = (s: JourneyState) => nextJourneyEmail(s, NOW);

describe("which onboarding email is due", () => {
  it("welcomes a new trial customer straight after signup", () => {
    expect(due(state(0.1))).toBe("welcome");
  });

  it("never welcomes an existing customer when this launches", () => {
    expect(due(state(7))).toBeNull();
  });

  it("sends nothing between the welcome and 24 hours", () => {
    expect(due(state(12, { welcomeSentAt: ago(12) }))).toBeNull();
  });

  it("reminds at 24 hours", () => {
    expect(due(state(24, { welcomeSentAt: ago(24) }))).toBe("reminder");
  });

  it("follows up at 48 hours, once the reminder is a day old", () => {
    expect(due(state(48, { welcomeSentAt: ago(48), reminderSentAt: ago(24) }))).toBe("follow_up");
    expect(due(state(48, { reminderSentAt: ago(10) }))).toBeNull();
  });

  it("does not send the follow-up twice, or long after signup", () => {
    expect(due(state(60, { reminderSentAt: ago(36), followUpSentAt: ago(1) }))).toBeNull();
    expect(due(state(100, { reminderSentAt: ago(70) }))).toBeNull();
  });

  it.each([
    ["booked", { callBookedAt: ago(1) }],
    ["had the call", { callCompletedAt: ago(1) }],
    ["hid the card", { dismissedAt: ago(1) }],
  ])("stops once the customer has %s", (_label, extra) => {
    expect(due(state(0.1, extra))).toBeNull();
    expect(due(state(30, extra))).toBeNull();
    expect(due(state(50, { reminderSentAt: ago(26), ...extra }))).toBeNull();
  });

  it("starts again after a cancellation clears the booking", () => {
    expect(due(state(50, { callBookedAt: null, reminderSentAt: ago(26) }))).toBe("follow_up");
  });

  it("emails nobody on a cancelled subscription or after the trial window", () => {
    expect(due(state(30, { subscriptionStatus: "canceled" }))).toBeNull();
    expect(due(state(30, { subscriptionStatus: null }))).toBeNull();
    expect(due(state(15 * 24))).toBeNull();
  });
});

describe("the emails", () => {
  const tenant = { slug: "acme", companyName: "Acme <Cars>", email: "owner+1@acme.test" };

  it("confirms the trial and offers Bryan's call in the welcome", () => {
    const html = buildJourneyHtml("welcome", tenant);
    expect(journeySubject("welcome")).toContain("14-day free trial");
    for (const text of ["14-day free trial", "30-minute onboarding session with Bryan", "add your vehicles", "set up payments", "Book Your Free Onboarding Call"]) {
      expect(html).toContain(text);
    }
  });

  it("links to Bryan's calendar with the address bookings are matched by", () => {
    expect(bookingLink(tenant.email)).toBe(
      "https://api.leadconnectorhq.com/widget/bookings/drive247-onboarding-call?email=owner%2B1%40acme.test",
    );
    expect(buildJourneyHtml("reminder", tenant)).toContain("email=owner%2B1%40acme.test");
  });

  it("escapes the company name", () => {
    expect(buildJourneyHtml("follow_up", tenant)).toContain("Acme &lt;Cars&gt;");
    expect(buildJourneyHtml("follow_up", tenant)).not.toContain("Acme <Cars>");
  });

  it("gives Bryan the customer's account and business details", () => {
    const html = buildBookingNoticeHtml({
      companyName: "Acme <Cars>", slug: "acme", bookerName: "Sam Lee", bookerEmail: "sam@acme.test", phone: "6155550100",
      startsAt: "2026-11-20T15:00:00Z", timezone: "America/Chicago", subscriptionStatus: "trialing",
      trialEnd: "2026-12-03T00:00:00Z", plan: "pro", signedUpAt: "2026-11-19T00:00:00Z", vehicleCount: 3, hasLogo: true, heardAbout: "Google",
    });
    for (const text of ["Acme &lt;Cars&gt;", "Sam Lee", "sam@acme.test", "6155550100", "9:00 AM", "CST", "trialing", "Google", "acme.portal.drive-247.com"]) {
      expect(html).toContain(text);
    }
  });

  it("tells Bryan the fleet size and whether the 20% offer was shown", () => {
    const base = {
      companyName: "Acme", slug: "acme", bookerName: "Sam", bookerEmail: "sam@acme.test",
      startsAt: "2026-11-20T15:00:00Z", signedUpAt: "2026-11-19T00:00:00Z", vehicleCount: 0, hasLogo: false,
    };
    const offered = buildBookingNoticeHtml({ ...base, fleetSize: "6-20", exitOfferSeenAt: "2026-11-19T10:00:00Z" });
    expect(offered).toContain("Fleet size");
    expect(offered).toContain("6–20 cars");
    expect(offered).toContain("Shown Nov 19, 2026");
    const plain = buildBookingNoticeHtml(base);
    expect(plain).toContain("Not answered");
    expect(plain).toContain("Not shown");
  });
});

describe("what a calendar event records", () => {
  const nowIso = "2026-11-19T12:00:00.000Z";

  it("records a booking with its time and clears an earlier cancellation", () => {
    expect(callEventValues("booked", null, "2026-11-20T15:00:00.000Z", nowIso)).toEqual({
      call_booked_at: nowIso, call_booked_via: "calendar", call_scheduled_for: "2026-11-20T15:00:00.000Z",
      call_cancelled_at: null, call_missed_at: null,
    });
  });

  it.each([["cancelled", "call_cancelled_at"], ["noshow", "call_missed_at"]] as const)(
    "%s keeps the history and lets the customer book again",
    (kind, column) => {
      const values = callEventValues(kind, { call_booked_at: nowIso }, null, nowIso);
      expect(values[column]).toBe(nowIso);
      expect(values.call_booked_at).toBeNull();
      expect(values.call_scheduled_for).toBeNull();
    },
  );

  it("records a completed call", () => {
    expect(callEventValues("showed", null, null, nowIso).call_completed_at).toBe(nowIso);
  });
});
