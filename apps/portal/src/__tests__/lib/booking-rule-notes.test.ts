import { describe, expect, it } from "vitest";
import { bookingRuleNotes, describeHourSpan, minimumRentalHours } from "@/lib/booking-rule-notes";

// Northwind's rules during QA B4: 24 h notice, 1 day 2 hours shortest, 14 days longest.
const rules = {
  booking_lead_time_hours: 24,
  booking_lead_time_unit: "hours" as const,
  min_rental_days: 1,
  min_rental_hours: 2,
  max_rental_days: 14,
};
const now = "2026-11-10T14:30";
const texts = (notes: ReturnType<typeof bookingRuleNotes>) => notes.map((n) => n.text);

describe("bookingRuleNotes", () => {
  it("says nothing about a trip that keeps every rule", () => {
    expect(bookingRuleNotes({ pickupAt: "2026-11-12T10:00", returnAt: "2026-11-14T10:00", now, settings: rules })).toEqual([]);
  });

  it("notes a pickup inside the advance notice", () => {
    expect(texts(bookingRuleNotes({ pickupAt: "2026-11-10T16:00", returnAt: "2026-11-13T16:00", now, settings: rules }))).toEqual([
      "Pickup is inside the 24-hour booking notice.",
    ]);
  });

  it("lets a pickup exactly at the notice through", () => {
    expect(bookingRuleNotes({ pickupAt: "2026-11-11T14:30", returnAt: "2026-11-13T14:30", now, settings: rules })).toEqual([]);
  });

  it("words a notice set in days as days", () => {
    const daily = { ...rules, booking_lead_time_hours: 48, booking_lead_time_unit: "days" as const };
    expect(texts(bookingRuleNotes({ pickupAt: "2026-11-11T10:00", returnAt: "2026-11-14T10:00", now, settings: daily }))).toEqual([
      "Pickup is inside the 2-day booking notice.",
    ]);
  });

  it("judges the shortest rental in hours, like the booking site", () => {
    // 24 h is under 1 day 2 hours; 26 h is exactly it.
    expect(texts(bookingRuleNotes({ pickupAt: "2026-11-12T10:00", returnAt: "2026-11-13T10:00", now, settings: rules }))).toEqual([
      "Shorter than the shortest rental, 1 day 2 hours.",
    ]);
    expect(bookingRuleNotes({ pickupAt: "2026-11-12T10:00", returnAt: "2026-11-13T12:00", now, settings: rules })).toEqual([]);
  });

  it("notes a trip longer than the longest rental, by calendar days", () => {
    expect(texts(bookingRuleNotes({ pickupAt: "2026-11-12T10:00", returnAt: "2026-11-27T10:00", now, settings: rules }))).toEqual([
      "Longer than the longest rental, 14 days.",
    ]);
    expect(bookingRuleNotes({ pickupAt: "2026-11-12T10:00", returnAt: "2026-11-26T10:00", now, settings: rules })).toEqual([]);
  });

  it("can break two rules at once and lists both", () => {
    expect(bookingRuleNotes({ pickupAt: "2026-11-10T16:00", returnAt: "2026-11-11T16:00", now, settings: rules }).map((n) => n.rule)).toEqual([
      "notice",
      "minimum",
    ]);
  });

  it("judges only the notice while the return is still unset", () => {
    expect(bookingRuleNotes({ pickupAt: "2026-11-10T16:00", returnAt: "", now, settings: rules }).map((n) => n.rule)).toEqual(["notice"]);
    expect(bookingRuleNotes({ pickupAt: "2026-11-20T16:00", returnAt: "", now, settings: rules })).toEqual([]);
  });

  it("keeps quiet about a return that is not after the pickup (the stage refuses that itself)", () => {
    expect(bookingRuleNotes({ pickupAt: "2026-11-12T10:00", returnAt: "2026-11-12T09:00", now, settings: rules })).toEqual([]);
  });

  it("falls back to the booking site's defaults when the tenant has not set rules", () => {
    expect(minimumRentalHours(null)).toBe(1);
    expect(texts(bookingRuleNotes({ pickupAt: "2026-11-10T16:00", returnAt: "2026-11-10T17:00", now, settings: null }))).toEqual([
      "Pickup is inside the 24-hour booking notice.",
    ]);
    expect(texts(bookingRuleNotes({ pickupAt: "2026-12-01T10:00", returnAt: "2027-03-15T10:00", now, settings: null }))).toEqual([
      "Longer than the longest rental, 90 days.",
    ]);
  });

  it("describes hour spans the way the site does", () => {
    expect(describeHourSpan(26)).toBe("1 day 2 hours");
    expect(describeHourSpan(48)).toBe("2 days");
    expect(describeHourSpan(3)).toBe("3 hours");
    expect(describeHourSpan(1)).toBe("1 hour");
    expect(minimumRentalHours(rules)).toBe(26);
  });
});
