import { describe, it, expect } from "vitest";
import {
  resolveCoverageGap,
  describeCoverageGap,
  type CoverageGapPolicy,
} from "@/lib/bonzah-coverage-gap";

/**
 * Moore Luxe reported that extending a rental left the CDW behind. Checking
 * production showed it had already happened to three other operators without
 * anyone noticing: 13 rentals whose Bonzah cover stops before the rental does,
 * four still Active with the car out. The real cases below are taken verbatim
 * from those rows.
 *
 * The rule being protected: cover that stops short of the hire must be visible
 * BEFORE it lapses, because Bonzah's own terms forbid filling the gap afterwards.
 */

// Fixed clock so these never depend on the day they run.
const CLOCK = { today: "2026-06-15", tomorrow: "2026-06-16" };
const active = (end: string): CoverageGapPolicy => ({ status: "active", trip_end_date: end });

describe("resolveCoverageGap — real production cases", () => {
  it("flags GMT R-2ba774: 53 days of a live hire with no cover", () => {
    // rental 2026-05-07..2026-07-12, cover chunks ending 05-11, 05-15, 05-17, 05-20
    const gap = resolveCoverageGap(
      [active("2026-05-11"), active("2026-05-15"), active("2026-05-17"), active("2026-05-20")],
      { end_date: "2026-07-12", status: "Active" },
      CLOCK
    );
    expect(gap).not.toBeNull();
    expect(gap!.kind).toBe("lapsed");
    expect(gap!.severity).toBe("critical");
    expect(gap!.coverEndsOn).toBe("2026-05-20");
    expect(gap!.daysUninsured).toBe(53);
    // The decisive bit: this can never be repaired.
    expect(gap!.canStillBeMadeContinuous).toBe(false);
  });

  it("takes the LATEST policy end, not the first or the original", () => {
    // Cover is bought in consecutive chunks; the original always ends earliest.
    const gap = resolveCoverageGap(
      [active("2026-06-20"), active("2026-07-01"), active("2026-06-25")],
      { end_date: "2026-07-10", status: "Active" },
      CLOCK
    );
    expect(gap!.coverEndsOn).toBe("2026-07-01");
    expect(gap!.daysUninsured).toBe(9);
  });

  it("says nothing when cover reaches the end of the hire (R-2effd1)", () => {
    // rental 2026-05-14..05-21, cover 05-15..05-21 — complete cover.
    expect(
      resolveCoverageGap([active("2026-05-21")], { end_date: "2026-05-21", status: "Active" }, CLOCK)
    ).toBeNull();
  });

  it("says nothing when cover runs PAST the end of the hire", () => {
    expect(
      resolveCoverageGap([active("2026-08-01")], { end_date: "2026-07-20", status: "Active" }, CLOCK)
    ).toBeNull();
  });
});

describe("resolveCoverageGap — lapsed vs about to lapse", () => {
  it("is still repairable while cover has not yet run out", () => {
    const gap = resolveCoverageGap(
      [active("2026-06-20")],
      { end_date: "2026-06-30", status: "Active" },
      CLOCK
    );
    expect(gap!.kind).toBe("ending");
    expect(gap!.canStillBeMadeContinuous).toBe(true);
  });

  it("is critical once cover ends today or tomorrow — the last chance to act", () => {
    // Bonzah cannot start a policy before tomorrow, so cover ending tomorrow
    // leaves exactly one moment to buy a contiguous extension.
    for (const end of ["2026-06-15", "2026-06-16"]) {
      const gap = resolveCoverageGap([active(end)], { end_date: "2026-06-30", status: "Active" }, CLOCK);
      expect(gap!.kind).toBe("ending");
      expect(gap!.severity).toBe("critical");
    }
  });

  it("is a warning while there is still room", () => {
    const gap = resolveCoverageGap([active("2026-06-25")], { end_date: "2026-06-30", status: "Active" }, CLOCK);
    expect(gap!.severity).toBe("warning");
  });

  it("treats cover ending today as still covering today, not lapsed", () => {
    const gap = resolveCoverageGap([active(CLOCK.today)], { end_date: "2026-06-30", status: "Active" }, CLOCK);
    expect(gap!.kind).toBe("ending");
    expect(gap!.canStillBeMadeContinuous).toBe(true);
  });

  it("counts yesterday as already lapsed", () => {
    const gap = resolveCoverageGap([active("2026-06-14")], { end_date: "2026-06-30", status: "Active" }, CLOCK);
    expect(gap!.kind).toBe("lapsed");
    expect(gap!.canStillBeMadeContinuous).toBe(false);
  });
});

describe("resolveCoverageGap — what it deliberately stays quiet about", () => {
  it("says nothing for a rental with no Bonzah cover at all", () => {
    // Not the same statement as "cover stopped early". The operator may hold the
    // customer's own policy, and warning on every uninsured rental would train
    // the warning into invisibility.
    expect(resolveCoverageGap([], { end_date: "2026-06-30", status: "Active" }, CLOCK)).toBeNull();
    expect(resolveCoverageGap(null, { end_date: "2026-06-30", status: "Active" }, CLOCK)).toBeNull();
  });

  it("ignores policies that are not active", () => {
    for (const status of ["quoted", "cancelled", "failed", "insufficient_balance"]) {
      expect(
        resolveCoverageGap(
          [{ status, trip_end_date: "2026-05-01" }],
          { end_date: "2026-06-30", status: "Active" },
          CLOCK
        )
      ).toBeNull();
    }
  });

  it("says nothing for a rental that is not Active", () => {
    // A closed rental's gap is history nobody can act on; a pending one has not
    // started. Both would be noise.
    for (const status of ["Closed", "Pending", "Cancelled", "Rejected"]) {
      expect(
        resolveCoverageGap([active("2026-05-20")], { end_date: "2026-07-12", status }, CLOCK)
      ).toBeNull();
    }
  });

  it("says nothing for an open-ended PAYG rental", () => {
    expect(
      resolveCoverageGap([active("2026-05-20")], {
        end_date: "2026-07-12",
        status: "Active",
        is_pay_as_you_go: true,
      }, CLOCK)
    ).toBeNull();
  });

  it("survives missing and malformed data without throwing", () => {
    expect(resolveCoverageGap([active("2026-05-20")], null, CLOCK)).toBeNull();
    expect(resolveCoverageGap([active("2026-05-20")], { end_date: null, status: "Active" }, CLOCK)).toBeNull();
    expect(
      resolveCoverageGap(
        [{ status: "active", trip_end_date: "not-a-date" }],
        { end_date: "2026-06-30", status: "Active" },
        CLOCK
      )
    ).toBeNull();
    expect(
      resolveCoverageGap([{ status: null, trip_end_date: null }], { end_date: "2026-06-30", status: "Active" }, CLOCK)
    ).toBeNull();
  });

  it("accepts a full timestamp as well as a bare date", () => {
    const gap = resolveCoverageGap(
      [{ status: "active", trip_end_date: "2026-06-20T00:00:00+00:00" }],
      { end_date: "2026-06-30", status: "Active" },
      CLOCK
    );
    expect(gap!.coverEndsOn).toBe("2026-06-20");
  });
});

describe("describeCoverageGap", () => {
  it("tells a lapsed operator the days cannot be recovered", () => {
    const gap = resolveCoverageGap([active("2026-05-20")], { end_date: "2026-07-12", status: "Active" }, CLOCK)!;
    const text = describeCoverageGap(gap);
    expect(text).toContain("53 days");
    expect(text).toContain("cannot backfill");
    // It must NOT invite them to buy cover for days already run.
    expect(text).not.toMatch(/buy the extension/i);
  });

  it("tells an operator who still has time exactly when to act", () => {
    const gap = resolveCoverageGap([active("2026-06-25")], { end_date: "2026-06-30", status: "Active" }, CLOCK)!;
    const text = describeCoverageGap(gap);
    expect(text).toContain("2026-06-25");
    expect(text).toMatch(/buy the extension/i);
    expect(text).toMatch(/cannot be reinstated once it lapses/i);
  });

  it("uses singular for a one-day gap", () => {
    const gap = resolveCoverageGap([active("2026-06-20")], { end_date: "2026-06-21", status: "Active" }, CLOCK)!;
    expect(describeCoverageGap(gap)).toContain("1 day ");
  });
});
