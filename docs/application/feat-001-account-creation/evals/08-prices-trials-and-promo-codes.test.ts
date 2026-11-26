// Proves spec 08's math: every row of its Worked examples table, to the cent.
// The math lives in one place: supabase/functions/_shared/platform-promo-rules.ts.
//   promoBillCents(priceCents, type, value)          -> one discounted bill, whole cents
//   discountedBillDates(signupISO, trialDays, months) -> the dates of the bills that get the discount
import { describe, expect, it } from "vitest";
import * as rules from "../../../../supabase/functions/_shared/platform-promo-rules";

const need = (name: string) => {
  const f = (rules as Record<string, unknown>)[name];
  if (typeof f !== "function") throw new Error(`${name} is not in platform-promo-rules.ts yet`);
  return f as (...a: unknown[]) => any;
};
const bill = (cents: number, pct: number) => need("promoBillCents")(cents, "percent", pct);

describe("08 prices, trials and promo codes", () => {
  // Rows 1-4, 6-8, 10: one bill, worked by hand in the spec.
  it.each([
    [1, 12900, 0, 12900],
    [2, 12900, 30, 9030],
    [3, 22900, 30, 16030],
    [4, 34900, 30, 24430],
    [6, 9999, 30, 6999],
    [7, 5, 30, 4],
    [8, 12900, 100, 0],
    [10, 34900, 30, 24430],
  ])("08.6 #%i %i cents at %i percent off is %i cents", (_row, cents, pct, expected) => {
    const got = bill(cents, pct);
    expect(got).toBe(expected);
    expect(Number.isInteger(got)).toBe(true);
  });

  it("08.6 #edges 0 cents, 1 cent, the largest plan x 12", () => {
    expect(bill(0, 30)).toBe(0);
    expect(bill(1, 30)).toBe(1); // 0.7 rounds half up to 1
    expect(bill(418800, 30)).toBe(293160);
  });

  it("08.1 #1 every amount is whole cents", () => {
    for (const c of [1, 5, 99, 9999, 12900, 22900, 34900]) expect(Number.isInteger(bill(c, 30))).toBe(true);
  });

  // Row 5: Growth, 14-day trial, signup 26 Nov 2026.
  it("08.5 #5 14-day trial: exactly 3 paid bills are discounted, from 10 Dec", () => {
    expect(need("discountedBillDates")("2026-11-26", 14, 3)).toEqual(["2026-12-10", "2027-01-10", "2027-02-10"]);
  });

  // Row 9: 30-day trial, signup 26 Nov 2026.
  it("08.13 #9 30-day trial: exactly 3 paid bills are discounted, from 26 Dec", () => {
    expect(need("discountedBillDates")("2026-11-26", 30, 3)).toEqual(["2026-12-26", "2027-01-26", "2027-02-26"]);
  });

  it("08.5 #no-trial no trial: the first 3 bills from signup", () => {
    expect(need("discountedBillDates")("2026-11-26", 0, 3)).toEqual(["2026-11-26", "2026-12-26", "2027-01-26"]);
  });

  // Row 11 and 08.7.
  it.each([
    [11, " bf30 ", "BF30"],
    [11, "Bf30", "BF30"],
    [11, "BF30\n", "BF30"],
  ])("08.7 #%i %j is read as %s", (_row, typed, expected) => {
    expect(rules.normalizePromoCode(typed)).toBe(expected);
  });
});
