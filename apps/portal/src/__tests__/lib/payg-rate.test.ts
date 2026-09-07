import { describe, it, expect } from "vitest";
import { computePaygDailyRate } from "@/lib/payg-rate";

describe("computePaygDailyRate", () => {
  it("divides weekly amount by 7", () => {
    expect(computePaygDailyRate(140, "Weekly")).toBe(20);
  });

  it("divides monthly amount by 30", () => {
    expect(computePaygDailyRate(600, "Monthly")).toBe(20);
  });

  it("returns the amount as-is for legacy Daily period", () => {
    expect(computePaygDailyRate(45, "Daily")).toBe(45);
  });

  it("returns 0 for null/undefined amount", () => {
    expect(computePaygDailyRate(null, "Weekly")).toBe(0);
    expect(computePaygDailyRate(undefined, "Monthly")).toBe(0);
  });

  it("returns 0 for zero or negative amount", () => {
    expect(computePaygDailyRate(0, "Weekly")).toBe(0);
    expect(computePaygDailyRate(-100, "Monthly")).toBe(0);
  });

  it("falls back to monthly_amount when period type is unknown", () => {
    expect(computePaygDailyRate(50, "Quarterly" as any)).toBe(50);
    expect(computePaygDailyRate(50, null)).toBe(50);
  });

  it("handles decimal weekly rates", () => {
    expect(computePaygDailyRate(70.7, "Weekly")).toBeCloseTo(10.1, 5);
  });

  it("matches the cron's formula exactly (regression: $140/wk must = $20/day, not $140/day)", () => {
    // This was the visible symptom Kris reported on May 8 — entering a weekly
    // rate but having it displayed as a daily rate. Lock in the expectation.
    expect(computePaygDailyRate(140, "Weekly")).not.toBe(140);
    expect(computePaygDailyRate(140, "Weekly")).toBe(20);
  });
});
