import { describe, expect, it } from "vitest";
import { blockDraftProblem, dayCount } from "@/components/vehicles-v2/tab-availability";

/* Availability checklist 7.12–7.15. Today is fixed so the "past" rule is stable. */
const TODAY = "2026-11-06";
const existing = [{ start_date: "2026-11-20", end_date: "2026-11-24", reason: "Workshop" }];
const draft = (from: string, to: string, reason = "Service") => ({ from, to, reason });

describe("blockDraftProblem", () => {
  it("allows a normal future range", () => {
    expect(blockDraftProblem(draft("2026-12-01", "2026-12-03"), existing, TODAY)).toBeNull();
  });

  it("allows a single day (7.12)", () => {
    expect(blockDraftProblem(draft("2026-12-01", "2026-12-01"), existing, TODAY)).toBeNull();
  });

  it("allows a range that started earlier but runs through today (7.11)", () => {
    expect(blockDraftProblem(draft("2026-11-04", "2026-11-06"), existing, TODAY)).toBeNull();
  });

  it("refuses an end before the start (7.13)", () => {
    expect(blockDraftProblem(draft("2026-12-10", "2026-12-05"), existing, TODAY)).toMatch(/end date is before the start/);
  });

  it("refuses a range that has already ended (7.14)", () => {
    expect(blockDraftProblem(draft("2026-10-01", "2026-10-03"), existing, TODAY)).toMatch(/already in the past/);
  });

  it("refuses a range overlapping an existing block, naming it (7.14)", () => {
    const msg = blockDraftProblem(draft("2026-11-22", "2026-11-26"), existing, TODAY);
    expect(msg).toMatch(/overlap/);
    expect(msg).toContain("Workshop");
  });

  it("treats touching-but-not-overlapping ranges as fine", () => {
    expect(blockDraftProblem(draft("2026-11-25", "2026-11-27"), existing, TODAY)).toBeNull();
    expect(blockDraftProblem(draft("2026-11-18", "2026-11-19"), existing, TODAY)).toBeNull();
  });

  it("says nothing while a date is still missing (7.15 keeps Add off on its own)", () => {
    expect(blockDraftProblem(draft("", "2026-12-05"), existing, TODAY)).toBeNull();
    expect(blockDraftProblem(draft("2026-12-05", ""), existing, TODAY)).toBeNull();
  });
});

describe("dayCount", () => {
  it("is singular for one day", () => {
    expect(dayCount(1)).toBe("1 day");
    expect(dayCount(5)).toBe("5 days");
  });
});
