/**
 * The car page applies the Add Vehicle form's rules when a field is edited
 * (sheet 3.18–3.21): a missing make, model or plate, or a year outside
 * 1900 to next year, is refused; plates are saved in capitals.
 */
import { describe, expect, it } from "vitest";
import { cleanForSave, vehicleFieldError } from "@/components/vehicles-v2/use-vehicle-record";

const NEXT = new Date().getFullYear() + 1;

describe("refused values", () => {
  it("refuses an empty make, model or plate, spaces included", () => {
    expect(vehicleFieldError("make", "")).toMatch(/Make is required/);
    expect(vehicleFieldError("model", "   ")).toMatch(/Model is required/);
    expect(vehicleFieldError("reg", " ")).toMatch(/plate is required/);
  });

  it("refuses 1899, the year after next, and no year at all", () => {
    expect(vehicleFieldError("year", 1899)).toMatch(/between 1900/);
    expect(vehicleFieldError("year", NEXT + 1)).toMatch(/between 1900/);
    expect(vehicleFieldError("year", null)).toMatch(/between 1900/);
  });

  it("accepts the edges the Add form accepts", () => {
    expect(vehicleFieldError("year", 1900)).toBeNull();
    expect(vehicleFieldError("year", NEXT)).toBeNull();
    expect(vehicleFieldError("reg", "AB12 CDE")).toBeNull();
    expect(vehicleFieldError("colour", "")).toBeNull();
  });
});

describe("what is written", () => {
  it("saves a plate in capitals with no outer spaces", () => {
    expect(cleanForSave("reg", "  ley3145 ")).toBe("LEY3145");
  });

  it("trims names but leaves a description as typed", () => {
    expect(cleanForSave("make", " Toyota ")).toBe("Toyota");
    expect(cleanForSave("description", " Seats 5 ")).toBe(" Seats 5 ");
    expect(cleanForSave("year", 2024)).toBe(2024);
  });
});
