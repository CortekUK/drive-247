import { describe, expect, it } from "vitest";
import * as emailTime from "../../../../supabase/functions/_shared/onboarding-call-time";
import * as portalTime from "../../../../apps/portal/src/lib/onboarding-call-time";
import { buildCallIcs, companyZone } from "../../../../supabase/functions/_shared/onboarding-call-emails";

// Spec 03's worked examples, worked by hand from each zone's UTC offset.
// Both formatters (the portal's and the emails') must give the same words.
const formatters = [
  ["portal", portalTime],
  ["email", emailTime],
] as const;

// Bryan's 9:00 AM New York, Tue 8 Dec 2026 = 14:00 UTC.
const NINE_AM = "2026-12-08T14:00:00Z";
// Bryan's 4:30 PM New York, Mon 7 Dec 2026 = 21:30 UTC.
const FOUR_THIRTY = "2026-12-07T21:30:00Z";

describe("03 time zones", () => {
  for (const [who, f] of formatters) {
    it.each([
      [1, "America/Los_Angeles", "Tuesday, 8 December at 6:00 AM, Los Angeles time"],
      [2, "Pacific/Honolulu", "Tuesday, 8 December at 4:00 AM, Honolulu time"],
      [3, "Europe/London", "Tuesday, 8 December at 2:00 PM, London time"],
      [4, "Asia/Dubai", "Tuesday, 8 December at 6:00 PM, Dubai time"],
      [5, "Asia/Karachi", "Tuesday, 8 December at 7:00 PM, Karachi time"],
      [6, "Australia/Sydney", "Wednesday, 9 December at 1:00 AM, Sydney time"],
    ])(`03.9 #%i ${who}: Bryan's 9:00 AM in %s is %s`, (_n, tz, expected) => {
      expect(f.formatCallFull(NINE_AM, tz)).toBe(expected);
    });

    it.each([
      [1, "Asia/Karachi", "Tuesday, 8 December at 2:30 AM, Karachi time"],
      [2, "Australia/Sydney", "Tuesday, 8 December at 8:30 AM, Sydney time"],
    ])(`03.9 #%i ${who}: Bryan's Monday 4:30 PM in %s is the next day, %s`, (_n, tz, expected) => {
      expect(f.formatCallFull(FOUR_THIRTY, tz)).toBe(expected);
    });

    it.each([
      [1, "2027-03-10T14:00:00Z", "Europe/London", "2:00 PM"],
      [2, "2027-03-10T14:00:00Z", "Asia/Karachi", "7:00 PM"],
      [3, "2027-03-17T13:00:00Z", "Europe/London", "1:00 PM"],
      [4, "2027-03-17T13:00:00Z", "Asia/Karachi", "6:00 PM"],
      [5, "2027-03-31T13:00:00Z", "Europe/London", "2:00 PM"],
      [6, "2027-03-31T13:00:00Z", "Asia/Karachi", "6:00 PM"],
      [7, "2027-11-10T14:00:00Z", "Europe/London", "2:00 PM"],
      [8, "2027-11-10T14:00:00Z", "Asia/Karachi", "7:00 PM"],
      // Bryan's own 9:00 AM stays 9:00 AM on both sides of his clock change.
      [9, "2027-03-10T14:00:00Z", "America/New_York", "9:00 AM"],
      [10, "2027-03-17T13:00:00Z", "America/New_York", "9:00 AM"],
    ])(`03.10 #%i ${who}: %s in %s reads %s`, (_n, at, tz, expected) => {
      expect(f.formatSlotTime(at, tz)).toBe(expected);
    });

    it.each([
      [1, "Asia/Karachi", "Karachi time"],
      [2, "America/Los_Angeles", "Los Angeles time"],
      [3, "UTC", "UTC"],
      [4, "Not/AZone", "Not/AZone"],
    ])(`03.6 #%i ${who}: %s is named %s`, (_n, tz, expected) => {
      expect(f.zoneLabel(tz)).toBe(expected);
    });

    it(`03.7 #1 ${who}: the short form names the zone`, () => {
      expect(f.formatCallShort(NINE_AM, "Asia/Karachi")).toBe("Tue 8 Dec, 7:00 PM Karachi time");
    });

    it(`03.7 #2 ${who}: the full form names the zone`, () => {
      expect(f.formatCallFull("2027-03-10T14:00:00Z", "Asia/Karachi")).toBe("Wednesday, 10 March at 7:00 PM, Karachi time");
    });

    it(`03.9 #3 ${who}: the day a time falls on is the person's own day`, () => {
      expect(f.dayKey(FOUR_THIRTY, "America/New_York")).toBe("2026-12-07");
      expect(f.dayKey(FOUR_THIRTY, "Asia/Karachi")).toBe("2026-12-08");
    });
  }

  it("03.5 #1 a company's emails use the zone saved with the booking", () => {
    expect(companyZone({ customer_timezone: "Asia/Karachi", host_timezone: "America/New_York" } as never)).toBe("Asia/Karachi");
  });

  it("03.5 #2 a booking with no saved zone is written in Bryan's zone", () => {
    expect(companyZone({ customer_timezone: null, host_timezone: "America/New_York" } as never)).toBe("America/New_York");
  });

  it("03.12 #1 the invite carries the call in UTC", () => {
    const ics = buildCallIcs(
      {
        booking_id: "b1", sequence: 0, ics_token: "t", name: "A", email: "a@example.com",
        starts_at: NINE_AM, ends_at: "2026-12-08T14:30:00Z", company_name: "Co", slug: "co",
        host_name: "Bryan Diaz", host_timezone: "America/New_York", customer_timezone: "Asia/Karachi",
      },
      "REQUEST",
      false,
    );
    expect(ics).toContain("DTSTART:20261208T140000Z");
    expect(ics).toContain("DTEND:20261208T143000Z");
  });
});
