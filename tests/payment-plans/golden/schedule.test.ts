/**
 * Golden table — docs/PAYMENT_PLANS_DESIGN.md §3.1, G1a–G12, as LITERALS.
 *
 * Every expected value below was written from the design table and
 * re-derived independently (by hand, and with a separate Python
 * implementation of the types.ts rules using datetime/zoneinfo). It is NOT
 * produced by schedule.ts. A red test here means schedule.ts / amounts.ts is
 * wrong, or the literal must be re-derived the same way — never "updated to
 * match".
 */
import { describe, expect, it } from "vitest";
import { buildSchedule, PlanRuleError } from "@fn/_shared/payment-plans/schedule.ts";
import type { AmountSpec, OccurrenceDraft, ScheduleRule } from "@fn/_shared/payment-plans/types.ts";

const due = (o: OccurrenceDraft[]) => o.map((x) => x.dueDate);
const amt = (o: OccurrenceDraft[]) => o.map((x) => x.amountCents);
const periods = (o: OccurrenceDraft[]) => o.map((x) => [x.periodStart, x.periodEnd, x.days]);
const stubs = (o: OccurrenceDraft[]) => o.map((x) => x.isStub);
const ANY: AmountSpec = { mode: "fixed", amountCents: 10000 };

/** G1: weekly [Fri], anchor Wed 2026-09-30, until the rental ends 2026-10-28. */
const G1: ScheduleRule = {
  freq: "weekly",
  interval: 1,
  byWeekday: [5],
  anchor: "2026-09-30",
  firstOccurrence: "on_anchor",
  end: { kind: "rental_end", rentalEnd: "2026-10-28" },
};
const G1_DUE = ["2026-09-30", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"];
const G1_PERIODS = [
  ["2026-09-30", "2026-10-02", 2],
  ["2026-10-02", "2026-10-09", 7],
  ["2026-10-09", "2026-10-16", 7],
  ["2026-10-16", "2026-10-23", 7],
  ["2026-10-23", "2026-10-28", 5],
];

describe("§3.1 golden table", () => {
  it("G1a — weekly Fri from a Wednesday, on_anchor stub, fixed 30000", () => {
    const o = buildSchedule(G1, { mode: "fixed", amountCents: 30000 });
    expect(due(o)).toEqual(G1_DUE);
    expect(stubs(o)).toEqual([true, false, false, false, false]);
    expect(amt(o)).toEqual([30000, 30000, 30000, 30000, 30000]);
    expect(o.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("G1a periods — [09-30,10-02) 2d · 7 · 7 · 7 · [10-23,10-28) 5 = 28 days", () => {
    const o = buildSchedule(G1, { mode: "fixed", amountCents: 30000 });
    expect(periods(o)).toEqual(G1_PERIODS);
    expect(o.reduce((s, x) => s + x.days, 0)).toBe(28);
  });

  it("G1b — per_period 5000/day → 10000 · 35000 · 35000 · 35000 · 25000 = 140000", () => {
    const o = buildSchedule(G1, { mode: "per_period", dailyRateCents: 5000 });
    expect(due(o)).toEqual(G1_DUE);
    expect(amt(o)).toEqual([10000, 35000, 35000, 35000, 25000]);
  });

  it("G1c — split_total 140000 → 28000 × 5", () => {
    const o = buildSchedule(G1, { mode: "split_total", totalCents: 140000 });
    expect(amt(o)).toEqual([28000, 28000, 28000, 28000, 28000]);
  });

  it("G1d — split_by_days 140000 → 10000 · 35000 · 35000 · 35000 · 25000", () => {
    const o = buildSchedule(G1, { mode: "split_by_days", totalCents: 140000 });
    expect(amt(o)).toEqual([10000, 35000, 35000, 35000, 25000]);
  });

  it("G1e — same, on_rhythm: 10-02 covers [09-30,10-09) 9d 45000 · 35000 · 35000 · [10-23,10-28) 25000", () => {
    const o = buildSchedule({ ...G1, firstOccurrence: "on_rhythm" }, { mode: "per_period", dailyRateCents: 5000 });
    expect(due(o)).toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"]);
    expect(stubs(o)).toEqual([false, false, false, false]);
    expect(periods(o)).toEqual([
      ["2026-09-30", "2026-10-09", 9],
      ["2026-10-09", "2026-10-16", 7],
      ["2026-10-16", "2026-10-23", 7],
      ["2026-10-23", "2026-10-28", 5],
    ]);
    expect(amt(o)).toEqual([45000, 35000, 35000, 25000]);
    expect(amt(o).reduce((a, b) => a + b, 0)).toBe(140000);
  });

  it("G2 — daily interval 3, count 5, split 100000 → 20000 each; last period [10-12,10-15)", () => {
    const o = buildSchedule(
      { freq: "daily", interval: 3, anchor: "2026-09-30", firstOccurrence: "on_anchor", end: { kind: "count", count: 5 } },
      { mode: "split_total", totalCents: 100000 },
    );
    expect(due(o)).toEqual(["2026-09-30", "2026-10-03", "2026-10-06", "2026-10-09", "2026-10-12"]);
    expect(amt(o)).toEqual([20000, 20000, 20000, 20000, 20000]);
    expect(periods(o)[4]).toEqual(["2026-10-12", "2026-10-15", 3]);
  });

  it("G3 — weekly interval 3 [Thu], until 2026-12-31, split 100000 → 20000 each", () => {
    const o = buildSchedule(
      { freq: "weekly", interval: 3, byWeekday: [4], anchor: "2026-10-01", firstOccurrence: "on_anchor", end: { kind: "until", until: "2026-12-31" } },
      { mode: "split_total", totalCents: 100000 },
    );
    expect(due(o)).toEqual(["2026-10-01", "2026-10-22", "2026-11-12", "2026-12-03", "2026-12-24"]);
    expect(amt(o)).toEqual([20000, 20000, 20000, 20000, 20000]);
  });

  it("G4 — every 2 weeks [Mon], count 4, across DST end 11-01 → 10-05 · 10-19 · 11-02 · 11-16, 25000 each", () => {
    const o = buildSchedule(
      { freq: "weekly", interval: 2, byWeekday: [1], anchor: "2026-10-05", firstOccurrence: "on_anchor", end: { kind: "count", count: 4 } },
      { mode: "split_total", totalCents: 100000 },
    );
    expect(due(o)).toEqual(["2026-10-05", "2026-10-19", "2026-11-02", "2026-11-16"]);
    expect(amt(o)).toEqual([25000, 25000, 25000, 25000]);
  });

  it("G5 — twice a week [Mon, Thu] from a Wednesday, on_rhythm, count 6 → 16666 × 5, 16670", () => {
    const o = buildSchedule(
      { freq: "weekly", interval: 1, byWeekday: [1, 4], anchor: "2026-09-30", firstOccurrence: "on_rhythm", end: { kind: "count", count: 6 } },
      { mode: "split_total", totalCents: 100000 },
    );
    expect(due(o)).toEqual(["2026-10-01", "2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15", "2026-10-19"]);
    expect(amt(o)).toEqual([16666, 16666, 16666, 16666, 16666, 16670]);
  });

  it("G5b — same, on_anchor → a stub on 09-30, and the stub counts toward the 6", () => {
    const o = buildSchedule(
      { freq: "weekly", interval: 1, byWeekday: [1, 4], anchor: "2026-09-30", firstOccurrence: "on_anchor", end: { kind: "count", count: 6 } },
      { mode: "split_total", totalCents: 100000 },
    );
    expect(due(o)).toEqual(["2026-09-30", "2026-10-01", "2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
    expect(stubs(o)[0]).toBe(true);
    // Not a table literal: split_total's own rule applied to 6 occurrences (hand-derived).
    expect(amt(o)).toEqual([16666, 16666, 16666, 16666, 16666, 16670]);
  });

  it("G6 — monthly day 31 from 2027-01-31, count 5: clamps AND returns (31 → 28 → 31 → 30 → 31)", () => {
    const o = buildSchedule(
      { freq: "monthly", interval: 1, byMonthDay: 31, anchor: "2027-01-31", firstOccurrence: "on_anchor", end: { kind: "count", count: 5 } },
      ANY,
    );
    expect(due(o)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  });

  it("G7 — monthly last day (−1) from 2028-01-15, on_rhythm, count 3 → 01-31 · 02-29 (leap) · 03-31", () => {
    const o = buildSchedule(
      { freq: "monthly", interval: 1, byMonthDay: -1, anchor: "2028-01-15", firstOccurrence: "on_rhythm", end: { kind: "count", count: 3 } },
      ANY,
    );
    expect(due(o)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("G8 — weekly [Fri] from a Friday, open through 10-23, fixed 30000 → no stub", () => {
    const o = buildSchedule(
      { freq: "weekly", interval: 1, byWeekday: [5], anchor: "2026-09-25", firstOccurrence: "on_anchor", end: { kind: "open", through: "2026-10-23" } },
      { mode: "fixed", amountCents: 30000 },
    );
    expect(due(o)).toEqual(["2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"]);
    expect(stubs(o)).toEqual([false, false, false, false, false]);
    expect(amt(o)).toEqual([30000, 30000, 30000, 30000, 30000]);
  });

  it("G9 — daily interval 7 from 2026-03-05, count 3, across DST start 03-08 → 03-05 · 03-12 · 03-19", () => {
    const o = buildSchedule(
      { freq: "daily", interval: 7, anchor: "2026-03-05", firstOccurrence: "on_anchor", end: { kind: "count", count: 3 } },
      ANY,
    );
    expect(due(o)).toEqual(["2026-03-05", "2026-03-12", "2026-03-19"]);
  });

  it("G10 — explicit dates [10-10, 10-01, 10-20, 10-10] → sorted, de-duplicated, split 90000 → 30000 each", () => {
    // The design row gives no end kind (types.ts requires one); count 3 is the
    // neutral choice — every listed date is kept.
    const o = buildSchedule(
      { freq: "dates", interval: 1, dates: ["2026-10-10", "2026-10-01", "2026-10-20", "2026-10-10"], anchor: "2026-10-01", firstOccurrence: "on_anchor", end: { kind: "count", count: 3 } },
      { mode: "split_total", totalCents: 90000 },
    );
    expect(due(o)).toEqual(["2026-10-01", "2026-10-10", "2026-10-20"]);
    expect(amt(o)).toEqual([30000, 30000, 30000]);
  });

  it("G11 — every 2 months on the 30th from 2026-12-30, count 3 → 12-30 · 2027-02-28 · 2027-04-30", () => {
    const o = buildSchedule(
      { freq: "monthly", interval: 2, byMonthDay: 30, anchor: "2026-12-30", firstOccurrence: "on_anchor", end: { kind: "count", count: 3 } },
      ANY,
    );
    expect(due(o)).toEqual(["2026-12-30", "2027-02-28", "2027-04-30"]);
  });

  it("G12 — every 2 weeks [Tue, Sun] from Tue 2026-09-29, count 4 → ISO weeks (WKST=MO): 09-29 · 10-04 · 10-13 · 10-18", () => {
    const o = buildSchedule(
      { freq: "weekly", interval: 2, byWeekday: [2, 7], anchor: "2026-09-29", firstOccurrence: "on_anchor", end: { kind: "count", count: 4 } },
      ANY,
    );
    expect(due(o)).toEqual(["2026-09-29", "2026-10-04", "2026-10-13", "2026-10-18"]);
  });
});

describe("§3 overrides — a moved due date keeps its period and amount", () => {
  it("occurrence 2 (Fri 10-02) moved to Mon 10-05 still covers [10-02, 10-09) for the same amount", () => {
    const base = buildSchedule(G1, { mode: "per_period", dailyRateCents: 5000 });
    const moved = buildSchedule(G1, { mode: "per_period", dailyRateCents: 5000 }, [{ seq: 2, moveTo: "2026-10-05" }]);
    expect(moved[1]).toEqual({ ...base[1], dueDate: "2026-10-05" });
    expect(moved[1].periodStart).toBe("2026-10-02");
    expect(moved[1].periodEnd).toBe("2026-10-09");
    expect(moved[1].amountCents).toBe(35000);
    // every other occurrence is untouched
    expect([moved[0], ...moved.slice(2)]).toEqual([base[0], ...base.slice(2)]);
  });
});

describe("§3 validation codes — buildSchedule throws PlanRuleError with .code", () => {
  const code = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(PlanRuleError);
      return (e as PlanRuleError).code;
    }
    return "(no error)";
  };
  const weekly = (over: Partial<ScheduleRule>): ScheduleRule => ({
    freq: "weekly", interval: 1, byWeekday: [5], anchor: "2026-10-02", firstOccurrence: "on_anchor", end: { kind: "count", count: 3 }, ...over,
  });

  it.each([
    ["interval_invalid — interval 0", () => buildSchedule(weekly({ interval: 0 }), ANY), "interval_invalid"],
    ["interval_invalid — interval −1", () => buildSchedule(weekly({ interval: -1 }), ANY), "interval_invalid"],
    ["weekday_required — weekly with []", () => buildSchedule(weekly({ byWeekday: [] }), ANY), "weekday_required"],
    ["weekday_required — weekly with no byWeekday", () => buildSchedule(weekly({ byWeekday: undefined }), ANY), "weekday_required"],
    ["month_day_invalid — 0", () => buildSchedule({ ...weekly({}), freq: "monthly", byWeekday: undefined, byMonthDay: 0 }, ANY), "month_day_invalid"],
    ["month_day_invalid — −2", () => buildSchedule({ ...weekly({}), freq: "monthly", byWeekday: undefined, byMonthDay: -2 }, ANY), "month_day_invalid"],
    ["month_day_invalid — 32", () => buildSchedule({ ...weekly({}), freq: "monthly", byWeekday: undefined, byMonthDay: 32 }, ANY), "month_day_invalid"],
    ["dates_required — dates []", () => buildSchedule({ ...weekly({}), freq: "dates", byWeekday: undefined, dates: [] }, ANY), "dates_required"],
    ["date_before_anchor", () => buildSchedule({ ...weekly({}), freq: "dates", byWeekday: undefined, dates: ["2026-10-01", "2026-10-09"] }, ANY), "date_before_anchor"],
    ["count_invalid — count 0", () => buildSchedule(weekly({ end: { kind: "count", count: 0 } }), ANY), "count_invalid"],
    ["no_occurrences — until before the anchor", () => buildSchedule(weekly({ end: { kind: "until", until: "2026-09-01" } }), ANY), "no_occurrences"],
    ["no_occurrences — rental ends on the anchor", () => buildSchedule(weekly({ end: { kind: "rental_end", rentalEnd: "2026-10-02" } }), ANY), "no_occurrences"],
    ["too_many_occurrences — daily for 600 days", () => buildSchedule({ ...weekly({}), freq: "daily", byWeekday: undefined, end: { kind: "until", until: "2028-05-24" } }, ANY), "too_many_occurrences"],
    ["amount_too_small — 3 cents over 5 payments", () => buildSchedule({ ...weekly({}), end: { kind: "count", count: 5 } }, { mode: "split_total", totalCents: 3 }), "amount_too_small"],
    ["amount_too_small — fixed 0", () => buildSchedule(weekly({}), { mode: "fixed", amountCents: 0 }), "amount_too_small"],
  ] as [string, () => unknown, string][])("%s", (_label, fn, expected) => {
    expect(code(fn)).toBe(expected);
  });

  it("520 occurrences is allowed; 521 is too_many_occurrences (the ceiling is inclusive)", () => {
    const daily = (until: string): ScheduleRule => ({ freq: "daily", interval: 1, anchor: "2026-01-01", firstOccurrence: "on_anchor", end: { kind: "until", until } });
    // 2026-01-01 + 519 days = 2027-06-04 → exactly 520 dates.
    expect(buildSchedule(daily("2027-06-04"), ANY)).toHaveLength(520);
    expect(code(() => buildSchedule(daily("2027-06-05"), ANY))).toBe("too_many_occurrences");
  });
});
