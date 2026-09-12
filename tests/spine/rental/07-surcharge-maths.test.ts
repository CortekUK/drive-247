/**
 * SURCHARGE MATHS — the weekend/holiday/override/stacking/manual-price half of
 * the pricing engine. Layer 3 only: every test here imports
 * apps/portal/src/lib/calculate-rental-price.ts and EXECUTES it. No network, no
 * Supabase, no edge functions.
 *
 * WHY L3 AND ONLY L3
 * The engine is a pure function of (dates, rate card, tenant config, holiday
 * rows, per-vehicle override rows, manual per-day prices). Every input can be
 * hand-typed as a literal, so there is nothing here that a source grep would
 * tell us that running the code does not tell us better. The one thing L3
 * cannot see is which arguments the CALLERS pass — that is covered in the
 * "browse price versus checkout price" and "stacking toggle" blocks by
 * reproducing the call sites' argument lists verbatim as literals, with the
 * source line cited, rather than by importing React pages into vitest.
 *
 * WHAT THIS FILE DOES **NOT** COVER
 *  - Day count, tier selection at 7/30, tier rounding, unpriceable inputs.
 *    Those are 01-pricing-maths.test.ts and are not repeated here. Every test
 *    in 01 passes null/[] for the surcharge inputs; this file is the other half.
 *  - Extras, tax, deposits, insurance (02-invoice-maths.test.ts).
 *  - What gets WRITTEN to rentals.* from a price (03-rental-create.test.ts).
 *  - Anything about how the portal or booking UI renders a breakdown.
 *
 * NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
 *
 * 1. The engine exists TWICE, byte-identical by policy:
 *    apps/booking/src/lib/calculate-rental-price.ts and the portal copy. The
 *    header of both says so. `diff` between them prints nothing as of this
 *    writing (verified). Tests import the portal copy, exactly as 01 does; a
 *    defect found here is live on the customer's screen too.
 *
 * 2. There are TWO pricing paths inside getDayRate, not one:
 *      - DEFAULT / PRIORITY (:257-380): holiday wins, else weekend, else base.
 *        First match returns; nothing stacks.
 *      - STACKING (:193-255): every applicable surcharge sums additively.
 *    Which one runs is decided at :434 by
 *      `const stack = stackSurcharges || Boolean(weekendConfig?.stack_surcharges)`
 *    — so the tenant's `stack_surcharges` column silently switches the whole
 *    day-rate algorithm. Several findings below are about the two paths
 *    disagreeing, including one where turning stacking ON makes a day CHEAPER.
 *
 * 3. The two paths round differently. The default path returns a regular day's
 *    rate at full float precision and lets the single `Math.round(total*100)/100`
 *    at :470 do all the rounding (the round-once property 01 pins at its
 *    "rounds the accumulated fraction once at the end" test). The stacking path
 *    rounds EVERY day to the cent at :252, including days with no surcharge.
 *    That is why a 30-day rental with zero surcharges costs 0.10 more under
 *    stacking. This is not a test artefact; it is the shipped behaviour.
 *
 * 4. `surcharge_percent` on tenant_holidays DEFAULTS TO 0
 *    (20260218120000_add_dynamic_pricing.sql:28), and a matched holiday returns
 *    unconditionally at :260 whatever its percentage is. So the first holiday
 *    row an operator saves without touching the percent field CANCELS the
 *    weekend surcharge on any weekend day it covers. That is finding one.
 *
 * 5. Dates. All fixtures use March 2026 because 2026-03-01 is a Sunday and
 *    2026-03-07 a Saturday (2026-01-01 is a Thursday; Mar 7 is day 66 of a
 *    non-leap year, and (66-1) mod 7 = 2, Thursday+2 = Saturday). Weekend days
 *    are the JS numbers [6, 0] = Sat, Sun, matching the tenants.weekend_days
 *    default in the migration. A "one-day rental on Saturday" is written
 *    2026-03-07 -> 2026-03-08: the engine counts nights, so the dropoff day is
 *    not priced.
 *
 * 6. MONEY RULE. Every expected figure below is derived BY HAND with the
 *    arithmetic in a comment. None was copied out of program output. Rates are
 *    chosen so the per-day equivalent is a round 100.00 wherever possible
 *    (weekly 700.00 / 7, monthly 3000.00 / 30) precisely so a human with a
 *    pencil can redo the whole file.
 *
 * 7. PINNING vs WATCHDOG. Where the code is wrong, there are two tests: a
 *    PINNING test that records the actual — wrong — number so its size is on
 *    record, and an `it.fails` WATCHDOG asserting the CORRECT number. The
 *    watchdog is green while the bug lives and goes RED the day it is fixed,
 *    which forces someone to come back here and update the pin. Never "fix" a
 *    red watchdog by deleting it.
 */

import { describe, it, expect } from "vitest";
import {
  calculateRentalPriceBreakdown,
  type VehicleRates,
  type Holiday,
  type VehicleOverride,
  type TenantWeekendConfig,
} from "../../../apps/portal/src/lib/calculate-rental-price";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Daily tier only. 100.00/day makes every percentage readable as itself. */
const DAILY_100: VehicleRates = { daily_rent: 100.0, weekly_rent: 0, monthly_rent: 0 };

/** weekly_rent 700.00 / 7 = 100.00 per day exactly. */
const WEEKLY_700: VehicleRates = { daily_rent: 100.0, weekly_rent: 700.0, monthly_rent: 0 };

/** monthly_rent 3000.00 / 30 = 100.00 per day exactly. */
const MONTHLY_3000: VehicleRates = { daily_rent: 100.0, weekly_rent: 700.0, monthly_rent: 3000.0 };

/** monthly_rent 2000.00 / 30 = 66.666... per day — deliberately does NOT divide. */
const MONTHLY_2000: VehicleRates = { daily_rent: 0, weekly_rent: 0, monthly_rent: 2000.0 };

/** Sat + Sun, the tenants.weekend_days default (migration :10). */
const WEEKEND_20: TenantWeekendConfig = {
  weekend_surcharge_percent: 20,
  weekend_days: [6, 0],
};

const WEEKEND_20_STACKING: TenantWeekendConfig = {
  weekend_surcharge_percent: 20,
  weekend_days: [6, 0],
  stack_surcharges: true,
};

const SAT = "2026-03-07";
const SUN_AFTER_SAT = "2026-03-08"; // dropoff for a one-day Saturday rental

function holiday(over: Partial<Holiday> & { id: string }): Holiday {
  return {
    name: "Holiday",
    start_date: SAT,
    end_date: SAT,
    surcharge_percent: 50,
    excluded_vehicle_ids: [],
    recurs_annually: false,
    ...over,
  };
}

function override(over: Partial<VehicleOverride> & { id: string }): VehicleOverride {
  return {
    vehicle_id: "v1",
    rule_type: "weekend",
    holiday_id: null,
    override_type: "excluded",
    fixed_price: null,
    custom_percent: null,
    ...over,
  };
}

// ── Sanity: the calendar the whole file rests on ────────────────────────────

// @usecase Every dated expectation below assumes 2026-03-07 is a Saturday and
// 2026-03-01 a Sunday. If the calendar assumption is wrong, every weekend-day
// count in this file is wrong and the figures mean nothing.
describe("surcharge maths — the calendar these fixtures rest on", () => {
  it("treats 2026-03-07 as a Saturday, JS day number 6", () => {
    const r = calculateRentalPriceBreakdown(SAT, SUN_AFTER_SAT, DAILY_100);
    expect(r.rentalDays).toBe(1);
    expect(r.dayBreakdown[0].dayOfWeek).toBe(6);
  });

  it("treats 2026-03-01 as a Sunday, JS day number 0", () => {
    const r = calculateRentalPriceBreakdown("2026-03-01", "2026-03-02", DAILY_100);
    expect(r.dayBreakdown[0].dayOfWeek).toBe(0);
  });
});

// ── 1. A 0% holiday eats the weekend surcharge ──────────────────────────────

// @usecase An operator marks a company holiday, a blackout date or any purely
// informational day and leaves the surcharge at its default 0. If this block
// goes red the weekend surcharge is silently cancelled on every weekend day
// that holiday covers — 20.00 a day a vehicle, with no line item explaining it.
describe("surcharge maths — a holiday whose surcharge is zero", () => {
  const zeroPctHoliday = holiday({ id: "h0", name: "Company Day", surcharge_percent: 0 });

  it("charges 100.00 x 1.20 = 120.00 on a Saturday when no holiday is configured", () => {
    // Control. 100.00 base x (1 + 20/100) = 120.00
    const r = calculateRentalPriceBreakdown(SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [], [], "v1");
    expect(r.rentalPrice).toBe(120.0);
    expect(r.dayBreakdown[0].type).toBe("weekend");
    expect(r.dayBreakdown[0].surchargePercent).toBe(20);
  });

  it("drops the weekend surcharge entirely, charging the bare 100.00, when a 0%-surcharge holiday covers the same Saturday", () => {
    // DEFECT PIN. The `if (holiday)` gate at calculate-rental-price.ts:260 tests
    // for a MATCH, not for a non-zero percentage, and every branch inside it
    // returns — so the weekend check at :316 is unreachable on a holiday day.
    // The day is priced 100.00 x (1 + 0/100) = 100.00, losing the 20.00 above.
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [zeroPctHoliday], [], "v1",
    );
    expect(r.rentalPrice).toBe(100.0);
    expect(r.dayBreakdown[0].type).toBe("holiday");
    expect(r.dayBreakdown[0].surchargePercent).toBe(0);
    // The size of the loss, stated outright: 120.00 - 100.00 = 20.00 a day.
    expect(120.0 - r.rentalPrice).toBe(20.0);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:260 is fixed
  it.fails("should still charge the weekend surcharge when the holiday contributes 0%, giving 100.00 x 1.20 = 120.00", () => {
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [zeroPctHoliday], [], "v1",
    );
    expect(r.rentalPrice).toBe(120.0);
  });
});

// ── 2. Two ways to exclude a vehicle, two different prices ──────────────────

// @usecase The operator has one intent — "this car is not in this holiday" —
// and two UI affordances for it. If this block goes red, two identical cars on
// the same Saturday are billed 20.00 apart depending on which affordance the
// operator happened to use, and the override route also waives a weekend
// surcharge nobody asked to waive.
describe("surcharge maths — the two ways to take a vehicle out of a holiday", () => {
  const bigHoliday = holiday({ id: "h1", name: "Peak", surcharge_percent: 50 });

  it("charges the weekend rate of 100.00 x 1.20 = 120.00 when the vehicle is listed in the holiday's excluded_vehicle_ids", () => {
    // Route A. findMatchingHoliday `continue`s at :121-123, returns null, and
    // control reaches the weekend check at :316. 100.00 x 1.20 = 120.00
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20,
      [{ ...bigHoliday, excluded_vehicle_ids: ["v1"] }], [], "v1",
    );
    expect(r.rentalPrice).toBe(120.0);
    expect(r.dayBreakdown[0].type).toBe("weekend");
    expect(r.dayBreakdown[0].surchargePercent).toBe(20);
  });

  it("charges the bare 100.00 when the same vehicle is taken out of the same holiday by an 'excluded' pricing override instead", () => {
    // DEFECT PIN. Route B returns at :267-275 with type 'regular' and the base
    // rate, so :316 is never reached and the weekend's 20% vanishes with the
    // holiday's 50%. 100.00 x 1.00 = 100.00, i.e. 20.00 under Route A.
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [bigHoliday],
      [override({ id: "o1", rule_type: "holiday", holiday_id: "h1", override_type: "excluded" })],
      "v1",
    );
    expect(r.rentalPrice).toBe(100.0);
    expect(r.dayBreakdown[0].type).toBe("regular");
    expect(r.dayBreakdown[0].surchargePercent).toBe(0);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:267 is fixed
  it.fails("should price the two exclusion mechanisms identically, both at 100.00 x 1.20 = 120.00", () => {
    const routeA = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20,
      [{ ...bigHoliday, excluded_vehicle_ids: ["v1"] }], [], "v1",
    );
    const routeB = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [bigHoliday],
      [override({ id: "o1", rule_type: "holiday", holiday_id: "h1", override_type: "excluded" })],
      "v1",
    );
    expect(routeB.rentalPrice).toBe(routeA.rentalPrice);
    expect(routeB.rentalPrice).toBe(120.0);
  });
});

// ── 3. Stacking stacks only the FIRST matching holiday ──────────────────────

// @usecase Overlapping holiday rows are the normal shape of this data — a
// "Peak Season" range with "Christmas Day" inside it — and nothing in
// tenant_holidays forbids the overlap. If this block goes red the operator
// configured 20% + 30% + 20%, is billing 40%, and the rendered breakdown omits
// the missing holiday so it looks internally consistent.
describe("surcharge maths — two holidays covering the same day, with stacking on", () => {
  const xmas = holiday({ id: "hx", name: "Xmas", surcharge_percent: 20 });
  const peak = holiday({ id: "hp", name: "Peak", surcharge_percent: 30 });

  it("sums only the first matching holiday and the weekend, charging 100.00 x 1.40 = 140.00 rather than all three surcharges", () => {
    // DEFECT PIN. findMatchingHoliday returns on the FIRST hit (:141), so only
    // Xmas reaches the stacking accumulator even though the branch comment at
    // :194-195 promises "sum(weekend% + each holiday%)".
    //   applied = Xmas 20 + Weekend 20 = 40  ->  100.00 x (1 + 40/100) = 140.00
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20_STACKING, [xmas, peak], [], "v1",
    );
    expect(r.rentalPrice).toBe(140.0);
    expect(r.dayBreakdown[0].surchargePercent).toBe(40);
    expect(r.dayBreakdown[0].appliedSurcharges).toEqual([
      { label: "Xmas", percent: 20 },
      { label: "Weekend", percent: 20 },
    ]);
    // 'Peak' at 30% is dropped from the money AND from the rendered breakdown.
    expect(r.dayBreakdown[0].appliedSurcharges).toHaveLength(2);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:204 is fixed
  it.fails("should apply every matching holiday under stacking, giving 100.00 x (1 + (20+30+20)/100) = 170.00", () => {
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20_STACKING, [xmas, peak], [], "v1",
    );
    expect(r.rentalPrice).toBe(170.0);
    expect(r.dayBreakdown[0].appliedSurcharges).toHaveLength(3);
  });
});

// ── 4. Stacking makes a day CHEAPER than the priority path ──────────────────

// @usecase Stacking is sold to the operator as "apply everything" — strictly
// additive. If this block goes red, an operator with a quiet-Saturday flat rate
// and a separate Christmas markup bills Christmas Saturday at the quiet rate,
// and the breakdown row just says "weekend" so nothing shows why.
describe("surcharge maths — a weekend fixed-price override on a holiday day", () => {
  const bigHoliday = holiday({ id: "h1", name: "Peak", surcharge_percent: 50 });
  const weekendFlat60 = override({
    id: "o1", rule_type: "weekend", override_type: "fixed_price", fixed_price: 60,
  });

  it("charges the holiday surcharge of 100.00 x 1.50 = 150.00 on the default priority path, ignoring the weekend flat rate", () => {
    // Control. The default path's holiday branch returns at :303-313 before the
    // weekend check at :316 can see the override. 100.00 x (1 + 50/100) = 150.00
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [bigHoliday], [weekendFlat60], "v1",
    );
    expect(r.rentalPrice).toBe(150.0);
    expect(r.dayBreakdown[0].type).toBe("holiday");
  });

  it("charges the weekend flat 60.00 once stacking is on, making the identical day 90.00 cheaper", () => {
    // DEFECT PIN. The stacking fixed-price shortcut at :218 is guarded on a
    // HOLIDAY override existing. There is none here, so :221 fires and the
    // holiday's own 50% is discarded outright.
    //   default 150.00 - stacking 60.00 = 90.00 lost by turning the toggle ON.
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20_STACKING, [bigHoliday], [weekendFlat60], "v1",
    );
    expect(r.rentalPrice).toBe(60.0);
    expect(r.dayBreakdown[0].type).toBe("weekend");
    expect(r.dayBreakdown[0].appliedSurcharges).toEqual([]);
    expect(150.0 - r.rentalPrice).toBe(90.0);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:221 is fixed
  it.fails("should never price a day below the priority-path result for the same inputs — stacking must be at least 150.00 here", () => {
    const stacked = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20_STACKING, [bigHoliday], [weekendFlat60], "v1",
    );
    expect(stacked.rentalPrice).toBeGreaterThanOrEqual(150.0);
  });
});

// ── 5. Stacking rounds every day, even surcharge-free ones ──────────────────

// @usecase The tenant's stack_surcharges column changes the price of rentals
// that carry no surcharge at all. If this block goes red, a quote the customer
// already saw — or a deposit already authorised — differs from the charge by
// cents, and the drift grows with rental length.
describe("surcharge maths — per-day rounding under stacking on a rental with no surcharges", () => {
  // 2000.00 / 30 = 66.666666... per day. 2026-03-01 -> 2026-03-31 is 30 days,
  // so the monthly tier applies (rentalDays >= monthlyTierDays at :474).
  const FROM = "2026-03-01";
  const TO = "2026-03-31";

  it("returns exactly the monthly rent of 2000.00 on the default path, rounding the accumulated fraction once at the end", () => {
    // Control, and the round-once property 01 already pins for the default path.
    // 30 x (2000/30) = 2000.00 exactly, rounded once at :470.
    const r = calculateRentalPriceBreakdown(FROM, TO, MONTHLY_2000, null, [], [], "v1", 30);
    expect(r.rentalDays).toBe(30);
    expect(r.pricingTier).toBe("monthly");
    expect(r.rentalPrice).toBe(2000.0);
  });

  it("returns 2000.10 for the same rental under stacking, because every surcharge-free day is rounded up to 66.67 first", () => {
    // DEFECT PIN. The stacking branch always exits through :244-254, which
    // rounds per-day even when `applied` is empty:
    //   round(66.666666... x 100)/100 = 66.67, and 66.67 x 30 = 2000.10
    // against 2000.00 on the default path. 0.10 on a rental with NO surcharges.
    const r = calculateRentalPriceBreakdown(
      FROM, TO, MONTHLY_2000, null, [], [], "v1", 30, false, /* stackSurcharges */ true,
    );
    expect(r.rentalPrice).toBe(2000.1);
    expect(r.dayBreakdown[0].effectiveRate).toBe(66.67);
    expect(r.dayBreakdown[0].surchargePercent).toBe(0);
    expect(r.dayBreakdown[0].appliedSurcharges).toEqual([]);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:252 is fixed
  it.fails("should leave the total untouched when stacking is on but no surcharge applies — 2000.00, not 2000.10", () => {
    const r = calculateRentalPriceBreakdown(
      FROM, TO, MONTHLY_2000, null, [], [], "v1", 30, false, true,
    );
    expect(r.rentalPrice).toBe(2000.0);
  });
});

// ── 6. skipSurcharges does not neutralise the stacking flag ─────────────────

// @usecase skipSurcharges is the auto-extend / "set price" path, which runs
// unattended on cron job 54. If this block goes red, a stacking tenant's
// extensions are over-billed to the cent against the flat rate the operator
// advertised, and nobody is watching when it happens.
describe("surcharge maths — skipSurcharges on a tenant who has stacking switched on", () => {
  const FROM = "2026-03-01";
  const TO = "2026-03-31";

  it("returns the flat 2000.00 when the tenant's weekend config does not set stack_surcharges", () => {
    // Control. 30 x (2000/30) = 2000.00, rounded once.
    const r = calculateRentalPriceBreakdown(
      FROM, TO, MONTHLY_2000, WEEKEND_20, [], [], "v1", 30, /* skipSurcharges */ true,
    );
    expect(r.rentalPrice).toBe(2000.0);
  });

  it("returns 2000.10 for the same skipSurcharges call when the tenant's weekend config sets stack_surcharges", () => {
    // DEFECT PIN. :427-429 blank the weekend config, the holidays and the
    // overrides for skipSurcharges, but :434 reads the RAW `weekendConfig`, not
    // `effectiveWeekendConfig`. The stacking flag is the one input that leaks
    // through, and it is exactly the one that changes the rounding regime:
    //   round(2000/30 x 100)/100 = 66.67, x 30 = 2000.10
    const r = calculateRentalPriceBreakdown(
      FROM, TO, MONTHLY_2000, WEEKEND_20_STACKING, [], [], "v1", 30, /* skipSurcharges */ true,
    );
    expect(r.rentalPrice).toBe(2000.1);
    // Every day is still flat — the surcharge really was skipped. Only the
    // rounding regime survived.
    expect(r.dayBreakdown.every(d => d.type === "regular")).toBe(true);
    expect(r.dayBreakdown.every(d => d.effectiveRate === 66.67)).toBe(true);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:434 is fixed
  it.fails("should make the tenant's stacking flag irrelevant under skipSurcharges — 2000.00 either way", () => {
    const r = calculateRentalPriceBreakdown(
      FROM, TO, MONTHLY_2000, WEEKEND_20_STACKING, [], [], "v1", 30, true,
    );
    expect(r.rentalPrice).toBe(2000.0);
  });
});

// ── 7. A non-numeric manual price NaNs the whole total ──────────────────────

// @usecase 01 names NaN reaching the invoice as the headline risk, and this is
// the one live path that produces it. If this block goes red a single bad
// per-day price row does not just misprice its own day — it destroys the
// rental total, which renders as "$NaN" and reaches Stripe as a non-number.
describe("surcharge maths — a manual per-day price that is not a number", () => {
  // Three days: 2026-03-01, 03-02, 03-03 (dropoff 03-04 is not priced).
  const FROM = "2026-03-01";
  const TO = "2026-03-04";

  it("charges 100.00 x 3 = 300.00 when no manual prices are set", () => {
    // Control. weekendConfig null, so all three days are regular.
    const r = calculateRentalPriceBreakdown(FROM, TO, DAILY_100, null, [], [], "v1");
    expect(r.rentalDays).toBe(3);
    expect(r.rentalPrice).toBe(300.0);
  });

  it("returns NaN as the whole rental price when one day's manual price is the string 'abc'", () => {
    // DEFECT PIN. :444 coerces with Number() — deliberately, because PostgREST
    // hands numeric columns back as JSON strings (the comment at :442-443 says
    // so) — but Number('abc') is NaN, and the guard at :180 is a null-check:
    // `NaN != null` is TRUE, so the manual branch is taken with effectiveRate
    // NaN. :468 accumulates it and :470 rounds it, both preserving NaN.
    const r = calculateRentalPriceBreakdown(
      FROM, TO, DAILY_100, null, [], [], "v1", 30, false, false,
      [{ date: "2026-03-02", price: "abc" as unknown as number }],
    );
    expect(Number.isNaN(r.rentalPrice)).toBe(true);
    // One bad row, not one bad day: the other two days priced perfectly.
    expect(r.dayBreakdown[0].effectiveRate).toBe(100.0);
    expect(r.dayBreakdown[2].effectiveRate).toBe(100.0);
    expect(r.dayBreakdown[1].type).toBe("manual");
    expect(Number.isNaN(r.dayBreakdown[1].effectiveRate)).toBe(true);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:180 is fixed
  it.fails("should ignore a manual price that is not a finite number and fall back to the tier rate, giving 100.00 x 3 = 300.00", () => {
    const r = calculateRentalPriceBreakdown(
      FROM, TO, DAILY_100, null, [], [], "v1", 30, false, false,
      [{ date: "2026-03-02", price: "abc" as unknown as number }],
    );
    expect(Number.isFinite(r.rentalPrice)).toBe(true);
    expect(r.rentalPrice).toBe(300.0);
  });

  it("prices a day at 0.00 when its manual price is null, silently dropping a third of a three-day rental", () => {
    // DEFECT PIN — and be honest about reachability: vehicle_daily_prices.price
    // is NOT NULL (20260719110000_add_vehicle_daily_prices.sql:13), so a null
    // cannot come from that table. This is a LATENT-INPUT pin, not an observed
    // production failure: the array is assembled by the caller
    // (apps/portal/src/lib/fleet-quote.ts, apps/booking/.../vehicles/page.tsx),
    // and a joined or projected row missing its price field lands here as null
    // or undefined.
    //   Number(null) = 0, stored at :444; `0 != null` is TRUE at :180, so the
    //   manual branch is taken with effectiveRate 0.00.
    //   100.00 + 0.00 + 100.00 = 200.00 against the control's 300.00.
    const r = calculateRentalPriceBreakdown(
      FROM, TO, DAILY_100, null, [], [], "v1", 30, false, false,
      [{ date: "2026-03-02", price: null as unknown as number }],
    );
    expect(r.rentalPrice).toBe(200.0);
    expect(r.dayBreakdown[1].type).toBe("manual");
    expect(r.dayBreakdown[1].effectiveRate).toBe(0);
  });

  it("does honour a numeric string, so the Number() coercion at :444 is doing its intended job", () => {
    // The coercion is not the defect — this is what it exists for.
    // 100.00 + 120.50 + 100.00 = 320.50
    const r = calculateRentalPriceBreakdown(
      FROM, TO, DAILY_100, null, [], [], "v1", 30, false, false,
      [{ date: "2026-03-02", price: "120.50" as unknown as number }],
    );
    expect(r.rentalPrice).toBe(320.5);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:444 is fixed
  it.fails("should ignore a null manual price rather than pricing the day free, giving 100.00 x 3 = 300.00", () => {
    const r = calculateRentalPriceBreakdown(
      FROM, TO, DAILY_100, null, [], [], "v1", 30, false, false,
      [{ date: "2026-03-02", price: null as unknown as number }],
    );
    expect(r.rentalPrice).toBe(300.0);
  });
});

// ── 8. Overrides are not matched against the vehicle ───────────────────────

// @usecase Override filtering is left entirely to each caller and the callers
// do it inconsistently. If this block goes red, one caller fetching overrides
// tenant-wide instead of per-vehicle — the natural thing to do on a fleet
// screen — prices every car in the fleet at the first car's override.
describe("surcharge maths — an override belonging to a different vehicle", () => {
  it("applies a 5.00 fixed price from an override whose vehicle_id is 'OTHER' to vehicle 'v1'", () => {
    // DEFECT PIN. The VehicleOverride interface carries vehicle_id (:46) but
    // neither lookup uses it: :262-264 matches on rule_type + holiday_id, and
    // :323 on rule_type alone. The string `vehicle_id` does not appear anywhere
    // between :161 and :380 (verified). The vehicleId argument (:167) is used
    // only by findMatchingHoliday's excluded_vehicle_ids check at :121.
    //   Expected from v1's own config: 100.00 x 1.20 = 120.00
    //   Actual: the foreign vehicle's flat 5.00
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [],
      [override({
        id: "o1", vehicle_id: "OTHER", rule_type: "weekend",
        override_type: "fixed_price", fixed_price: 5,
      })],
      "v1",
    );
    expect(r.rentalPrice).toBe(5.0);
    expect(r.dayBreakdown[0].type).toBe("weekend");
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:323 is fixed
  it.fails("should ignore an override whose vehicle_id does not match the vehicleId argument, giving 100.00 x 1.20 = 120.00", () => {
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [],
      [override({
        id: "o1", vehicle_id: "OTHER", rule_type: "weekend",
        override_type: "fixed_price", fixed_price: 5,
      })],
      "v1",
    );
    expect(r.rentalPrice).toBe(120.0);
  });
});

// ── 9. Duplicate weekend overrides: whichever row comes first wins ──────────

// @usecase PostgREST returns rows in planner order without an explicit ORDER
// BY. If this block goes red the same vehicle on the same Saturday prices at
// 110.00 or 180.00 run to run, and "quoted X, charged Y" has no explanation
// anyone can reconstruct.
describe("surcharge maths — two weekend overrides on the same vehicle", () => {
  // The DB does not prevent this. vpo_holiday_id_for_holiday
  // (20260218120000_add_dynamic_pricing.sql:80) forces holiday_id to be NULL on
  // every weekend row, and a plain Postgres UNIQUE treats NULLs as distinct
  // (no NULLS NOT DISTINCT here), so the UNIQUE at :83 is vacuous for weekend
  // rows — a vehicle may hold any number of them.
  const pct10 = override({ id: "oA", rule_type: "weekend", override_type: "custom_percent", custom_percent: 10 });
  const pct80 = override({ id: "oB", rule_type: "weekend", override_type: "custom_percent", custom_percent: 80 });

  const priceWith = (overrides: VehicleOverride[]) =>
    calculateRentalPriceBreakdown(SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20, [], overrides, "v1").rentalPrice;

  it("charges 100.00 x 1.10 = 110.00 when the 10% override is first in the array", () => {
    // DEFECT PIN (half one). `overrides.find(o => o.rule_type === 'weekend')`
    // at :323 takes the first match; there is no tie-break and no ordering.
    expect(priceWith([pct10, pct80])).toBe(110.0);
  });

  it("charges 100.00 x 1.80 = 180.00 for the same two rows in the opposite order", () => {
    // DEFECT PIN (half two). Same vehicle, same day, same data, 70.00 apart.
    expect(priceWith([pct80, pct10])).toBe(180.0);
    expect(priceWith([pct80, pct10]) - priceWith([pct10, pct80])).toBe(70.0);
  });

  // Remove the .fails marker once apps/portal/src/lib/calculate-rental-price.ts:323 is fixed
  it.fails("should not let array order decide the price — the two orderings should agree", () => {
    expect(priceWith([pct10, pct80])).toBe(priceWith([pct80, pct10]));
  });
});

// ── 10. pricingTier 'monthly' with no monthly discount in the number ────────

// @usecase rentals.monthly_amount is written from this path and the auto-extend
// job re-bills from it. If this block goes red someone has changed either the
// label or the number — and the two currently contradict each other, so
// whoever touches it must decide which one they meant.
describe("surcharge maths — the reported tier versus the price when manual per-day prices are set", () => {
  const FROM = "2026-03-01";
  const TO = "2026-03-31"; // 30 days -> monthly tier

  // 100.00 on every one of the 30 priced days, Mar 1 .. Mar 30.
  const manualEveryDay = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, "0")}`,
    price: 100.0,
  }));

  it("charges the monthly rent of 2000.00 with no manual prices set", () => {
    // Control. 2000.00 / 30 = 66.666... a day, x 30 = 2000.00, rounded once.
    const r = calculateRentalPriceBreakdown(FROM, TO, MONTHLY_2000, null, [], [], "v1", 30);
    expect(r.pricingTier).toBe("monthly");
    expect(r.rentalPrice).toBe(2000.0);
  });

  it("reports pricingTier 'monthly' while charging 100.00 x 30 = 3000.00, 50% above the monthly rate itself", () => {
    // UNCOVERED BEHAVIOUR, pinned rather than judged. The tier is chosen from
    // the DAY COUNT alone at :474, before any day is priced, and runDayLoop's
    // per-day tier rate is then discarded for every day carrying a manual price
    // (:174-190). So the label says "monthly" and the number carries no monthly
    // discount at all.
    //   monthly rate 2000.00 vs manual 100.00 x 30 = 3000.00 (+1000.00)
    const r = calculateRentalPriceBreakdown(
      FROM, TO, MONTHLY_2000, null, [], [], "v1", 30, false, false, manualEveryDay,
    );
    expect(r.pricingTier).toBe("monthly");
    expect(r.rentalPrice).toBe(3000.0);
    expect(r.dayBreakdown.every(d => d.type === "manual")).toBe(true);
  });

  it("still charges the unrounded tier rate on the 29 days a manual price does not cover", () => {
    // Mixed case. 29 tier days at 2000/30 = 66.666666... plus one manual 100.00:
    //   29 x (2000/30) = 58000/30 = 1933.333333...
    //   1933.333333... + 100.00 = 2033.333333...  -> rounded once = 2033.33
    // Note the tier days are NOT rounded per-day here (default path, :371-379),
    // which is why this is 2033.33 and not 29 x 66.67 + 100 = 2033.43.
    const r = calculateRentalPriceBreakdown(
      FROM, TO, MONTHLY_2000, null, [], [], "v1", 30, false, false,
      [{ date: "2026-03-15", price: 100.0 }],
    );
    expect(r.rentalPrice).toBe(2033.33);
    expect(r.dayBreakdown.filter(d => d.type === "manual")).toHaveLength(1);
  });
});

// ── 11. The browse price and the checkout price disagree ───────────────────

// @usecase The customer browses, sees a price, clicks through and is charged a
// different one. If this block goes red a caller has dropped a pricing input
// again — nothing else in the suite compares two call sites' argument lists.
describe("surcharge maths — the vehicle-list call site versus the checkout call site", () => {
  const weekendFlat60 = override({
    id: "o1", rule_type: "weekend", override_type: "fixed_price", fixed_price: 60,
  });

  // The two argument lists, reproduced verbatim from source. The ONLY
  // difference is the sixth argument, `overrides`:
  //   apps/booking/src/app/booking/vehicles/page.tsx:311-320  passes `[]`, with
  //     the omission written into the source as a comment at :313-314.
  //   apps/booking/src/app/booking/checkout/page.tsx:225-232  passes
  //     `vehicleOverrides` at :227.
  const listPagePrice = () => calculateRentalPriceBreakdown(
    SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20,
    [],            // holidays
    [],            // vehicles/page.tsx:315 — overrides deliberately not fetched
    "v1", 30, false, false, [],
  ).rentalPrice;

  const checkoutPrice = () => calculateRentalPriceBreakdown(
    SAT, SUN_AFTER_SAT, DAILY_100, WEEKEND_20,
    [],                 // holidays
    [weekendFlat60],    // checkout/page.tsx:227 — vehicleOverrides
    "v1", 30, false, false, [],
  ).rentalPrice;

  it("shows 100.00 x 1.20 = 120.00 on the vehicle list, because the list page passes an empty override array", () => {
    // DEFECT PIN (half one).
    expect(listPagePrice()).toBe(120.0);
  });

  it("charges the override's flat 60.00 at checkout for the same vehicle and the same dates", () => {
    // DEFECT PIN (half two). 120.00 browsed, 60.00 charged — 60.00 apart, and
    // an override pointing the other way would make checkout the dearer screen.
    expect(checkoutPrice()).toBe(60.0);
    expect(listPagePrice() - checkoutPrice()).toBe(60.0);
  });

  // Remove the .fails marker once apps/booking/src/app/booking/vehicles/page.tsx:315 is fixed
  it.fails("should quote the same price on the list page as at checkout", () => {
    expect(listPagePrice()).toBe(checkoutPrice());
  });
});

// ── 12. The stacking toggle is dead unless a weekend percentage is set ─────

// @usecase A tenant who runs holiday surcharges but no weekend surcharge can
// switch stacking on, see it saved, and get no change at all. If this block
// goes red, the setting has either started working or stopped — and the day it
// starts working is also the day the rounding regime changes for every rental
// (see the stacking-rounding block above).
describe("surcharge maths — the tenant stacking flag when the weekend surcharge is zero", () => {
  // Every call site builds weekendConfig this way. Verbatim shape from
  // apps/booking/src/app/booking/checkout/page.tsx:214-216; identical at
  // vehicles/page.tsx:300-302, MultiStepBookingWidget.tsx:1315-1317, :2184-2186
  // and :2250-2252, and in hook form at
  // apps/booking/src/hooks/use-extension-pricing.ts:107-114 and
  // apps/portal/src/hooks/use-extension-pricing.ts:131-137.
  // All of them then pass `false` as the explicit stackSurcharges argument
  // (checkout/page.tsx:231), so weekendConfig.stack_surcharges is the ONLY
  // route into the stacking path.
  const buildWeekendConfig = (tenant: {
    weekend_surcharge_percent: number;
    weekend_days?: number[];
    stack_surcharges?: boolean;
  }): TenantWeekendConfig | null =>
    (tenant.weekend_surcharge_percent && tenant.weekend_surcharge_percent > 0)
      ? {
          weekend_surcharge_percent: tenant.weekend_surcharge_percent,
          weekend_days: tenant.weekend_days || [6, 0],
          stack_surcharges: tenant.stack_surcharges ?? false,
        }
      : null;

  const bigHoliday = holiday({ id: "h1", name: "Peak", surcharge_percent: 50 });

  it("builds a null weekend config, discarding the stacking flag with it, when weekend_surcharge_percent is zero", () => {
    // DEFECT PIN, the mechanism. The whole object — stack_surcharges included —
    // is replaced by null, so :434's `Boolean(weekendConfig?.stack_surcharges)`
    // can never see it.
    expect(buildWeekendConfig({ weekend_surcharge_percent: 0, stack_surcharges: true })).toBeNull();
  });

  it("prices the holiday day on the priority path with no appliedSurcharges, even though the tenant has stacking switched on", () => {
    // DEFECT PIN. 100.00 x (1 + 50/100) = 150.00 — correct for this single
    // holiday, but arrived at through the WRONG path: appliedSurcharges is
    // undefined, which is the default path's signature (:303-313 never sets it).
    const cfg = buildWeekendConfig({ weekend_surcharge_percent: 0, stack_surcharges: true });
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, cfg, [bigHoliday], [], "v1", 30, false, false,
    );
    expect(r.rentalPrice).toBe(150.0);
    expect(r.dayBreakdown[0].appliedSurcharges).toBeUndefined();
  });

  it("does engage stacking for the same tenant the moment a weekend percentage above zero is saved", () => {
    // Control. 100.00 x (1 + (50 + 20)/100) = 100.00 x 1.70 = 170.00
    const cfg = buildWeekendConfig({ weekend_surcharge_percent: 20, stack_surcharges: true });
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, cfg, [bigHoliday], [], "v1", 30, false, false,
    );
    expect(r.rentalPrice).toBe(170.0);
    expect(r.dayBreakdown[0].appliedSurcharges).toHaveLength(2);
  });

  // Remove the .fails marker once apps/booking/src/app/booking/checkout/page.tsx:214 is fixed
  it.fails("should honour stack_surcharges independently of weekend_surcharge_percent", () => {
    const cfg = buildWeekendConfig({ weekend_surcharge_percent: 0, stack_surcharges: true });
    const r = calculateRentalPriceBreakdown(
      SAT, SUN_AFTER_SAT, DAILY_100, cfg, [bigHoliday], [], "v1", 30, false, false,
    );
    expect(Array.isArray(r.dayBreakdown[0].appliedSurcharges)).toBe(true);
  });
});

// ── 13. Surcharges apply on weekly and monthly tiers too ───────────────────

// @usecase REGRESSION GUARD on behaviour that is correct today and entirely
// unprotected. The migration that created the feature says "Only applies to
// daily tier (<7 days)" (20260218120000_add_dynamic_pricing.sql:3); the engine
// as shipped applies surcharges on all three tiers (:385-391, :474-480). Every
// test in 01 passes null/[] for the surcharge inputs, so the suite would stay
// fully green if someone read that comment and "restored" the restriction —
// quietly removing 240.00 from the weekly rental below and 1080.00 from the
// monthly one. If this block goes red, that is what happened.
describe("surcharge maths — weekend surcharges on the weekly and monthly tiers", () => {
  it("charges 5 x 100.00 + 2 x 120.00 = 740.00 for a seven-day weekly-tier rental spanning two weekend days", () => {
    // 2026-03-01 (Sun) -> 2026-03-08 is 7 days: Mar 1..Mar 7.
    // weekly_rent 700.00 / 7 = 100.00 per day.
    // Weekend days in range: Mar 1 (Sun, 0) and Mar 7 (Sat, 6) = 2.
    //   5 x 100.00 = 500.00
    //   2 x 100.00 x 1.20 = 2 x 120.00 = 240.00
    //   500.00 + 240.00 = 740.00
    const r = calculateRentalPriceBreakdown(
      "2026-03-01", "2026-03-08", WEEKLY_700, WEEKEND_20, [], [], "v1", 30,
    );
    expect(r.rentalDays).toBe(7);
    expect(r.pricingTier).toBe("weekly");
    expect(r.rentalPrice).toBe(740.0);
    expect(r.dayBreakdown.filter(d => d.type === "weekend")).toHaveLength(2);
  });

  it("charges 21 x 100.00 + 9 x 120.00 = 3180.00 for a thirty-day monthly-tier rental spanning nine weekend days", () => {
    // 2026-03-01 -> 2026-03-31 is 30 days: Mar 1..Mar 30.
    // monthly_rent 3000.00 / 30 = 100.00 per day.
    // Weekend days: Sundays Mar 1, 8, 15, 22, 29 (5) + Saturdays Mar 7, 14, 21,
    // 28 (4) = 9. Mar 30 is a Monday, so Mar 31 is excluded anyway.
    //   21 x 100.00 = 2100.00
    //    9 x 120.00 = 1080.00
    //   2100.00 + 1080.00 = 3180.00
    const r = calculateRentalPriceBreakdown(
      "2026-03-01", "2026-03-31", MONTHLY_3000, WEEKEND_20, [], [], "v1", 30,
    );
    expect(r.rentalDays).toBe(30);
    expect(r.pricingTier).toBe("monthly");
    expect(r.rentalPrice).toBe(3180.0);
    expect(r.dayBreakdown.filter(d => d.type === "weekend")).toHaveLength(9);
  });
});

// ── 14. A recurring holiday that wraps the new year ────────────────────────

// @usecase REGRESSION GUARD on the highest-revenue week of the year. The match
// is a hand-rolled month*100+day integer comparison with an inverted branch for
// wrapping ranges (:133-140) — exactly the shape someone "simplifies" into a
// plain range check, which would stop charging the Christmas surcharge from
// Dec 20 to Dec 31 while still charging it Jan 1 to Jan 5. Nothing else in the
// suite executes findMatchingHoliday at all.
describe("surcharge maths — a recurring holiday whose range crosses December into January", () => {
  // Stored across two calendar years because the DB forces it:
  // tenant_holidays_end_after_start CHECK (end_date >= start_date)
  // (20260218120000_add_dynamic_pricing.sql:33) makes a same-year
  // Dec 20 -> Jan 5 row impossible. The month/day keying is what makes the
  // two-year row recur correctly. startKey 1220, endKey 105, so 1220 <= 105 is
  // false and the wrap branch `currentKey >= 1220 || currentKey <= 105` runs.
  const xmasRange: Holiday = holiday({
    id: "hx", name: "Christmas", start_date: "2025-12-20", end_date: "2026-01-05",
    surcharge_percent: 50, recurs_annually: true,
  });

  // Deliberately evaluated in 2027/2028 — LATER than the stored year — so the
  // test proves recurrence, not an accidental literal-date match.
  const dayPrice = (from: string, to: string) =>
    calculateRentalPriceBreakdown(from, to, DAILY_100, null, [xmasRange], [], "v1");

  it("leaves 2027-12-19 at the bare 100.00, one day before the range opens", () => {
    // currentKey 1219: not >= 1220, not <= 105 -> no match.
    const r = dayPrice("2027-12-19", "2027-12-20");
    expect(r.rentalPrice).toBe(100.0);
    expect(r.dayBreakdown[0].type).toBe("regular");
  });

  it("charges 100.00 x 1.50 = 150.00 on 2027-12-20, the inclusive opening edge", () => {
    const r = dayPrice("2027-12-20", "2027-12-21");
    expect(r.rentalPrice).toBe(150.0);
    expect(r.dayBreakdown[0].type).toBe("holiday");
    expect(r.dayBreakdown[0].holidayName).toBe("Christmas");
  });

  it("charges 100.00 x 1.50 = 150.00 on 2027-12-25, mid-range and before the year rolls over", () => {
    expect(dayPrice("2027-12-25", "2027-12-26").rentalPrice).toBe(150.0);
  });

  it("charges 100.00 x 1.50 = 150.00 on 2028-01-05, the inclusive closing edge on the far side of the new year", () => {
    // currentKey 105 <= 105 -> match, via the second half of the wrap branch.
    const r = dayPrice("2028-01-05", "2028-01-06");
    expect(r.rentalPrice).toBe(150.0);
    expect(r.dayBreakdown[0].type).toBe("holiday");
  });

  it("leaves 2028-01-06 at the bare 100.00, one day after the range closes", () => {
    const r = dayPrice("2028-01-06", "2028-01-07");
    expect(r.rentalPrice).toBe(100.0);
    expect(r.dayBreakdown[0].type).toBe("regular");
  });

  it("still matches a recurring range that does not wrap, proving the month*100+day key stays monotonic within a year", () => {
    // Control: Nov 25 -> Dec 2. startKey 1125, endKey 1202, 1125 <= 1202 so the
    // plain range branch runs. Dec 1 -> currentKey 1201, inside.
    // 100.00 x 1.50 = 150.00
    const nov: Holiday = holiday({
      id: "hn", name: "Thanksgiving Week", start_date: "2025-11-25",
      end_date: "2025-12-02", surcharge_percent: 50, recurs_annually: true,
    });
    const r = calculateRentalPriceBreakdown(
      "2027-12-01", "2027-12-02", DAILY_100, null, [nov], [], "v1",
    );
    expect(r.rentalPrice).toBe(150.0);
    expect(r.dayBreakdown[0].type).toBe("holiday");
  });
});
