import { describe, it, expect } from "vitest";
import {
  computeExpenseStats,
  sanitizeTerm,
  csvEscape,
  groupSpendByMonth,
  distributionByCategory,
  distributionByVehicle,
  type ExpenseStatRow,
} from "@/lib/expense-utils";

const row = (over: Partial<ExpenseStatRow>): ExpenseStatRow => ({
  amount: 0,
  vehicle_id: null,
  category: "Other",
  is_recurring: false,
  ...over,
});

describe("computeExpenseStats", () => {
  it("returns zeroed stats for an empty set", () => {
    const s = computeExpenseStats([]);
    expect(s).toEqual({
      total: 0,
      count: 0,
      businessTotal: 0,
      vehicleTotal: 0,
      recurringCount: 0,
      topCategories: [],
    });
  });

  it("splits totals between vehicle and business (null vehicle_id) correctly", () => {
    const rows = [
      row({ amount: 100, vehicle_id: "v1", category: "Repair" }),
      row({ amount: 50, vehicle_id: null, category: "Rent" }),
      row({ amount: 25, vehicle_id: "v2", category: "Tyres" }),
    ];
    const s = computeExpenseStats(rows);
    expect(s.total).toBe(175);
    expect(s.vehicleTotal).toBe(125);
    expect(s.businessTotal).toBe(50);
    expect(s.count).toBe(3);
  });

  it("aggregates and ranks categories by spend (desc)", () => {
    const rows = [
      row({ amount: 30, category: "Fuel" }),
      row({ amount: 70, category: "Rent" }),
      row({ amount: 20, category: "Fuel" }),
    ];
    const s = computeExpenseStats(rows);
    expect(s.topCategories).toEqual([
      { name: "Rent", amount: 70 },
      { name: "Fuel", amount: 50 },
    ]);
  });

  it("counts recurring rows", () => {
    const rows = [
      row({ amount: 10, is_recurring: true }),
      row({ amount: 10, is_recurring: false }),
      row({ amount: 10, is_recurring: true }),
    ];
    expect(computeExpenseStats(rows).recurringCount).toBe(2);
  });

  it("coerces string/null amounts without producing NaN", () => {
    const rows = [
      row({ amount: "40" as unknown as number }),
      row({ amount: null as unknown as number }),
    ];
    const s = computeExpenseStats(rows);
    expect(s.total).toBe(40);
    expect(Number.isNaN(s.total)).toBe(false);
  });
});

describe("sanitizeTerm", () => {
  it("strips PostgREST or() delimiters and trims", () => {
    const out = sanitizeTerm("  kwik, (fit)  ");
    expect(out).not.toMatch(/[,()]/);
    expect(out.startsWith(" ")).toBe(false);
    expect(out.endsWith(" ")).toBe(false);
    expect(out.replace(/\s+/g, " ")).toBe("kwik fit");
  });
  it("leaves plain terms untouched", () => {
    expect(sanitizeTerm("kwik fit")).toBe("kwik fit");
  });
});

describe("csvEscape", () => {
  it("passes through plain values", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
  });
  it("renders null/undefined as empty", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
  it("quotes and escapes values with commas, quotes or newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("groupSpendByMonth", () => {
  it("sums per month and sorts oldest→newest", () => {
    const out = groupSpendByMonth([
      { amount: 100, expense_at: "2026-03-10T09:00:00Z" },
      { amount: 50, expense_at: "2026-01-05T09:00:00Z" },
      { amount: 25, expense_at: "2026-03-22T09:00:00Z" },
    ]);
    expect(out.map((p) => p.key)).toEqual(["2026-01", "2026-03"]);
    expect(out[0]).toMatchObject({ month: "Jan 2026", total: 50 });
    expect(out[1]).toMatchObject({ month: "Mar 2026", total: 125 });
  });

  it("falls back to expense_date and skips invalid/empty dates", () => {
    const out = groupSpendByMonth([
      { amount: 40, expense_date: "2026-02-01" },
      { amount: 10, expense_at: null, expense_date: null },
      { amount: 99, expense_at: "not-a-date" },
    ]);
    expect(out).toEqual([{ key: "2026-02", month: "Feb 2026", total: 40 }]);
  });
});

describe("distributionByCategory", () => {
  it("aggregates by category, desc, with Uncategorised fallback", () => {
    const out = distributionByCategory([
      { amount: 30, category: "Fuel" },
      { amount: 70, category: "Rent" },
      { amount: 20, category: null },
    ]);
    expect(out).toEqual([
      { name: "Rent", value: 70 },
      { name: "Fuel", value: 30 },
      { name: "Uncategorised", value: 20 },
    ]);
  });
});

describe("distributionByVehicle", () => {
  it("keys by reg, falls back to make/model, then Unassigned", () => {
    const out = distributionByVehicle([
      { amount: 90, vehicle: { reg: "AB12 CDE", make: "Toyota", model: "Corolla" } },
      { amount: 60, vehicle: { reg: null, make: "Tesla", model: "Model 3" } },
      { amount: 10, vehicle: null },
    ]);
    expect(out).toEqual([
      { name: "AB12 CDE", value: 90 },
      { name: "Tesla Model 3", value: 60 },
      { name: "Unassigned", value: 10 },
    ]);
  });
});
