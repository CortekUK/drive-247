import { describe, expect, it } from "vitest";
import {
  calculateRentalPriceBreakdown,
  type Holiday,
  type TenantWeekendConfig,
  type VehicleOverride,
} from "@/lib/calculate-rental-price";

// QA P5 (Weekend pricing), 2026-11-11 — Ghulam's rule: weekend and holiday
// surcharges apply only to bookings under 7 days; a weekly or monthly booking
// pays its own price. v2 callers opt in; every other caller is unchanged.
// Answers below are worked out by hand from that rule, not read off the code.

const rates = { daily_rent: 50, weekly_rent: 300, monthly_rent: 1000 };
const weekend: TenantWeekendConfig = { weekend_surcharge_percent: 20, weekend_days: [6, 0] } as TenantWeekendConfig;
const thanksgiving: Holiday = {
  id: "h1",
  name: "Thanksgiving week",
  start_date: "2026-11-24",
  end_date: "2026-11-30",
  surcharge_percent: 25,
  excluded_vehicle_ids: [],
  recurs_annually: true,
};
const fixed70: VehicleOverride = {
  id: "o1",
  vehicle_id: "car",
  rule_type: "weekend",
  holiday_id: null,
  override_type: "fixed_price",
  fixed_price: 70,
  custom_percent: null,
};

const price = (start: string, end: string, under7Only: boolean, holidays: Holiday[] = [], overrides: VehicleOverride[] = []) =>
  calculateRentalPriceBreakdown(start, end, rates, weekend, holidays, overrides, "car", 30, false, false, [], under7Only);

describe("weekend and holiday surcharges only under 7 days (v2)", () => {
  it("7 days Tue 1 -> Tue 8 Dec: the weekly price as it stands, $300.00", () => {
    const r = price("2026-12-01", "2026-12-08", true);
    expect(r.rentalDays).toBe(7);
    expect(r.pricingTier).toBe("weekly");
    expect(r.rentalPrice).toBe(300);
    expect(r.dayBreakdown.every((d) => d.type === "regular")).toBe(true);
  });

  it("6 days Tue 1 -> Mon 7 Dec still pays the weekend: 4 x 50 + 2 x 60 = $320.00", () => {
    expect(price("2026-12-01", "2026-12-07", true).rentalPrice).toBe(320);
  });

  it("3 days Fri 20 -> Mon 23 Nov: 50 + 60 + 60 = $170.00", () => {
    expect(price("2026-11-20", "2026-11-23", true).rentalPrice).toBe(170);
  });

  it("holidays follow the same rule: 7 days over Thanksgiving = $300.00; 2 days in it = 2 x 62.50", () => {
    expect(price("2026-11-24", "2026-12-01", true, [thanksgiving]).rentalPrice).toBe(300);
    expect(price("2026-11-24", "2026-11-26", true, [thanksgiving]).rentalPrice).toBe(125);
  });

  it("a per-car weekend price does not apply to a 7-day booking, but does to a short one", () => {
    expect(price("2026-12-01", "2026-12-08", true, [], [fixed70]).rentalPrice).toBe(300);
    expect(price("2026-11-20", "2026-11-23", true, [], [fixed70]).rentalPrice).toBe(190);
  });

  it("callers that do not opt in keep the old behaviour (every other tenant)", () => {
    expect(price("2026-12-01", "2026-12-08", false).rentalPrice).toBe(317.15);
  });
});
