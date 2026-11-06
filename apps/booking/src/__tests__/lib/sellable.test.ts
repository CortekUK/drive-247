/** Sheet 4.5 and 4.15: a car with nothing to sell is not offered online. */
import { describe, expect, it } from "vitest";
import { isSellableOnline } from "../../northwind-site/lib/vehicles/sellable";

const car = (over = {}) => ({ dailyRent: 50, availableDaily: true, availableWeekly: true, availableMonthly: true, ...over });

describe("isSellableOnline", () => {
  it("offers a priced car with a hire length on", () => {
    expect(isSellableOnline(car())).toBe(true);
    expect(isSellableOnline(car({ availableDaily: false, availableMonthly: false }))).toBe(true);
  });
  it("hides a car with a daily rate of 0 or none", () => {
    expect(isSellableOnline(car({ dailyRent: 0 }))).toBe(false);
    expect(isSellableOnline(car({ dailyRent: null }))).toBe(false);
  });
  it("hides a car with every hire length off", () => {
    expect(isSellableOnline(car({ availableDaily: false, availableWeekly: false, availableMonthly: false }))).toBe(false);
  });
});
