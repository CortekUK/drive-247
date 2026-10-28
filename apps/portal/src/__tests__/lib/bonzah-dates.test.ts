import { describe, it, expect, vi, afterEach } from "vitest";
import { getBonzahToday, clampToBonzahStart, bonzahCanInsureThrough } from "@/lib/bonzah-dates";

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
});
