/** Sheet 4.5 and 4.15: a car with nothing to sell is not offered online. */
import { describe, expect, it } from "vitest";
import { certificatesExpired, isSellableOnline } from "../../northwind-site/lib/vehicles/sellable";

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

describe("certificatesExpired (sheet 9.5, 9.6)", () => {
  const now = new Date(2026, 10, 6);
  it("is true once the inspection or the registration date has passed", () => {
    expect(certificatesExpired({ mot_due_date: "2026-11-01", tax_due_date: null }, now)).toBe(true);
    expect(certificatesExpired({ mot_due_date: null, tax_due_date: "2026-11-05" }, now)).toBe(true);
  });
  it("is false for today, the future, or no date", () => {
    expect(certificatesExpired({ mot_due_date: "2026-11-06", tax_due_date: "2027-01-01" }, now)).toBe(false);
    expect(certificatesExpired({ mot_due_date: null, tax_due_date: null }, now)).toBe(false);
  });
  it("hides an expired car from booking", () => {
    expect(isSellableOnline(car({ certificatesExpired: true }))).toBe(false);
  });
});
