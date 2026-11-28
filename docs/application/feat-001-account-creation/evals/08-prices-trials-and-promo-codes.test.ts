// Proves spec 08's math: every row of its Worked examples table, to the cent.
// The math lives in one place: supabase/functions/_shared/platform-promo-rules.ts.
//   promoBillCents(priceCents, type, value)          -> one discounted bill, whole cents
//   discountedBillDates(signupISO, trialDays, months) -> the dates of the bills that get the discount
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as rules from "../../../../supabase/functions/_shared/platform-promo-rules";
import { blackFridayCents } from "../../../../apps/web/src/lib/black-friday";
import { discountedPrice } from "../../../../apps/web/src/lib/promo-offer";

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

  // Row 9 (30-day trial) was withdrawn in review 1: a signup trial is under 30 days (08.19).

  it("08.5 #no-trial no trial: the first 3 bills from signup", () => {
    expect(need("discountedBillDates")("2026-11-26", 0, 3)).toEqual(["2026-11-26", "2026-12-26", "2027-01-26"]);
  });

  // Rows 13-16: the edges of the date math, each with its 4th (full price) bill.
  it.each([
    // Rows 13, 15 and 16 (trials of 30+ days) were withdrawn in review 1 (08.19).
    [14, "2027-01-31", 0, ["2027-01-31", "2027-02-28", "2027-03-31"], "2027-04-30"],
    [19, "2028-01-31", 29, ["2028-02-29", "2028-03-29", "2028-04-29"], "2028-05-29"],
  ])("08.13 #%i signup %s, %i-day trial: 3 discounted bills, then full price", (_row, signup, trial, discounted, fourth) => {
    expect(need("discountedBillDates")(signup, trial, 3)).toEqual(discounted);
    expect(need("paidBillDates")(signup, trial, 4)[3]).toBe(fourth);
  });

  it("08.14 #14 a bill on the 31st falls on the month's last day in shorter months", () => {
    expect(need("paidBillDates")("2027-01-31", 0, 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  // 08.17, decided in review 1: every allowed trial (0 to 29 days), on every signup day of
  // two whole years (a leap year included), gets exactly 3 discounted bills.
  it("08.13 #all every trial from 0 to 29 days, every signup day, gets exactly 3 discounted bills", () => {
    const days: string[] = [];
    for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2029, 0, 1); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
    for (const signup of days) {
      for (let trial = 0; trial <= 29; trial++) {
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

  // 08.18: the browser's previews agree with the server's math, to the cent.
  it.each([[12900], [22900], [34900], [9999], [5], [1], [0], [12345], [418800]])(
    "08.18 #%i cents: the BF30 preview equals the server's bill",
    (cents) => {
      const server = rules.promoBillCents(cents, "percent", 30);
      expect(blackFridayCents(cents)).toBe(server);
      expect(Number.isInteger(blackFridayCents(cents))).toBe(true);
      expect(Math.round(discountedPrice(cents / 100, { discountType: "percent", discountValue: 30 }) * 100)).toBe(server);
    },
  );

  it("08.18 #fixed the fixed-amount preview equals the server's bill", () => {
    for (const [cents, dollars] of [[12900, 20], [12900, 200], [999, 9.99], [5, 0.01]]) {
      expect(Math.round(discountedPrice(cents / 100, { discountType: "fixed", discountValue: dollars }) * 100))
        .toBe(rules.promoBillCents(cents, "fixed", dollars));
    }
  });

  it("08.3 #signupBill a 14-day trial with BF30: $0 today, the discounted bill on day 14", () => {
    const bf30 = { discountType: "percent" as const, discountValue: 30, duration: "repeating" as const, durationMonths: 3 };
    expect(rules.signupBill(22900, 14, "2026-11-26", bf30)).toEqual({
      todayCents: 0, firstChargeAt: "2026-12-10", firstChargeCents: 16030,
      discountedBills: 3, discountedBillCents: 16030, fullPriceCents: 22900,
    });
  });

  it("08.4 #signupBill no trial, no code: the plan price today", () => {
    expect(rules.signupBill(12900, 0, "2026-11-26", null)).toEqual({
      todayCents: 12900, firstChargeAt: "2026-11-26", firstChargeCents: 12900,
      discountedBills: 0, discountedBillCents: 12900, fullPriceCents: 12900,
    });
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

  // 08.19 (row 20): the Signup Plans form refuses a trial of 30 days or more.
  // The form's own parser lives in a React file the test runner cannot load, so its
  // rule is read from the source; the function's refusal is proved on staging (.mjs).
  it("08.19 #20 the form's limit is 29 days and 30 gets the review-1 message", () => {
    const src = readFileSync(new URL("../../../../apps/admin/components/admin/signup-plan-card.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/export const TRIAL_DAYS_MAX = 29;/);
    expect(src).toContain("A signup trial must be under 30 days (1 to 29).");
    const trial = readFileSync(new URL("../../../../supabase/functions/_shared/signup-trial.ts", import.meta.url), "utf8");
    expect(trial).toMatch(/export const MAX_SIGNUP_PLAN_TRIAL_DAYS = 29;/);
  });
});
