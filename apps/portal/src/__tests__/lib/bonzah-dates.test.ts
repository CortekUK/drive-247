import { describe, it, expect, vi, afterEach } from "vitest";
import { getBonzahToday, clampToBonzahStart, bonzahCanInsureThrough, bonzahRentalHasStarted } from "@/lib/bonzah-dates";

// Bonzah sells same-day cover, judged on the US Eastern clock (probed on live
// 2026-10-28). These pin that rule so the UI cannot drift back to "tomorrow".
describe("bonzah-dates", () => {
  afterEach(() => vi.useRealTimers());

  it("lets a same-day rental start cover today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T15:00:00Z")); // 11:00 ET, 08:00 PT
    expect(getBonzahToday()).toBe("2026-10-28");
    expect(clampToBonzahStart("2026-10-28")).toBe("2026-10-28");
    expect(clampToBonzahStart("2026-10-30")).toBe("2026-10-30");
    expect(bonzahCanInsureThrough("2026-10-29")).toBe(true);
  });

  it("cannot backdate: a past start moves up to today, and a window ending today has nothing left", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
    expect(clampToBonzahStart("2026-10-25")).toBe("2026-10-28");
    expect(bonzahCanInsureThrough("2026-10-28")).toBe(false);
  });

  it("uses Eastern, not Pacific: at 23:00 PT it is already tomorrow for Bonzah", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T06:00:00Z")); // 02:00 ET Oct 29, 23:00 PT Oct 28
    expect(getBonzahToday()).toBe("2026-10-29");
    expect(clampToBonzahStart("2026-10-28")).toBe("2026-10-29");
  });

  // Brandon Rockow (Bonzah), 2026-10-28: "Insurance can never be added after the
  // rental starts, but it can be added the same day as the rental starts."
  describe("bonzahRentalHasStarted", () => {
    it("allows the rental's start day and any later day, refuses once the start date has passed", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
      expect(bonzahRentalHasStarted("2026-10-28", "America/New_York")).toBe(false);
      expect(bonzahRentalHasStarted("2026-10-30", "America/New_York")).toBe(false);
      expect(bonzahRentalHasStarted("2026-10-27", "America/New_York")).toBe(true);
    });

    it("judges 'same day' on the tenant's calendar, not Bonzah's Eastern one", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-29T05:00:00Z")); // 22:00 PT Oct 28, 01:00 ET Oct 29
      expect(bonzahRentalHasStarted("2026-10-28", "America/Los_Angeles")).toBe(false);
      expect(bonzahRentalHasStarted("2026-10-28", "America/New_York")).toBe(true);
    });

    it("falls back to Eastern for a missing or invalid zone, and never blocks without a date", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-29T05:00:00Z"));
      expect(bonzahRentalHasStarted("2026-10-28", null)).toBe(true);
      expect(bonzahRentalHasStarted("2026-10-28", "Not/AZone")).toBe(true);
      expect(bonzahRentalHasStarted(null, "America/New_York")).toBe(false);
    });
  });
});
