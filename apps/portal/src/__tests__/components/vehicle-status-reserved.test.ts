import { describe, it, expect } from "vitest";
import { resolveVehicleStatus } from "@/components/vehicles/vehicle-status-badge";

/**
 * `vehicles.status` conflates two different facts. It is flipped to 'Rented'
 * the moment a rental row is created -- the portal's New Rental handler does it
 * explicitly "even for pending rentals" -- so a car booked for next week reads
 * "currently rented out" while it is still on the forecourt. An operator finds
 * nobody holding it, decides the booking is a ghost, and asks why the system
 * will not let them re-book the car.
 *
 * The split is derived at READ time. Rewriting the column would move 10 live
 * vehicles across 6 tenants out of 'Rented' and drop fleet-utilisation KPIs by
 * ~20% overnight, and a blanket backfill would also resurrect the one vehicle
 * that is 'Rented' AND is_disposed.
 */
describe("resolveVehicleStatus — Rented vs Reserved", () => {
  const base = {
    status: "Rented",
    is_paused: false,
    available_daily: true,
    available_weekly: true,
    available_monthly: true,
  };

  it("a car someone is actually driving still reads Rented", () => {
    expect(resolveVehicleStatus({ ...base, has_active_rental: true })).toBe("Rented");
  });

  it("a car that is only booked, not collected, reads Reserved", () => {
    expect(resolveVehicleStatus({ ...base, has_active_rental: false })).toBe("Reserved");
  });

  it("BACKWARD COMPATIBILITY: every existing caller omits the signal and is unaffected", () => {
    // The six existing call sites pass the vehicle row alone. If this ever
    // returned 'Reserved', fleet-summary-cards would silently restate the
    // fleet and the utilisation KPI would move without anyone asking for it.
    expect(resolveVehicleStatus(base)).toBe("Rented");
  });

  it("loading (undefined) is not the same as 'no active rental' — no badge flicker", () => {
    expect(resolveVehicleStatus({ ...base, has_active_rental: undefined })).toBe("Rented");
    expect(resolveVehicleStatus({ ...base, has_active_rental: null })).toBe("Rented");
  });

  it("Reserved never overrides Paused — Pause is the operator's own override", () => {
    expect(
      resolveVehicleStatus({ ...base, is_paused: true, has_active_rental: false })
    ).toBe("Paused");
  });

  it("an Available car is untouched by the signal", () => {
    expect(
      resolveVehicleStatus({ ...base, status: "Available", has_active_rental: false })
    ).toBe("Available");
  });

  it("Disposed is never relabelled", () => {
    expect(
      resolveVehicleStatus({ ...base, status: "Disposed", has_active_rental: false })
    ).toBe("Disposed");
  });

  it("matches case-insensitively, because the column is plain text with no CHECK (2 rows hold lowercase 'available')", () => {
    expect(resolveVehicleStatus({ ...base, status: "rented", has_active_rental: false })).toBe("Reserved");
  });

  it("off-sale still wins on an Available car", () => {
    expect(
      resolveVehicleStatus({
        ...base,
        status: "Available",
        available_daily: false,
        available_weekly: false,
        available_monthly: false,
      })
    ).toBe("Unavailable");
  });
});
