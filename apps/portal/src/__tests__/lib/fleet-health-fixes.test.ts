/**
 * Regression tests for the Fleet Health defects found during the August audit.
 *
 * Each block below pins ONE defect that reached production. They are written
 * against the shipping source rather than a restatement of it, so the test
 * fails if the fix is edited away — which is the only thing that makes a
 * regression test worth having.
 *
 * The defects, and what made each one survive review:
 *
 *   F1  `force` bypassed the active-rental guard. The client sent one
 *       acknowledgement for a list that mixed Active and Pending rentals, and
 *       the RPC guard read `IF v_active > 0 AND NOT p_force`. Ticking a box
 *       about a FUTURE booking therefore took a car off the road while a
 *       customer was driving it.
 *
 *   F5  Odometer readings were written with no `unit`, so the column default
 *       'mi' applied to every reading including kilometre ones, and the
 *       maintenance-rule editor labelled `interval_miles` "km".
 *
 *   F6  A negative handover mileage passed a null-only guard into columns that
 *       carry CHECK (>= 0), aborting the whole key handover with a raw 23514.
 */

import { describe, it, expect } from "vitest";
import { readPortalSource, liftDeclaration, compile, codeOnly } from "../helpers/edge-source";
import {
  KM_PER_MILE,
  STORED_UNIT,
  toStoredMiles,
  fromStoredMiles,
  readingToMiles,
} from "@/lib/fleet-health-units";

const scheduleDialog = readPortalSource("components/fleet-health/schedule-maintenance-dialog.tsx");
const odometerHook = readPortalSource("hooks/use-vehicle-odometer.ts");
const handoverSection = readPortalSource("components/rentals/key-handover-section.tsx");
const handoverHook = readPortalSource("hooks/use-key-handover.ts");
const rulesEditor = readPortalSource("components/fleet-health/maintenance-rules-editor.tsx");

// ---------------------------------------------------------------------------
// F1 — an Active rental is never overridable
// ---------------------------------------------------------------------------

const isBlockingStatus = compile<(s: string | null | undefined) => boolean>(
  [liftDeclaration(scheduleDialog, "isBlockingStatus", { tsx: true })],
  "isBlockingStatus",
);

describe("F1 — an in-progress rental cannot be acknowledged away", () => {
  it("treats Active as blocking", () => {
    expect(isBlockingStatus("Active")).toBe(true);
  });

  it("does NOT treat a future booking as blocking — those stay overridable", () => {
    expect(isBlockingStatus("Pending")).toBe(false);
  });

  it("matches case-insensitively, so a lowercase status cannot slip through", () => {
    for (const v of ["active", "ACTIVE", "AcTiVe"]) {
      expect(isBlockingStatus(v)).toBe(true);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(isBlockingStatus("  Active  ")).toBe(true);
  });

  it("treats null, undefined and empty as non-blocking rather than throwing", () => {
    expect(isBlockingStatus(null)).toBe(false);
    expect(isBlockingStatus(undefined)).toBe(false);
    expect(isBlockingStatus("")).toBe(false);
  });

  it("does not classify an unrelated status as blocking", () => {
    for (const v of ["Completed", "Cancelled", "Draft", "Confirmed"]) {
      expect(isBlockingStatus(v)).toBe(false);
    }
  });

  it("only ever sends force for OVERRIDABLE conflicts, and never alongside a blocking one", () => {
    const code = codeOnly(scheduleDialog);
    // The exact expression matters: `hasConflicts && acknowledged` is the bug.
    expect(code).toContain("force: hasOverridable && acknowledged && !hasBlocking");
    expect(code).not.toContain("force: hasConflicts && acknowledged");
  });

  it("splits the conflict list rather than presenting one undifferentiated set", () => {
    const code = codeOnly(scheduleDialog);
    expect(code).toContain("blockingConflicts");
    expect(code).toContain("overridableConflicts");
  });

  it("blocks submission outright while a blocking conflict is present", () => {
    const code = codeOnly(scheduleDialog);
    expect(code).toMatch(/submitBlocked\s*=[\s\S]{0,200}hasBlocking/);
  });

  it("renders blocking conflicts through a panel that has no acknowledgement control", () => {
    const panel = liftDeclaration(scheduleDialog, "BlockingConflictPanel", { tsx: true });
    expect(panel).not.toContain("Checkbox");
    expect(panel).not.toContain("onAcknowledgedChange");
  });
});

// ---------------------------------------------------------------------------
// F5 — units
// ---------------------------------------------------------------------------

describe("F5 — a reading means the same thing whoever typed it", () => {
  it("stores miles, explicitly, rather than relying on the column default", () => {
    expect(STORED_UNIT).toBe("mi");
    expect(codeOnly(odometerHook)).toContain("unit: STORED_UNIT");
  });

  it("converts a kilometre reading into miles before storing it", () => {
    // 10,000 km is ~6,214 miles. Storing 10,000 would overstate the odometer
    // by 61% and fire every mileage rule early.
    expect(toStoredMiles(10_000, "km")).toBe(6214);
    expect(toStoredMiles(10_000, "miles")).toBe(10_000);
  });

  it("round-trips a kilometre value back to what the operator typed", () => {
    for (const v of [1, 500, 10_000, 123_456]) {
      expect(fromStoredMiles(toStoredMiles(v, "km"), "km")).toBeCloseTo(v, -1);
    }
  });

  it("round-trips a mile value exactly — the common case must be lossless", () => {
    for (const v of [0, 1, 99_999, 250_000]) {
      expect(fromStoredMiles(toStoredMiles(v, "miles"), "miles")).toBe(v);
    }
  });

  it("keeps a literal 0 as 0 in both directions", () => {
    expect(toStoredMiles(0, "km")).toBe(0);
    expect(toStoredMiles(0, "miles")).toBe(0);
    expect(fromStoredMiles(0, "km")).toBe(0);
    expect(fromStoredMiles(0, "miles")).toBe(0);
  });

  it("passes null and undefined through instead of turning them into 0", () => {
    // "never measured" and "measured as zero" are different facts.
    expect(fromStoredMiles(null, "km")).toBeNull();
    expect(fromStoredMiles(undefined, "km")).toBeUndefined();
  });

  it("leaves a non-finite value alone rather than inventing a number", () => {
    expect(Number.isNaN(toStoredMiles(NaN, "km"))).toBe(true);
    expect(fromStoredMiles(Infinity, "km")).toBe(Infinity);
  });

  it("reads a legacy row back correctly whichever unit it recorded", () => {
    expect(readingToMiles(6214, "mi")).toBe(6214);
    expect(readingToMiles(6214, null)).toBe(6214); // pre-fix rows
    expect(readingToMiles(10_000, "km")).toBe(6214);
  });

  it("uses the exact international mile, not an approximation", () => {
    expect(KM_PER_MILE).toBe(1.609344);
  });

  it("converts maintenance-rule intervals at both edges of the form", () => {
    const code = codeOnly(rulesEditor);
    expect(code).toContain("toStoredMiles(values.interval_miles, unit)");
    expect(code).toContain("fromStoredMiles(rule?.interval_miles, unit)");
  });
});

// ---------------------------------------------------------------------------
// F6 — negative mileage
// ---------------------------------------------------------------------------

describe("F6 — a negative reading never reaches a CHECK-constrained column", () => {
  it("guards the mutation with >= 0, not merely a null check", () => {
    const code = codeOnly(handoverHook);
    expect(code).toContain("mileage !== null && mileage !== undefined && mileage >= 0");
  });

  it("still admits a literal 0 — a brand-new vehicle reads zero", () => {
    const code = codeOnly(handoverHook);
    // A `> 0` guard would drop it; the fix must be `>= 0`.
    expect(code).not.toContain("mileage > 0");
  });

  it("rejects negatives on both auto-save paths in the handover UI", () => {
    const code = codeOnly(handoverSection);
    const guards = code.match(/!isNaN\(mileageVal\) && mileageVal >= 0/g) ?? [];
    expect(guards).toHaveLength(2);
  });

  it("nulls a negative on both blur handlers instead of sending it", () => {
    const code = codeOnly(handoverSection);
    const guards = code.match(/parsed < 0 \? null : parsed/g) ?? [];
    expect(guards).toHaveLength(2);
  });

  it("keeps the floor on the number inputs", () => {
    expect((codeOnly(handoverSection).match(/min=\{0\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
