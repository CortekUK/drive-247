/**
 * The extraction of auto-extend's pricing helpers is behaviour-preserving.
 *
 * tests/payment-plans/fixtures/auto-extend-helpers-original.ts is a frozen,
 * verbatim copy of the five functions as they stood in auto-extend-rentals at
 * ad357dd8. Here the extracted module and that copy must be
 *   1. TEXTUALLY identical (function bodies, `export ` aside), and
 *   2. equal over a table of cases chosen to hit every branch — month
 *      overflow, DST dates, leap days, bad counts, skip/move exceptions,
 *      rounding at the half cent, every tax/fee configuration, null/strings.
 * And the two crons must now import them instead of defining their own.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as original from "../fixtures/auto-extend-helpers-original";
import * as extracted from "@fn/_shared/payment-plans/renewal-pricing.ts";
import { REPO_ROOT } from "../harness/pglite";

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** The source of each top-level function, `export ` stripped, keyed by name. */
function functionsOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^(?:export )?function (\w+)\([\s\S]*?\n\}\n/gm;
  for (const m of source.matchAll(re)) out.set(m[1], m[0].replace(/^export /, ""));
  return out;
}

const NAMES = ["addPeriod", "applyExceptions", "round2", "computeBreakdown", "discountedRate"] as const;

describe("the extraction is verbatim", () => {
  const orig = functionsOf(read("tests/payment-plans/fixtures/auto-extend-helpers-original.ts"));
  const mod = read("supabase/functions/_shared/payment-plans/renewal-pricing.ts");
  const verbatim = mod.slice(mod.indexOf("// ---- VERBATIM"), mod.indexOf("// ---- end VERBATIM"));
  const extr = functionsOf(verbatim);

  it.each(NAMES)("%s: same source text", (name) => {
    expect(orig.get(name), `${name} missing from the frozen copy`).toBeTruthy();
    expect(extr.get(name)).toBe(orig.get(name));
  });

  it("the frozen copy is what auto-extend-rentals held at ad357dd8 (it names the source and says it is verbatim)", () => {
    const fixture = read("tests/payment-plans/fixtures/auto-extend-helpers-original.ts");
    expect(fixture).toContain("verbatim from auto-extend-rentals/index.ts @ ad357dd8");
    expect([...orig.keys()].sort()).toEqual([...NAMES].sort());
  });
});

describe("the two crons import the helpers instead of defining them", () => {
  for (const [file, names] of [
    ["supabase/functions/auto-extend-rentals/index.ts", ["addPeriod", "applyExceptions", "computeBreakdown", "discountedRate", "round2"]],
    ["supabase/functions/sandbox-auto-extend-rentals/index.ts", ["addPeriod", "applyExceptions", "computeBreakdown", "round2"]],
  ] as const) {
    it(file, () => {
      const src = read(file);
      for (const n of names) expect(src, `${file} still defines ${n}`).not.toMatch(new RegExp(`^function ${n}\\(`, "m"));
      expect(src).toContain(`import { ${names.join(", ")} } from "../_shared/payment-plans/renewal-pricing.ts";`);
    });
  }
});

/** A call's result, or the error it throws — the originals throw on some inputs, and so must the copies. */
function outcome<T>(fn: () => T): { ok: T } | { threw: string } {
  try {
    return { ok: fn() };
  } catch (e) {
    return { threw: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

describe("same results over a table of cases", () => {
  const dates = ["2026-01-31", "2026-02-28", "2028-02-29", "2026-03-08", "2026-10-02", "2026-11-01", "2026-12-31", "2027-01-29", "2026-05-31"];
  const units = ["Daily", "Weekly", "Monthly", "", "Fortnightly", undefined as unknown as string];
  const counts = [1, 2, 3, 0, -1, 1.7, 52, undefined as unknown as number, NaN];

  it("addPeriod", () => {
    let n = 0;
    for (const d of dates) for (const u of units) for (const c of counts) {
      expect(outcome(() => extracted.addPeriod(d, u, c)), `${d} ${u} ${c}`).toEqual(outcome(() => original.addPeriod(d, u, c)));
      n++;
    }
    expect(n).toBe(dates.length * units.length * counts.length);
  });

  it("applyExceptions", () => {
    const exceptions = [
      null,
      undefined,
      {},
      { skips: [], moves: {} },
      { skips: ["2026-10-09"], moves: {} },
      { skips: ["2026-10-09", "2026-10-16"], moves: { "2026-10-23": "2026-10-24" } },
      // typeof null === "object": both copies throw on moves: null — identically.
      { skips: "2026-10-09", moves: null },
      { moves: { "2026-10-09": "2026-10-11" } },
      { skips: ["2026-10-09"], moves: { "2026-10-16": "2026-10-15" } },
    ];
    for (const ex of exceptions) for (const u of ["Weekly", "Daily", "Monthly"]) for (const c of [1, 2]) {
      for (const g of ["2026-10-09", "2026-10-02", "2026-10-23"]) {
        expect(outcome(() => extracted.applyExceptions(g, u, c, ex)), `${g} ${u} ${c} ${JSON.stringify(ex)}`).toEqual(outcome(() => original.applyExceptions(g, u, c, ex)));
      }
    }
  });

  it("round2", () => {
    for (const v of [0, 0.005, 0.015, 1.005, 2.675, 23.3688, 333.84, -1.005, 1e6 + 0.125, 0.1 + 0.2, 99.995, NaN, Infinity]) {
      expect(Object.is(extracted.round2(v), original.round2(v)), String(v)).toBe(true);
    }
  });

  it("computeBreakdown", () => {
    const tenants = [
      null,
      {},
      { tax_enabled: true, tax_percentage: 7 },
      { tax_enabled: true, tax_percentage: "8.875" },
      { tax_enabled: false, tax_percentage: 7 },
      { tax_enabled: true, tax_percentage: null },
      { service_fee_enabled: true, service_fee_type: "percentage", service_fee_value: 3.5 },
      { service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: 5 },
      { service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: null, service_fee_amount: 12.5 },
      { service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: 0, service_fee_amount: 12.5 },
      { tax_enabled: true, tax_percentage: 7, service_fee_enabled: true, service_fee_type: "percentage", service_fee_value: 2.25 },
    ];
    for (const rate of [0, 333.84, 417.3, 0.01, 99.995, 1234.565, "250" as unknown as number, null as unknown as number, -5]) {
      for (const t of tenants) expect(outcome(() => extracted.computeBreakdown(rate, t)), `${rate} ${JSON.stringify(t)}`).toEqual(outcome(() => original.computeBreakdown(rate, t)));
    }
  });

  it("discountedRate", () => {
    for (const r of [
      { monthly_amount: 350, discount_applied: 16.16 },
      { monthly_amount: 417.3, discount_applied: 83.46 },
      { monthly_amount: 100, discount_applied: 150 },
      { monthly_amount: null, discount_applied: null },
      { monthly_amount: "350" as unknown as number, discount_applied: "16.16" as unknown as number },
      {},
      null as unknown as { monthly_amount?: number },
    ]) {
      expect(outcome(() => extracted.discountedRate(r)), JSON.stringify(r)).toEqual(outcome(() => original.discountedRate(r)));
    }
  });
});

describe("the plan side's cents", () => {
  const tenant = { tax_enabled: true, tax_percentage: 7, service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: 5, service_fee_amount: 0 };

  it("the renewal fixture, by hand: 350.00 − 16.16 = 333.84; tax round2(23.3688) = 23.37; fee 5.00 → 33384 + 2337 + 500 = 36221", () => {
    expect(extracted.renewalBreakdownCents({ monthlyAmount: 350, discountApplied: 16.16, tenant })).toEqual({ rentalCents: 33384, taxCents: 2337, serviceFeeCents: 500, totalCents: 36221 });
  });

  it("RevTek's contract figure: 417.30 − 83.46 = 333.84 → the same 33384 (no tax, no fee)", () => {
    expect(extracted.renewalBreakdownCents({ monthlyAmount: 417.3, discountApplied: 83.46, tenant: { tax_enabled: false, tax_percentage: 0, service_fee_enabled: false, service_fee_type: null, service_fee_value: null, service_fee_amount: null } })).toEqual({
      rentalCents: 33384,
      taxCents: 0,
      serviceFeeCents: 0,
      totalCents: 33384,
    });
  });

  it("the total is the sum of the ledger rows — and equals auto-extend's own round2(total) over a sweep of rates", () => {
    for (let cents = 1; cents <= 200000; cents += 997) {
      const rate = cents / 100;
      const bd = extracted.computeBreakdown(rate, tenant);
      const plan = extracted.renewalBreakdownCents({ monthlyAmount: rate, discountApplied: 0, tenant });
      expect(plan.totalCents, String(rate)).toBe(plan.rentalCents + plan.taxCents + plan.serviceFeeCents);
      expect(plan.totalCents, String(rate)).toBe(extracted.dollarsToCents(bd.total));
    }
  });

  it("a period that costs nothing is refused (auto-extend skips such a rental)", () => {
    expect(() => extracted.renewalBreakdownCents({ monthlyAmount: 10, discountApplied: 10, tenant: { ...tenant, service_fee_enabled: false } })).toThrow(/nothing to renew/);
  });

  it("dollarsToCents is exact where x * 100 is not (0.29, 1.005 after round2, 333.84)", () => {
    expect([extracted.dollarsToCents(0.29), extracted.dollarsToCents(extracted.round2(1.005)), extracted.dollarsToCents(333.84)]).toEqual([29, 101, 33384]);
  });

  it("renewalPeriod dates exactly as addPeriod: a week, a day, and the Monthly overflow (2026-01-31 + 1 month = 2026-03-03)", () => {
    expect(extracted.renewalPeriod("2026-10-02", "week", 1)).toEqual({ periodStart: "2026-10-02", periodEnd: "2026-10-09", days: 7 });
    expect(extracted.renewalPeriod("2026-11-01", "day", 1)).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-02", days: 1 });
    expect(extracted.renewalPeriod("2026-01-31", "month", 1)).toEqual({ periodStart: "2026-01-31", periodEnd: "2026-03-03", days: 31 });
  });
});
