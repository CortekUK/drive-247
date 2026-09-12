/**
 * THE SIMPLE-RENTAL INVOICE — Layer 3 maths plus a Layer 1 contract on the
 * composition. No network.
 *
 * The team lead's spine, in his order: rental create -> car -> customer ->
 * dates+times -> MATH -> extras -> insurance -> deposit -> agreement -> payment.
 * 01-pricing-maths.test.ts covers dates and the base rate. This file covers the
 * three things he added by name — extras ("100% you have to consider extras"),
 * insurance ("if he took Bonzah, if he didn't, then what's the scene?") and the
 * deposit ("that's also a payment") — and how they COMPOSE into one total.
 *
 * ---------------------------------------------------------------------------
 * WHY HALF OF THIS IS A SOURCE-TEXT TEST AND NOT A UNIT TEST
 *
 * The composition is not a pure function. It lives in a React component,
 * apps/booking/src/components/BookingCheckoutStep.tsx, as a set of closures over
 * component state (calculateTaxAmount, calculateServiceFee,
 * calculateSecurityDeposit, calculateGrandTotal). It cannot be imported here and
 * re-implementing it in the test would be VACUOUS — the test and the code would
 * move together and a broken change would stay green.
 *
 * So the composition is asserted the way this repo already asserts edge-function
 * contracts (tests/helpers/edge-contract.ts) and the Bonzah rate card
 * (tests/integrations/bonzah/rate-card.ts): by reading the shipped SOURCE TEXT
 * and asserting its structure. That catches the change that actually happens in
 * practice — somebody widens the tax base, or adds a ninth term to the total.
 *
 * The arithmetic that IS pure (base rate, extras, Bonzah premium) is executed for
 * real, against expected values derived by hand and written as literals.
 * ---------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateRentalPriceBreakdown, type VehicleRates } from "../../../apps/portal/src/lib/calculate-rental-price";
import { calcExtrasTotal, extraLineTotal } from "../../../apps/portal/src/lib/calculate-extras-total";
import { readPremiumModel } from "../../integrations/bonzah/rate-card";

// ---------------------------------------------------------------------------
// The scenario, fixed once so every number below is traceable to it.
// A 3-day daily-tier rental — the team lead's "dirtiest, most basic example".
// ---------------------------------------------------------------------------

const CARD: VehicleRates = { daily_rent: 89.0, weekly_rent: 525.0, monthly_rent: 1950.0 };
const PICKUP = "2026-03-01";
const RETURN = "2026-03-04"; // exclusive end -> 3 days
const DAYS = 3;

/** Extras catalogue. One per-day, one per-trip, so both branches are exercised. */
const EXTRAS = [
  { id: "seat", price: 15.0, billing_type: "per_day" },
  { id: "gps", price: 25.0, billing_type: "per_trip" },
  { id: "unused", price: 99.0, billing_type: "per_day" },
];

/** Tenant money settings, as literals. These live on the tenants row. */
const TAX_PERCENT = 8.5;
const SERVICE_FEE_PERCENT = 5.0;
const GLOBAL_DEPOSIT = 500.0;

// ---------------------------------------------------------------------------
// HAND-DERIVED EXPECTED VALUES. Every one computed on paper from the inputs
// above and the formulas read out of source. None copied from program output.
//
//   base rent        89.00 x 3                      = 267.00
//   extras: seat     15.00 x 1 qty x 3 days          =  45.00
//   extras: gps      25.00 x 1 qty x 1 (per_trip)    =  25.00
//   extras total     45.00 + 25.00                   =  70.00
//   Bonzah CDW       26.95 x 3                       =  80.85
//   tax              267.00 x 8.5%                   =  22.695   <- half a cent
//   service fee      267.00 x 5.0%                   =  13.35
//   deposit (charged) global                         = 500.00
//   delivery                                         =   0.00
//   unlimited mileage                                =   0.00
//
//   GRAND TOTAL  267.00 + 0 + 70.00 + 22.695 + 13.35 + 80.85 + 0 + 500.00
//                = 337.00
//                + 22.695 = 359.695
//                + 13.35  = 373.045
//                + 80.85  = 453.895
//                + 500.00 = 953.895
// ---------------------------------------------------------------------------

const EXPECTED_BASE_RENT = 267.0;
const EXPECTED_EXTRAS_TOTAL = 70.0;
const EXPECTED_BONZAH_CDW = 80.85;
const EXPECTED_TAX = 22.695;
const EXPECTED_SERVICE_FEE = 13.35;
const EXPECTED_GRAND_TOTAL = 953.895;

const CHECKOUT_SRC = readFileSync(
  resolve(__dirname, "../../../apps/booking/src/components/BookingCheckoutStep.tsx"),
  "utf8",
);

// @usecase The anchor figure the rest of the invoice is computed against. If
// this is wrong every proportional term (tax, service fee) is wrong with it.
describe("invoice — the base rent, executed for real", () => {
  it("charges 89.00 x 3 = 267.00 for the three-day daily-tier rental", () => {
    const r = calculateRentalPriceBreakdown(
      PICKUP, RETURN, CARD, null, [], [], undefined, 30, false, false, [],
    );
    expect(r.rentalDays).toBe(DAYS);
    expect(r.pricingTier).toBe("daily");
    expect(r.rentalPrice).toBe(EXPECTED_BASE_RENT);
  });
});

// @usecase Extras are the one line the operator edits most, and per_day versus
// per_trip is a single string comparison away from billing three times too
// much or a third too little.
describe("invoice — extras", () => {
  it("bills a per-day extra once for every rental day: 15.00 x 1 x 3 = 45.00", () => {
    expect(extraLineTotal(15.0, 1, "per_day", DAYS)).toBe(45.0);
  });

  it("bills a per-trip extra exactly once regardless of length: 25.00 x 1 = 25.00", () => {
    expect(extraLineTotal(25.0, 1, "per_trip", DAYS)).toBe(25.0);
    expect(extraLineTotal(25.0, 1, "per_trip", 30)).toBe(25.0);
  });

  it("treats a missing billing_type as per-trip, which is the historical default", () => {
    expect(extraLineTotal(25.0, 1, null, DAYS)).toBe(25.0);
    expect(extraLineTotal(25.0, 1, undefined, DAYS)).toBe(25.0);
  });

  it("bills 'PER_DAY' in the wrong case as a flat per-trip charge, because the check is exact", () => {
    // calculate-extras-total.ts:28 is `billingType === "per_day"`. Any other
    // string, including a differently-cased one, falls to the flat branch. This is
    // pinned because a data-entry mistake in the extras catalogue would silently
    // under-bill rather than error.
    expect(extraLineTotal(15.0, 1, "PER_DAY", DAYS)).toBe(15.0);
    expect(extraLineTotal(15.0, 1, "PER_DAY", DAYS)).not.toBe(45.0);
  });

  it("sums the selected extras to 70.00 and ignores the one not selected", () => {
    const total = calcExtrasTotal({ seat: 1, gps: 1 }, EXTRAS, DAYS);
    expect(total).toBe(EXPECTED_EXTRAS_TOTAL);
  });

  it("skips a zero or negative quantity rather than billing it", () => {
    expect(calcExtrasTotal({ seat: 0, gps: 1 }, EXTRAS, DAYS)).toBe(25.0);
    expect(calcExtrasTotal({ seat: -2, gps: 1 }, EXTRAS, DAYS)).toBe(25.0);
  });

  it("skips a selected id that is not in the catalogue instead of throwing", () => {
    expect(calcExtrasTotal({ ghost: 3, gps: 1 }, EXTRAS, DAYS)).toBe(25.0);
  });

  it("multiplies by quantity: two seats for three days is 15.00 x 2 x 3 = 90.00", () => {
    expect(calcExtrasTotal({ seat: 2 }, EXTRAS, DAYS)).toBe(90.0);
  });

  it("never bills a negative number of days, whatever day count it is handed", () => {
    /**
     * The `Math.max(1, …)` floor at calculate-extras-total.ts:28 is what stops a
     * negative day count producing a NEGATIVE extras line — money owed TO the
     * renter for a child seat.
     *
     * Added after mutation testing: changing that floor to `Math.max(0, …)` did
     * not turn a single test red, because every case covered was non-negative and
     * the two forms are identical there. A negative day count is reachable — the
     * pricing engine tolerates a reversed date range (see 01-pricing-maths) and
     * callers compute day counts independently of it.
     */
    expect(extraLineTotal(15.0, 1, "per_day", -5)).toBe(15.0);
    expect(extraLineTotal(15.0, 1, "per_day", -1)).toBe(15.0);
    expect(calcExtrasTotal({ seat: 1 }, EXTRAS, -5)).toBe(15.0);
    expect(extraLineTotal(15.0, 1, "per_day", -5)).toBeGreaterThan(0);
  });

  it("floors a fractional day count and never bills fewer than one day", () => {
    // days = max(1, floor(Number(rentalDays)) || 1) at calculate-extras-total.ts:28
    expect(extraLineTotal(15.0, 1, "per_day", 2.9)).toBe(30.0); // floor(2.9) = 2
    expect(extraLineTotal(15.0, 1, "per_day", 0)).toBe(15.0);   // 0 -> 1
    expect(extraLineTotal(15.0, 1, "per_day", 0.5)).toBe(15.0); // floor -> 0 -> 1
  });

  it("returns extras unrounded, leaving rounding entirely to the caller", () => {
    // Deliberately no Math.round in the module. 0.1 x 3 in float is 0.30000000000000004.
    const odd = [{ id: "x", price: 0.1, billing_type: "per_day" }];
    expect(calcExtrasTotal({ x: 1 }, odd, 3)).toBe(0.1 * 3);
    expect(calcExtrasTotal({ x: 1 }, odd, 3)).not.toBe(0.3);
  });
});

// @usecase The team lead asked for both paths by name. A declined coverage
// must contribute exactly 0 to the total, not absent and not NaN, because it
// is still a term in the sum.
describe("invoice — Bonzah insurance, both taken and declined", () => {
  const model = readPremiumModel();
  const select = (...on: string[]) =>
    Object.fromEntries(["cdw", "rcli", "sli", "pai"].map((c) => [c, on.includes(c)]));

  it("charges 26.95 x 3 = 80.85 for CDW alone on a three-day rental", () => {
    expect(model.quote(DAYS, select("cdw")).total).toBe(EXPECTED_BONZAH_CDW);
  });

  it("charges nothing at all when the renter declines every coverage", () => {
    // The team lead asked for both: "if he took Bonzah, if he didn't, then what's
    // the scene?" The declined case must be 0, not absent and not NaN — it is a
    // term in the grand total either way.
    const q = model.quote(DAYS, select());
    expect(q.total).toBe(0);
    expect(Number.isNaN(q.total)).toBe(false);
  });

  it("prices all four coverages additively: 80.85 + 69.54 + 60.54 + 20.70 = 231.63", () => {
    // 26.95x3 = 80.85 ; 23.18x3 = 69.54 ; 20.18x3 = 60.54 ; 6.90x3 = 20.70
    expect(model.quote(DAYS, select("cdw", "rcli", "sli", "pai")).total).toBe(231.63);
  });

  it("scales strictly linearly, with no multi-day discount", () => {
    // 26.95 x 1 = 26.95 ; x 3 = 80.85 ; x 6 = 161.70. Exactly 3x and 6x.
    expect(model.quote(1, select("cdw")).total).toBe(26.95);
    expect(model.quote(3, select("cdw")).total).toBe(80.85);
    expect(model.quote(6, select("cdw")).total).toBe(161.7);
  });
});

// @usecase Proves the eight terms compose to the figure a human gets on paper,
// and quantifies what widening the tax base would cost (55.32 on one three-day
// rental).
describe("invoice — the grand total, composed by hand from the real parts", () => {
  it("sums to 953.895 for the scenario at the top of this file", () => {
    const baseRent = calculateRentalPriceBreakdown(
      PICKUP, RETURN, CARD, null, [], [], undefined, 30, false, false, [],
    ).rentalPrice;
    const extras = calcExtrasTotal({ seat: 1, gps: 1 }, EXTRAS, DAYS);
    const insurance = readPremiumModel().quote(DAYS, {
      cdw: true, rcli: false, sli: false, pai: false,
    }).total;

    // Tax and the service fee are percentages of the DISCOUNTED VEHICLE TOTAL
    // only — never of extras, insurance, delivery or the deposit. Asserted
    // structurally against source in the next describe block.
    const tax = baseRent * (TAX_PERCENT / 100);
    const serviceFee = (baseRent * SERVICE_FEE_PERCENT) / 100;

    expect(baseRent).toBe(EXPECTED_BASE_RENT);
    expect(extras).toBe(EXPECTED_EXTRAS_TOTAL);
    expect(insurance).toBe(EXPECTED_BONZAH_CDW);
    expect(tax).toBeCloseTo(EXPECTED_TAX, 10);
    expect(serviceFee).toBeCloseTo(EXPECTED_SERVICE_FEE, 10);

    const grandTotal =
      baseRent + 0 /* delivery */ + extras + tax + serviceFee + insurance + 0 /* mileage */ + GLOBAL_DEPOSIT;

    expect(grandTotal).toBeCloseTo(EXPECTED_GRAND_TOTAL, 10);
  });

  it("would be 55.32 higher if tax were charged on the whole invoice instead of the rent", () => {
    /**
     * The contrast that gives the previous test teeth. If the tax base were widened
     * to include extras, insurance and the deposit:
     *     267.00 + 70.00 + 80.85 + 500.00 = 917.85
     *     917.85 x 8.5% = 78.01725
     *     78.01725 - 22.695 = 55.32225
     * So the narrow base is worth 55.32 on a single three-day rental. This is the
     * kind of change that looks like a tidy-up in review and is a pricing change.
     */
    const wideBase = 267.0 + 70.0 + 80.85 + 500.0;
    expect(wideBase).toBe(917.85);
    const wideTax = wideBase * (TAX_PERCENT / 100);
    expect(wideTax - EXPECTED_TAX).toBeCloseTo(55.32225, 8);
  });

  it("carries a sub-cent residue, because nothing in the chain rounds to cents", () => {
    /**
     * 8.5% of 267.00 is 22.695 — half a cent. Not one function in the composition
     * rounds (verified structurally below), so 953.895 is what reaches
     * invoices.total_amount and rentals.monthly_amount. Rounding happens only when
     * Stripe converts to minor units and when the UI formats.
     *
     * That means the figure ON THE INVOICE and the figure CHARGED can differ by a
     * cent, which is precisely the class of discrepancy that produces an operator
     * dispute ("my calculator said something else").
     */
    const inCents = EXPECTED_GRAND_TOTAL * 100;
    const residue = Math.abs(inCents - Math.round(inCents));
    expect(residue).toBeGreaterThan(0.4); // half a cent of residue
    expect(residue).toBeLessThan(0.6);
  });
});

// @usecase The composition lives in a React component and cannot be imported,
// so its shape is asserted from source. Catches the change that actually
// happens: someone widens the tax base or adds a ninth term.
describe("invoice — the composition contract, read from the shipped source", () => {
  /**
   * Layer 1. These assert the SHAPE of the composition in
   * BookingCheckoutStep.tsx, because it cannot be imported. Each one names the
   * change it is meant to catch.
   */

  it("computes tax on the discounted vehicle total, not on the whole invoice", () => {
    const fn = /calculateTaxAmount\s*=\s*\(\)[^{]*\{([\s\S]*?)\n  \};/.exec(CHECKOUT_SRC);
    expect(fn, "calculateTaxAmount not found — the composition has moved").not.toBeNull();
    const body = fn![1];
    expect(body).toContain("calculateDiscountedVehicleTotal()");
    expect(body).toContain("tax_percentage");
    // The terms that must NOT appear in the tax base.
    for (const forbidden of ["calculateExtrasTotal", "bonzahPremium", "SecurityDeposit", "calculateDeliveryFees"]) {
      expect(body, `tax base must not include ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("computes a percentage service fee on the same narrow base as tax", () => {
    const fn = /calculateServiceFee\s*=\s*\(\)[^{]*\{([\s\S]*?)\n  \};/.exec(CHECKOUT_SRC);
    expect(fn, "calculateServiceFee not found").not.toBeNull();
    const body = fn![1];
    expect(body).toContain("calculateDiscountedVehicleTotal()");
    for (const forbidden of ["calculateExtrasTotal", "bonzahPremium", "SecurityDeposit"]) {
      expect(body, `service fee base must not include ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("builds the grand total from exactly the eight expected terms", () => {
    const fn = /calculateGrandTotal\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n  \};/.exec(CHECKOUT_SRC);
    expect(fn, "calculateGrandTotal not found").not.toBeNull();
    const body = fn![1];
    for (const term of [
      "calculateDiscountedVehicleTotal()",
      "calculateDeliveryFees()",
      "calculateExtrasTotal()",
      "calculateTaxAmount()",
      "calculateServiceFee()",
      "effectiveBonzahPremium",
      "unlimitedMileageTotal",
      "chargedSecurityDeposit()",
    ]) {
      expect(body, `grand total is missing ${term}`).toContain(term);
    }
    // Exactly eight additive terms: seven '+' joining them. Comments must be
    // stripped first — the explanatory comment above the return statement spells
    // the same eight terms out in prose and carries seven '+' of its own.
    const code = body
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const plusCount = (code.match(/\+/g) || []).length;
    expect(plusCount, "the grand total gained or lost a term").toBe(7);
  });

  it("does not round anywhere in the composition, which is why the residue survives", () => {
    const region = CHECKOUT_SRC.slice(
      CHECKOUT_SRC.indexOf("const calculateTaxAmount"),
      CHECKOUT_SRC.indexOf("const isEnquiry"),
    );
    expect(region.length).toBeGreaterThan(200);
    expect(region).not.toContain("Math.round");
    expect(region).not.toContain("toFixed");
  });

  it("excludes the deposit from the total on the HOLD path and includes it on the CHARGED path", () => {
    /**
     * Two deposit models per tenant. On the hold path the deposit is ring-fenced
     * on the card at handover and is not billed, so it must stay OUT of the total;
     * on the charged path it is money owed now and must be IN it. Getting this
     * backwards either double-charges the renter or leaves the deposit permanently
     * outstanding.
     */
    expect(CHECKOUT_SRC).toContain("depositIsCharged = tenant?.deposit_charge_enabled === true");
    expect(CHECKOUT_SRC).toMatch(
      /chargedSecurityDeposit\s*=\s*\(\)\s*=>\s*\(\s*depositIsCharged\s*\?\s*calculateSecurityDeposit\(\)\s*:\s*0\s*\)/,
    );
  });

  it("returns a zero deposit when the operator has turned deposits off entirely", () => {
    const fn = /calculateSecurityDeposit\s*=\s*\(\)[^{]*\{([\s\S]*?)\n  \};/.exec(CHECKOUT_SRC);
    expect(fn, "calculateSecurityDeposit not found").not.toBeNull();
    expect(fn![1]).toContain("security_deposit_enabled === false) return 0");
  });

  it("drops the Bonzah premium to zero once the quote attempt has failed", () => {
    // A failed insurance quote must not leave a stale premium in the total.
    expect(CHECKOUT_SRC).toContain("effectiveBonzahPremium = bonzahQuoteFailed ? 0 : bonzahPremium");
  });
});
