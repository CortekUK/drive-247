import { describe, expect, it } from "vitest";
import { chargeFor, formatCents } from "../../../../supabase/functions/_shared/verification/pricing";

// Spec 09 · Prices and charges. Every row of the Worked examples table, worked by hand in the spec.
// RentID 299 cents per check (assumption A1), margin 50 per premium check.

const LICENCE = { kind: "premium" as const, provider_cost_cents: 299, margin_cents: 50 };
const DRIVING = { kind: "premium" as const, provider_cost_cents: 299, margin_cents: 50 };
const CRIMINAL = { kind: "premium" as const, provider_cost_cents: 299, margin_cents: 50 };
const STANDARD = { kind: "free" as const, provider_cost_cents: 33, margin_cents: 0 };

const total = (charges: Array<{ total_cents: number }>) => charges.reduce((sum, c) => sum + c.total_cents, 0);

describe("09 prices and charges", () => {
  it.each([
    // [row, finished checks with their state fee, expected cents]
    [1, [] as Array<[typeof LICENCE, number]>, 0],
    [2, [[LICENCE, 0]], 349],
    [3, [[DRIVING, 800]], 1149],
    [4, [[DRIVING, 0]], 349],
    [5, [[LICENCE, 0], [DRIVING, 800]], 1498],
    [6, [[LICENCE, 500], [DRIVING, 800], [CRIMINAL, 0]], 2347],
    [7, [], 0], // link never opened: nothing finished
    [8, [], 0], // standard check failed: premium never ran
    [9, [[LICENCE, 0]], 349], // suspended is still a finished check
    [10, [], 0], // state not covered: not finished
    [11, [[LICENCE, 0], [LICENCE, 0]], 698],
    [12, [...Array(7).fill([LICENCE, 0]), ...Array(2).fill([DRIVING, 800])], 4741],
    [13, [[LICENCE, 2500]], 2849],
    [14, [], 0], // consent refused: not run
  ] as Array<[number, Array<[typeof LICENCE, number]>, number]>)(
    "09.3 #%i the company pays the expected cents",
    (_row, finished, expected) => {
      const charges = finished.map(([row, fee]) => chargeFor(row, fee));
      expect(total(charges)).toBe(expected);
      for (const c of charges) expect(Number.isInteger(c.total_cents)).toBe(true);
    },
  );

  it("09.5 #15 a price frozen at 299 is charged at 349 even after the list changes", () => {
    const frozen = { ...LICENCE }; // copied from the session row, not re-read
    const listNow = { ...LICENCE, provider_cost_cents: 349 };
    expect(chargeFor(frozen, 0).total_cents).toBe(349);
    expect(chargeFor(listNow, 0).total_cents).toBe(399);
  });

  it("09.2 the standard check is free, whatever its cost to Drive247", () => {
    expect(chargeFor(STANDARD, 0)).toEqual({ provider_cost_cents: 0, state_fee_cents: 0, margin_cents: 0, total_cents: 0 });
    expect(chargeFor(STANDARD, 800).total_cents).toBe(0);
  });

  it("09.4 the margin is 50 cents per premium check, not per session", () => {
    const two = [chargeFor(LICENCE, 0), chargeFor(DRIVING, 0)];
    expect(two.reduce((s, c) => s + c.margin_cents, 0)).toBe(100);
  });

  it("09.3 the total is the plain sum of the three parts", () => {
    const c = chargeFor(LICENCE, 800);
    expect(c.total_cents).toBe(c.provider_cost_cents + c.state_fee_cents + c.margin_cents);
    expect(c).toEqual({ provider_cost_cents: 299, state_fee_cents: 800, margin_cents: 50, total_cents: 1149 });
  });

  it("09.1 money is whole cents: fractions and negatives are refused", () => {
    expect(() => chargeFor(LICENCE, 0.5)).toThrow();
    expect(() => chargeFor({ ...LICENCE, provider_cost_cents: 299.5 }, 0)).toThrow();
    expect(() => chargeFor(LICENCE, -1)).toThrow();
    expect(chargeFor({ ...LICENCE, provider_cost_cents: 0, margin_cents: 0 }, 0).total_cents).toBe(0);
    expect(chargeFor({ ...LICENCE, provider_cost_cents: 0, margin_cents: 1 }, 0).total_cents).toBe(1);
  });

  it("09.1 cents are shown as dollars to two places", () => {
    expect(formatCents(349)).toBe("$3.49");
    expect(formatCents(4741)).toBe("$47.41");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456)).toBe("$1,234.56");
  });
});
