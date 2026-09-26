/**
 * The shadow comparison (renewal-shadow.ts): what auto-extend would charge
 * next vs what a renewing plan would, with every difference named. Expected
 * values are hand-derived from auto-extend-rentals' formula with the numbers
 * written out; the plain matching case is scenario S26.
 *
 * Base: end 2026-10-02, weekly ×1, monthly_amount 350.00, discount 16.16 →
 * 333.84; tax 7% → round2(23.3688) = 23.37; fee $5.00 → 36221 cents a week.
 */
import { describe, expect, it } from "vitest";
import { shadowCompare, type AutoExtendSnapshot, type ShadowInputs } from "@fn/_shared/payment-plans/renewal-shadow.ts";

const TENANT = { tax_enabled: true, tax_percentage: 7, service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: 5, service_fee_amount: 0, timezone: "America/New_York" };
const RENTAL: AutoExtendSnapshot = {
  rentalId: "r1",
  enabled: true,
  status: "Active",
  endDate: "2026-10-02",
  monthlyAmount: 350,
  discountApplied: 16.16,
  periodUnit: "Weekly",
  intervalCount: 1,
  exceptions: { moves: {}, skips: [] },
  overrides: {},
  nextChargeAt: "2026-10-02T00:00:00.000Z",
  leadHours: 0,
  chargeCount: 0,
  maxPeriods: null,
  pendingExtensionId: null,
  paused: false,
  chargeMode: "auto_charge",
};
const run = (over: Partial<ShadowInputs> & { rental?: Partial<AutoExtendSnapshot> } = {}) =>
  shadowCompare({
    customerCreditCents: 0,
    rentalCreditCents: 0,
    openBaseChargesCents: 0,
    periods: 2,
    ...over,
    tenant: { ...TENANT, ...(over.tenant ?? {}) },
    rental: { ...RENTAL, ...(over.rental ?? {}) },
  });

describe("shadowCompare", () => {
  it("a tax-inclusive price override: 400.00 → rental round2(400 ÷ 1.07) = 373.83, tax 26.17, no fee; the plan charges 36221 → mismatch, named", () => {
    const res = run({ rental: { overrides: { "2026-10-02": { priceOverride: 400 } } } });
    const r0 = res.rows[0];
    expect([r0.oldEngine.amountCents, r0.oldEngine.breakdown.rentalCents, r0.oldEngine.breakdown.taxCents, r0.oldEngine.breakdown.serviceFeeCents]).toEqual([40000, 37383, 2617, 0]);
    expect(r0.newEngine.amountCents).toBe(36221);
    expect(r0.matches).toBe(false);
    expect(r0.notes.some((n) => n.includes("price override"))).toBe(true);
    expect(r0.notes.some((n) => n.startsWith("Mismatch: the old job would charge $400.00, the plan $362.21"))).toBe(true);
    // the override is keyed by the period's start: week 2 is plain again
    expect(res.rows[1].matches).toBe(true);
  });

  it("extras: a $15.00 child seat → old 36221 + 1500 = 37721; the plan has none → mismatch", () => {
    const r0 = run({ rental: { overrides: { "2026-10-02": { extras: [{ label: "Child seat", amount: 15 }, { label: "zero", amount: 0 }] } } } }).rows[0];
    expect([r0.oldEngine.amountCents, r0.oldEngine.breakdown.extrasCents, r0.newEngine.amountCents, r0.matches]).toEqual([37721, 1500, 36221, false]);
  });

  it("insurance priced at 18865: old 36221 + 18865 = 55086 and no policy; the plan buys one first → same money, matches, with the note", () => {
    const r0 = run({ rental: { overrides: { "2026-10-02": { buyInsurance: true, insuranceCoverage: { cdw: true } } } }, premiums: { "2026-10-02": 18865 } }).rows[0];
    expect([r0.oldEngine.amountCents, r0.newEngine.amountCents, r0.oldEngine.breakdown.insuranceCents, r0.matches]).toEqual([55086, 55086, 18865, true]);
    expect(r0.notes.some((n) => n.includes("buys NO policy"))).toBe(true);
  });

  it("insurance that could not be priced is left out of both sides, and said so", () => {
    const r0 = run({ rental: { overrides: { "2026-10-02": { buyInsurance: true, insuranceCoverage: { cdw: true } } } }, premiums: { "2026-10-02": null } }).rows[0];
    expect([r0.oldEngine.amountCents, r0.newEngine.amountCents]).toEqual([36221, 36221]);
    expect(r0.notes.some((n) => n.includes("could not be priced"))).toBe(true);
  });

  it("credit, same on both sides: 50000 covers week 1 (36221) → 0; week 2 takes 13779 → 36221 − 13779 = 22442; matches", () => {
    const res = run({ customerCreditCents: 50000, rentalCreditCents: 50000 });
    expect(res.rows.map((r) => [r.oldEngine.amountCents, r.oldEngine.breakdown.creditAppliedCents, r.newEngine.amountCents, r.matches])).toEqual([
      [0, 36221, 0, true],
      [22442, 13779, 22442, true],
    ]);
    expect(res.rows[0].notes.some((n) => n.includes("entirely from credit"))).toBe(true);
  });

  it("credit paid first to open base charges: 50000 − 20000 owed on the rental = 30000 for week 1 → 36221 − 30000 = 6221", () => {
    const r0 = run({ customerCreditCents: 50000, rentalCreditCents: 50000, openBaseChargesCents: 20000 }).rows[0];
    expect([r0.oldEngine.amountCents, r0.newEngine.amountCents]).toEqual([6221, 6221]);
  });

  it("credit scope: the customer's 50000 sits on ANOTHER rental → old job 0, plan 36221 → mismatch, and the rental-level note", () => {
    const res = run({ customerCreditCents: 50000, rentalCreditCents: 0 });
    expect([res.rows[0].oldEngine.amountCents, res.rows[0].newEngine.amountCents, res.rows[0].matches]).toEqual([0, 36221, false]);
    expect(res.notes.some((n) => n.startsWith("Credit scope differs"))).toBe(true);
  });

  it("lead hours and a skip: no pointer → 2026-10-02 00:00Z − 6 h = 2026-10-01T18:00Z; week 2's grid 10-09 is skipped → 10-16 − 6 h", () => {
    const res = run({ rental: { nextChargeAt: null, leadHours: 6, exceptions: { skips: ["2026-10-09"], moves: {} } } });
    expect(res.rows.map((r) => [r.oldEngine.dueAt, r.oldEngine.chargeDate])).toEqual([
      ["2026-10-01T18:00:00.000Z", "2026-10-02"],
      ["2026-10-15T18:00:00.000Z", "2026-10-16"],
    ]);
    // money is unchanged — a moved date is a note, not a mismatch
    expect(res.rows.map((r) => r.matches)).toEqual([true, true]);
    expect(res.rows[1].notes.some((n) => n.includes("schedule exception moves"))).toBe(true);
  });

  it("the old pointer differs from its schedule → it charges at the pointer, and says so", () => {
    const r0 = run({ rental: { nextChargeAt: "2026-09-28T00:00:00.000Z" } }).rows[0];
    expect(r0.oldEngine.dueAt).toBe("2026-09-28T00:00:00.000Z");
    expect(r0.notes.some((n) => n.includes("pointer"))).toBe(true);
  });

  it("max periods: 3 charged of 4 → week 1 is the last the old job charges; week 2 stops (no charge, no date), never a match", () => {
    const res = run({ rental: { chargeCount: 3, maxPeriods: 4 } });
    expect(res.rows.map((r) => [r.oldEngine.amountCents, r.oldEngine.dueAt === null, r.matches])).toEqual([
      [36221, false, true],
      [0, true, false],
    ]);
  });

  it("month end: Monthly from 2026-01-31 → addPeriod overflows to 2026-03-03 on both sides, with a note", () => {
    const r0 = run({ rental: { endDate: "2026-01-31", periodUnit: "Monthly", nextChargeAt: null } }).rows[0];
    expect(r0.period).toBe("2026-01-31 → 2026-03-03");
    expect(r0.notes.some((n) => n.startsWith("Month end"))).toBe(true);
  });

  it("rental-level notes: off, paused, a parked week, adjustment credit — and no rows without an end date", () => {
    const res = run({ rental: { enabled: false, paused: true, pendingExtensionId: "ext-9" }, tenant: { ...TENANT, adjustmentCreditEnabled: true } });
    expect(res.notes.map((n) => n.split(" ").slice(0, 3).join(" "))).toEqual(["Auto-extend is off", "Auto-extend is paused:", "A renewal is", "This tenant's old"]);
    expect(run({ rental: { endDate: null } }).rows).toEqual([]);
  });
});
