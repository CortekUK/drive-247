/**
 * Golden table — docs/PAYMENT_PLANS_DESIGN.md §3.1, L1–L7, as LITERALS
 * (re-derived with Python zoneinfo, and independently by Postgres' own tzdata
 * in the PGlite suite — pp_due_at). Plus charge_time_invalid.
 */
import { describe, expect, it } from "vitest";
import { dueAtUtc, localDateInZone, validateChargeTime } from "@fn/_shared/payment-plans/dates.ts";
import { PlanRuleError } from "@fn/_shared/payment-plans/schedule.ts";

describe("§3.1 L — local date / instant", () => {
  it("L1 — 2026-09-25T03:30:00Z in America/Los_Angeles is 2026-09-24", () => {
    expect(localDateInZone("2026-09-25T03:30:00Z", "America/Los_Angeles")).toBe("2026-09-24");
  });
  it("L2 — 2026-09-24T21:00:00Z in Asia/Dubai is 2026-09-25", () => {
    expect(localDateInZone("2026-09-24T21:00:00Z", "Asia/Dubai")).toBe("2026-09-25");
  });
  it("L3 — 2026-11-02 10:00 America/New_York → 2026-11-02T15:00:00.000Z (EST)", () => {
    expect(dueAtUtc("2026-11-02", "10:00", "America/New_York")).toBe("2026-11-02T15:00:00.000Z");
  });
  it("L4 — 2026-10-30 10:00 America/New_York → 2026-10-30T14:00:00.000Z (EDT)", () => {
    expect(dueAtUtc("2026-10-30", "10:00", "America/New_York")).toBe("2026-10-30T14:00:00.000Z");
  });
  it("L5 — 2026-03-09 10:00 America/Los_Angeles → 2026-03-09T17:00:00.000Z (PDT)", () => {
    expect(dueAtUtc("2026-03-09", "10:00", "America/Los_Angeles")).toBe("2026-03-09T17:00:00.000Z");
  });
  it("L6 — 2026-09-30 10:00 Asia/Dubai → 2026-09-30T06:00:00.000Z", () => {
    expect(dueAtUtc("2026-09-30", "10:00", "Asia/Dubai")).toBe("2026-09-30T06:00:00.000Z");
  });
  it("L7 — 2026-10-02 10:00 America/Chicago → 2026-10-02T15:00:00.000Z", () => {
    expect(dueAtUtc("2026-10-02", "10:00", "America/Chicago")).toBe("2026-10-02T15:00:00.000Z");
  });
});

describe("§3 charge_time_invalid — 00:00–03:59 is refused (DST gaps)", () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(PlanRuleError);
      return (e as PlanRuleError).code;
    }
    return "(no error)";
  };
  it.each(["00:00", "02:30", "03:59"])("%s → charge_time_invalid", (t) => {
    expect(code(() => validateChargeTime(t))).toBe("charge_time_invalid");
    expect(code(() => dueAtUtc("2026-03-08", t, "America/New_York"))).toBe("charge_time_invalid");
  });
  it.each(["04:00", "10:00", "23:59"])("%s is accepted", (t) => {
    expect(code(() => validateChargeTime(t))).toBe("(no error)");
  });
});
