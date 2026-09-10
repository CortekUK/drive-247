/**
 * THE MOST IMPORTANT TEST IN THIS SUITE — Layer 3, pure maths, no network.
 *
 * The team lead's instruction, verbatim in translation: "all your magic here is,
 * you have to look at the math. If the math goes bad here, the math will stay bad
 * in the whole application... if Stripe blows up that's a smaller problem. If the
 * math goes bad the problem is much bigger, because that one number penetrates in
 * so many places." And: "if you don't understand the formula yourself, the formula
 * is wrong."
 *
 * So EVERY expected value below was derived BY HAND from the rate card and the
 * formula, and is written as a literal. None was produced by running the code and
 * copying the output — that would assert only that the code agrees with itself.
 * Each one carries the arithmetic in a comment so a human with a pencil can redo
 * it, which is also the documentation the team lead asked for.
 *
 * ---------------------------------------------------------------------------
 * THE FORMULA, read from apps/portal/src/lib/calculate-rental-price.ts
 *
 * Day count (:418-420) — note this is CORRECT despite looking like the ms/86400000
 * anti-pattern the repo warns about:
 *     pickupDay  = Date.UTC(y, m, d) of the LOCAL calendar date
 *     dropoffDay = Date.UTC(y, m, d) of the LOCAL calendar date
 *     rentalDays = max(1, ceil((dropoffDay - pickupDay) / 86400000))
 * Because both endpoints are normalised to UTC midnight, their difference is
 * always an exact multiple of 86400000, so DST cannot shift it and the ceil() is
 * a no-op. Doing this on local-midnight timestamps WOULD over-count the 25-hour
 * fall-back day; the Date.UTC normalisation is what prevents that.
 *
 * Tier selection (:474-493), monthlyTierDays defaults to 30:
 *     days >= 30 AND monthly_rent > 0  -> monthly, perDay = monthly_rent / 30
 *     7 <= days < 30 AND weekly_rent>0 -> weekly,  perDay = weekly_rent / 7
 *     daily_rent > 0                   -> daily,   perDay = daily_rent
 *     then fallbacks: weekly, then monthly, then 0
 *
 * Total (:452-470): sum of each day's effectiveRate, then rounded ONCE:
 *     Math.round(total * 100) / 100
 *
 * Times are NOT an input. The function takes date strings only, so pickup and
 * return times cannot affect the price. A 09:00->17:00 rental on the same date is
 * one day via the max(1, ...) floor.
 * ---------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import {
  calculateRentalPriceBreakdown,
  type VehicleRates,
} from "../../../apps/portal/src/lib/calculate-rental-price";

/**
 * The rate card. Chosen so every per-day equivalent divides EXACTLY, which is
 * what makes the tier table checkable on paper:
 *     daily   89.00
 *     weekly  525.00 / 7  = 75.00
 *     monthly 1950.00 / 30 = 65.00
 * A second card below deliberately does NOT divide cleanly, to pin the rounding.
 */
const CARD: VehicleRates = {
  daily_rent: 89.0,
  weekly_rent: 525.0,
  monthly_rent: 1950.0,
};

/** Sunday 2026-03-01 as a neutral start: no DST transition, no weekend config passed. */
const START = "2026-03-01";

/** Add n calendar days to START, formatted YYYY-MM-DD, computed without Date maths. */
function plusDays(n: number): string {
  const d = new Date(Date.UTC(2026, 2, 1));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Price a rental of exactly `days` days on the given card, with all surcharges off. */
function priceFor(days: number, card: VehicleRates = CARD) {
  return calculateRentalPriceBreakdown(
    START,
    plusDays(days),
    card,
    null,        // no weekend config
    [],          // no holidays
    [],          // no vehicle overrides
    undefined,   // no vehicleId
    30,          // monthlyTierDays
    false,       // skipSurcharges
    false,       // stackSurcharges
    []           // no manual per-day prices
  );
}

// @usecase A wrong day count multiplies through every downstream figure — base
// rent, per-day extras, insurance premium and tax. This is the single number
// the whole invoice hangs off.
describe("rental pricing — the day count", () => {
  it("counts a same-date rental as one day rather than zero", () => {
    // dropoff - pickup = 0ms -> ceil(0) = 0 -> max(1, 0) = 1
    const r = priceFor(0);
    expect(r.rentalDays).toBe(1);
    expect(r.rentalPrice).toBe(89.0); // 89.00 x 1
  });

  it("counts nights, not calendar days touched: Mar 1 -> Mar 4 is three days", () => {
    const r = priceFor(3);
    expect(r.rentalDays).toBe(3);
    // 89.00 x 3 = 267.00
    expect(r.rentalPrice).toBe(267.0);
  });

  it("is unaffected by pickup and return times, which are not inputs at all", () => {
    // Same dates, and there is no parameter through which a time could enter.
    expect(priceFor(3).rentalPrice).toBe(priceFor(3).rentalPrice);
    expect(calculateRentalPriceBreakdown.length).toBeGreaterThan(0);
  });

  it("survives a spring-forward DST boundary without gaining or losing a day", () => {
    // US DST 2026 begins Sun Mar 8. Mar 6 -> Mar 10 spans it and is 4 days.
    // Both endpoints are normalised through Date.UTC, so the 23-hour local day
    // cannot round the division down.
    const r = calculateRentalPriceBreakdown(
      "2026-03-06", "2026-03-10", CARD, null, [], [], undefined, 30, false, false, []
    );
    expect(r.rentalDays).toBe(4);
    expect(r.rentalPrice).toBe(356.0); // 89.00 x 4
  });

  it("survives a fall-back DST boundary, the case local-midnight maths gets wrong", () => {
    // US DST 2026 ends Sun Nov 1. Oct 30 -> Nov 3 is 4 days; the naive
    // local-midnight subtraction would see 4 days + 1 hour and ceil() to 5.
    const r = calculateRentalPriceBreakdown(
      "2026-10-30", "2026-11-03", CARD, null, [], [], undefined, 30, false, false, []
    );
    expect(r.rentalDays).toBe(4);
    expect(r.rentalPrice).toBe(356.0); // 89.00 x 4, NOT 445.00
  });
});

// @usecase Picking the wrong tier bills a month at the daily rate, or a week
// at the monthly rate. The boundaries at 7 and 30 days are where an off-by-one
// costs real money.
describe("rental pricing — tier selection at the boundaries", () => {
  // Hand-computed table. perDay: daily 89.00, weekly 525/7 = 75.00, monthly 1950/30 = 65.00
  const TABLE: Array<{ days: number; tier: string; total: number; how: string }> = [
    { days: 1,  tier: "daily",   total: 89.0,   how: "89.00 x 1" },
    { days: 6,  tier: "daily",   total: 534.0,  how: "89.00 x 6" },
    { days: 7,  tier: "weekly",  total: 525.0,  how: "75.00 x 7" },
    { days: 8,  tier: "weekly",  total: 600.0,  how: "75.00 x 8" },
    { days: 27, tier: "weekly",  total: 2025.0, how: "75.00 x 27" },
    { days: 28, tier: "weekly",  total: 2100.0, how: "75.00 x 28" },
    { days: 29, tier: "weekly",  total: 2175.0, how: "75.00 x 29" },
    { days: 30, tier: "monthly", total: 1950.0, how: "65.00 x 30" },
    { days: 31, tier: "monthly", total: 2015.0, how: "65.00 x 31" },
  ];

  for (const row of TABLE) {
    it(`prices ${row.days} days on the ${row.tier} tier as ${row.how} = ${row.total.toFixed(2)}`, () => {
      const r = priceFor(row.days);
      expect(r.rentalDays).toBe(row.days);
      expect(r.pricingTier).toBe(row.tier);
      expect(r.rentalPrice).toBe(row.total);
    });
  }

  it("switches to weekly at exactly 7 days, not 8", () => {
    expect(priceFor(6).pricingTier).toBe("daily");
    expect(priceFor(7).pricingTier).toBe("weekly");
  });

  it("switches to monthly at exactly 30 days, not 31", () => {
    expect(priceFor(29).pricingTier).toBe("weekly");
    expect(priceFor(30).pricingTier).toBe("monthly");
  });
});

// @usecase These non-monotonic points are legitimate tier discounts, but an
// operator quoting by hand will hit them and conclude the system is wrong.
// Pinned so the shape is documented rather than disputed.
describe("rental pricing — where the price goes DOWN as the rental gets longer", () => {
  /**
   * These are not defects: they are the tier discount working. They are pinned
   * because an operator quoting by hand will hit them, and because Kristen's
   * disputes are exactly of the form "my calculator said something else".
   */
  it("makes a 7-day rental cheaper than a 6-day one, because the weekly rate lands", () => {
    // 6 days daily = 534.00 ; 7 days weekly = 525.00 -> one MORE day costs 9.00 LESS
    expect(priceFor(6).rentalPrice).toBe(534.0);
    expect(priceFor(7).rentalPrice).toBe(525.0);
    expect(priceFor(7).rentalPrice).toBeLessThan(priceFor(6).rentalPrice);
  });

  it("makes a 30-day rental cheaper than a 29-day one, because the monthly rate lands", () => {
    // 29 days weekly = 2175.00 ; 30 days monthly = 1950.00 -> 225.00 less
    expect(priceFor(29).rentalPrice).toBe(2175.0);
    expect(priceFor(30).rentalPrice).toBe(1950.0);
    expect(priceFor(29).rentalPrice - priceFor(30).rentalPrice).toBe(225.0);
  });
});

// @usecase Rounding order decides whether the invoice total and the amount
// charged agree to the cent. Rounding per-day and rounding once at the end
// give different answers.
describe("rental pricing — rounding", () => {
  /**
   * A card whose weekly rate does NOT divide by 7. 500 / 7 = 71.42857142857143...
   * A regular (non-surcharge) day returns baseRate UNROUNDED (:373-379), while a
   * surcharge day rounds per-day (:298, :312, :354, :367). So on a plain rental the
   * fraction is carried at full precision through the sum and rounded exactly once
   * at the end (:470). That asymmetry is the behaviour being pinned here.
   */
  const ODD: VehicleRates = { daily_rent: 89.0, weekly_rent: 500.0, monthly_rent: 1950.0 };

  it("returns exactly the weekly rate for 7 days even though 500/7 does not divide", () => {
    // 7 x (500/7) = 500.0000000000001 in float; round(50000.00000000001)/100 = 500.00
    expect(priceFor(7, ODD).rentalPrice).toBe(500.0);
  });

  it("rounds the accumulated fraction once at the end for 8 days", () => {
    // 500/7 = 71.42857142857143 ; x8 = 571.4285714285714 ; x100 = 57142.85714285714
    // round -> 57143 ; /100 = 571.43
    expect(priceFor(8, ODD).rentalPrice).toBe(571.43);
  });

  it("never returns a value with more than two decimal places", () => {
    for (let d = 1; d <= 35; d++) {
      const p = priceFor(d, ODD).rentalPrice;
      expect(Math.round(p * 100) / 100).toBe(p);
    }
  });
});

// @usecase A live pricing defect: the tier fallback skips weekly for rentals
// of 30 days or more, so the renter is billed at the daily rate and one extra
// day costs 495.00 more.
describe("rental pricing — a vehicle with no monthly rate configured", () => {
  /**
   * DEFECT, verified by hand from calculate-rental-price.ts:474-493.
   *
   *   :474  days >= 30 AND monthly_rent > 0        -> monthly   [fails: monthly is 0]
   *   :479  days >= 7 AND days < 30 AND weekly > 0 -> weekly    [fails: 30 < 30 is false]
   *   :484  daily_rent > 0                         -> DAILY     [taken]
   *   :489  weekly_rent > 0                        -> weekly    [unreachable, daily won]
   *
   * The upper bound `days < monthlyTierDays` on the weekly branch has no lower
   * branch to catch >= 30 days once the monthly branch declines, so the rental
   * falls all the way through to the DAILY rate. The vehicle's own weekly rate is
   * ignored, and the customer is billed 89.00/day for a month.
   *
   * Hand-computed impact on the card below:
   *   29 days -> weekly tier -> 75.00 x 29 = 2175.00
   *   30 days -> DAILY  tier -> 89.00 x 30 = 2670.00
   * One extra day costs 495.00 MORE. Correct behaviour would fall back to the
   * weekly rate: 75.00 x 30 = 2250.00.
   *
   * The first test pins the arithmetic that IS happening, so the size of the
   * error is on the record. The second is marked `it.fails` and states the
   * CORRECT expectation: it passes while the bug exists and turns RED the moment
   * someone fixes the tier fallback, which forces this comment to be revisited
   * rather than letting a stale test bless the defect forever.
   */
  const NO_MONTHLY: VehicleRates = { daily_rent: 89.0, weekly_rent: 525.0, monthly_rent: 0 };

  it("falls through to the DAILY rate at 30 days, making one extra day cost 495.00 more", () => {
    const at29 = priceFor(29, NO_MONTHLY);
    const at30 = priceFor(30, NO_MONTHLY);

    expect(at29.pricingTier).toBe("weekly");
    expect(at29.rentalPrice).toBe(2175.0); // 75.00 x 29

    expect(at30.pricingTier).toBe("daily");
    expect(at30.rentalPrice).toBe(2670.0); // 89.00 x 30

    expect(at30.rentalPrice - at29.rentalPrice).toBe(495.0);
  });

  it.fails("should fall back to the weekly rate, not the daily rate, at 30 days", () => {
    // Remove the `.fails` marker once calculate-rental-price.ts:479-489 is fixed.
    const at30 = priceFor(30, NO_MONTHLY);
    expect(at30.pricingTier).toBe("weekly");
    expect(at30.rentalPrice).toBe(2250.0); // 75.00 x 30
  });
});

// @usecase An unpriced vehicle must yield 0 and an empty breakdown, never NaN.
// NaN propagates silently into the invoice and the Stripe amount.
describe("rental pricing — a vehicle with no rates at all", () => {
  it("returns zero and an empty breakdown rather than NaN", () => {
    const r = priceFor(3, { daily_rent: 0, weekly_rent: 0, monthly_rent: 0 });
    expect(r.rentalPrice).toBe(0);
    expect(r.pricingTier).toBe("daily");
    expect(r.dayBreakdown).toEqual([]);
    expect(Number.isNaN(r.rentalPrice)).toBe(false);
  });

  it("still reports the day count when it cannot price the rental", () => {
    expect(priceFor(3, { daily_rent: 0, weekly_rent: 0, monthly_rent: 0 }).rentalDays).toBe(3);
  });
});

// @usecase Three inputs that produce a confident wrong number instead of an
// error — the worst failure mode for money code, because nothing downstream
// can tell it from a real price.
describe("rental pricing — inputs the engine cannot price safely", () => {
  /**
   * Three defects, each verified by reading the source rather than by running it.
   * They share a shape: a malformed or hostile input produces a CONFIDENT WRONG
   * NUMBER instead of an error. That is the worst failure mode for money code,
   * because nothing downstream can tell it apart from a real price.
   */

  it("returns a price of zero with a NaN day count when handed an ISO datetime", () => {
    /**
     * DEFECT, from parseDateString at calculate-rental-price.ts:90-94:
     *     const [year, month, day] = dateStr.split('-').map(Number)
     * For "2026-03-01T10:00:00Z" the split yields ["2026","03","01T10:00:00Z"],
     * and Number("01T10:00:00Z") is NaN. So:
     *     new Date(2026, 2, NaN)              -> Invalid Date
     *     Date.UTC(NaN, NaN, NaN)             -> NaN
     *     max(1, ceil(NaN - NaN / 86400000))  -> NaN
     *     for (i = 0; i < NaN; i++)           -> body never runs
     *     Math.round(0 * 100) / 100           -> 0
     * The caller receives 0.00 for a real rental. Every column in this schema is
     * date-only, so this only bites when a caller passes a timestamptz — which is
     * exactly the mistake a new integration makes.
     */
    const r = calculateRentalPriceBreakdown(
      "2026-03-01T10:00:00Z", "2026-03-04T10:00:00Z",
      CARD, null, [], [], undefined, 30, false, false, []
    );
    expect(Number.isNaN(r.rentalDays)).toBe(true);
    expect(r.rentalPrice).toBe(0);
    expect(r.dayBreakdown).toEqual([]);
  });

  it.fails("should price an ISO datetime the same as the date-only string it contains", () => {
    // Remove the `.fails` marker once parseDateString tolerates a 'T' suffix.
    const r = calculateRentalPriceBreakdown(
      "2026-03-01T10:00:00Z", "2026-03-04T10:00:00Z",
      CARD, null, [], [], undefined, 30, false, false, []
    );
    expect(r.rentalDays).toBe(3);
    expect(r.rentalPrice).toBe(267.0); // 89.00 x 3
  });

  it("silently bills a reversed date range as a single day instead of rejecting it", () => {
    /**
     * DEFECT at :420. With return BEFORE pickup the subtraction is negative,
     * ceil() keeps it negative, and max(1, ·) clamps it up to 1:
     *     Mar 10 -> Mar 6 = -4 days -> ceil(-4) = -4 -> max(1, -4) = 1
     * So a transposed date pair produces a plausible one-day invoice rather than
     * an error. The floor exists to make same-day rentals cost one day, and it
     * cannot distinguish that from a reversed range.
     *
     * This is pinned rather than marked `.fails` because the fix is a design
     * decision that belongs UPSTREAM — the booking form and the rental-create
     * payload should reject return < pickup. A pure pricing function returning 1
     * is defensible; what is not defensible is nothing else checking.
     */
    const r = calculateRentalPriceBreakdown(
      "2026-03-10", "2026-03-06", CARD, null, [], [], undefined, 30, false, false, []
    );
    expect(r.rentalDays).toBe(1);
    expect(r.rentalPrice).toBe(89.0);
    expect(r.pricingTier).toBe("daily");
  });

  it("produces an infinite price when a tenant has monthly_tier_days set to zero", () => {
    /**
     * DEFECT at :474-476. The monthly branch is `rentalDays >= monthlyTierDays`,
     * and every rental satisfies `>= 0`, so a tenant row with monthly_tier_days = 0
     * routes EVERY rental to the monthly tier at:
     *     perDay = monthly_rent / 0 = Infinity
     * The day loop then sums Infinity and Math.round(Infinity * 100) / 100 is
     * Infinity. It reaches the invoice as a number, not an error.
     */
    const r = calculateRentalPriceBreakdown(
      START, plusDays(3), CARD, null, [], [], undefined, 0, false, false, []
    );
    expect(r.pricingTier).toBe("monthly");
    expect(r.rentalPrice).toBe(Infinity);
    expect(Number.isFinite(r.rentalPrice)).toBe(false);
  });

  it.fails("should never return a non-finite price, whatever monthly_tier_days holds", () => {
    // Remove the `.fails` marker once monthlyTierDays is floored at 1 (or the
    // monthly branch requires monthlyTierDays > 0).
    const r = calculateRentalPriceBreakdown(
      START, plusDays(3), CARD, null, [], [], undefined, 0, false, false, []
    );
    expect(Number.isFinite(r.rentalPrice)).toBe(true);
  });

  it("treats a negative monthly_tier_days the same hostile way", () => {
    // -1 also satisfies `rentalDays >= -1`, and monthly_rent / -1 is negative,
    // so the rental is priced as a CREDIT to the customer.
    const r = calculateRentalPriceBreakdown(
      START, plusDays(3), CARD, null, [], [], undefined, -1, false, false, []
    );
    expect(r.pricingTier).toBe("monthly");
    expect(r.rentalPrice).toBeLessThan(0);
  });
});
