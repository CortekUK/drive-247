/** Sheet P4 (Promo codes): the rules the v2 booking site checks before honouring a code. */
import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  durationTierCovers,
  isPromoExpiredOn,
  isPromoOff,
  isPromoUsedUp,
  todayIsoIn,
} from "../../northwind-site/components/booking/promo-rules";

describe("expiry (P4.8)", () => {
  it("a code works through its whole expiry day on the operator's clock", () => {
    expect(isPromoExpiredOn("2026-11-11", "2026-11-11")).toBe(false);
    expect(isPromoExpiredOn("2026-11-10", "2026-11-11")).toBe(true);
    expect(isPromoExpiredOn(null, "2026-11-11")).toBe(false);
  });
  it("today is read in the tenant's time zone, not UTC", () => {
    // 01:00 UTC on 12 Nov is still 11 Nov in New York.
    expect(todayIsoIn("America/New_York", new Date("2026-11-12T01:00:00Z"))).toBe("2026-11-11");
    expect(todayIsoIn("Europe/London", new Date("2026-11-12T01:00:00Z"))).toBe("2026-11-12");
  });
});

describe("off and used up (P4.9, P4.15)", () => {
  it("only an explicit false turns a code off", () => {
    expect(isPromoOff({ is_active: false })).toBe(true);
    expect(isPromoOff({ is_active: true })).toBe(false);
    expect(isPromoOff({ is_active: null })).toBe(false);
  });
  it("a code is used up at its limit; no limit or an unknown count never blocks", () => {
    expect(isPromoUsedUp({ max_users: 1 }, 1)).toBe(true);
    expect(isPromoUsedUp({ max_users: 1 }, 0)).toBe(false);
    expect(isPromoUsedUp({ max_users: 0 }, 5)).toBe(false);
    expect(isPromoUsedUp({ max_users: 5 }, null)).toBe(false);
  });
});

describe("long-rental tiers (P4.12, P4.13)", () => {
  const tier = { code: "WEEK", expires_at: null, max_users: null, min_duration_days: 7, max_duration_days: null };
  it("7 days or more, not 6", () => {
    expect(durationTierCovers(tier, 6)).toBe(false);
    expect(durationTierCovers(tier, 7)).toBe(true);
    expect(durationTierCovers(tier, 30)).toBe(true);
  });
  it("a ceiling stops longer rentals; a manual code (no minimum) is never a tier", () => {
    expect(durationTierCovers({ ...tier, max_duration_days: 7 }, 8)).toBe(false);
    expect(durationTierCovers({ ...tier, min_duration_days: null }, 30)).toBe(false);
  });
  it("counts calendar days between the two dates", () => {
    expect(calendarDaysBetween("2026-12-07", "2026-12-14")).toBe(7);
    expect(calendarDaysBetween("2026-12-07", "2026-12-13")).toBe(6);
    expect(calendarDaysBetween("", "2026-12-13")).toBe(0);
  });
});
