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

  // Rows 13-16: the edges of the date math, each with its 4th (full price) bill.
  it.each([
    [13, "2026-11-26", 60, ["2027-01-25", "2027-02-25", "2027-03-25"], "2027-04-25"],
    [14, "2027-01-31", 0, ["2027-01-31", "2027-02-28", "2027-03-31"], "2027-04-30"],
    [15, "2028-01-30", 30, ["2028-02-29", "2028-03-29", "2028-04-29"], "2028-05-29"],
    [16, "2026-11-26", 90, ["2027-02-24", "2027-03-24", "2027-04-24"], "2027-05-24"],
  ])("08.13 #%i signup %s, %i-day trial: 3 discounted bills, then full price", (_row, signup, trial, discounted, fourth) => {
    expect(need("discountedBillDates")(signup, trial, 3)).toEqual(discounted);
    expect(need("paidBillDates")(signup, trial, 4)[3]).toBe(fourth);
  });

  it("08.14 #14 a bill on the 31st falls on the month's last day in shorter months", () => {
    expect(need("paidBillDates")("2027-01-31", 0, 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("08.13 #all every trial from 0 to 90 days gets exactly 3 discounted bills", () => {
    for (const signup of ["2026-11-26", "2027-01-31", "2028-02-29", "2026-12-31"]) {
      for (let trial = 0; trial <= 90; trial++) {
        const got = need("discountedBillDates")(signup, trial, 3);
        expect(got, `${signup} + ${trial} days`).toEqual(need("paidBillDates")(signup, trial, 3));
      }
    }
  });

  // Rows 17-18: fixed discounts.
  it.each([
    [17, 12900, 20, 10900],
    [18, 12900, 200, 0],
  ])("08.15 #%i %i cents with $%i off is %i cents", (_row, cents, dollars, expected) => {
    expect(need("promoBillCents")(cents, "fixed", dollars)).toBe(expected);
  });

  it("08.6 #refuse broken input is refused, never charged", () => {
    expect(() => need("promoBillCents")(129.5, "percent", 30)).toThrow();
    expect(() => need("promoBillCents")(-100, "percent", 30)).toThrow();
    expect(() => need("promoBillCents")(12900, "percent", 101)).toThrow();
    expect(() => need("promoBillCents")(12900, "percent", -5)).toThrow();
    expect(() => need("paidBillDates")("2026-02-30", 0, 1)).toThrow();
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
