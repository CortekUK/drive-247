/** Sheet P6: the "Vehicle rental" caption never shows a sum that differs from the amount beside it. */
import { describe, expect, it, vi } from "vitest";

// price-lines imports time-utils through the @nw alias, which this test runner has no map for.
vi.mock("../../northwind-site/components/booking/time-utils", () => ({ formatIsoDateLabel: (s: string) => s }));

import { rentalCaption } from "../../northwind-site/components/booking/price-lines";

const fmt = (n: number) => `$${n.toFixed(2)}`;
type Group = { type: string; label: string; rate: number; days: number; amount: number; startDate: string; endDate: string };
const g = (rate: number, days: number, type = "regular"): Group => ({ type, label: type, rate, days, amount: rate * days, startDate: "2027-02-09", endDate: "2027-02-11" });
const quote = (over: { kind: "dynamic" | "tier"; tier?: string; unitRate?: number; unitLabel?: string; quantity?: number; quantityIsWhole?: boolean; rentalDays: number; groups: Group[]; vehicleTotal: number }) =>
  ({
    vehicleTotal: over.vehicleTotal,
    rentalSummary: {
      kind: over.kind,
      tier: over.tier ?? "daily",
      unitRate: over.unitRate ?? 50,
      unitLabel: over.unitLabel ?? "day",
      quantity: over.quantity ?? over.rentalDays,
      quantityIsWhole: over.quantityIsWhole ?? true,
      rentalDays: over.rentalDays,
      groups: over.groups,
    },
  }) as never;

describe("rentalCaption", () => {
  it("no surcharge: the tier rate, as before", () => {
    expect(rentalCaption(quote({ kind: "tier", rentalDays: 3, groups: [g(50, 3)], vehicleTotal: 150 }), fmt)).toBe("3 days × $50.00");
    expect(rentalCaption(quote({ kind: "tier", tier: "weekly", unitRate: 300, unitLabel: "week", quantity: 1, rentalDays: 7, groups: [g(42.857, 7)], vehicleTotal: 300 }), fmt)).toBe("1 week × $300.00");
    expect(rentalCaption(quote({ kind: "tier", tier: "weekly", unitRate: 300, unitLabel: "week", quantity: 9 / 7, quantityIsWhole: false, rentalDays: 9, groups: [], vehicleTotal: 385.71 }), fmt)).toBe("9 days at the weekly rate");
  });
  it("every day surcharged the same: that day price (holiday 30%: 3 × $65.00 = $195.00)", () => {
    expect(rentalCaption(quote({ kind: "dynamic", rentalDays: 3, groups: [g(65, 3, "holiday")], vehicleTotal: 195 }), fmt)).toBe("3 days × $65.00");
  });
  it("prices differ: only the number of days", () => {
    expect(rentalCaption(quote({ kind: "dynamic", rentalDays: 3, groups: [g(50, 1), g(65, 2, "holiday")], vehicleTotal: 180 }), fmt)).toBe("3 days");
    expect(rentalCaption(quote({ kind: "dynamic", tier: "weekly", unitRate: 300, unitLabel: "week", quantity: 1, rentalDays: 7, groups: [g(42.86, 5), g(49.29, 2, "weekend")], vehicleTotal: 312.88 }), fmt)).toBe("7 days");
  });
});
