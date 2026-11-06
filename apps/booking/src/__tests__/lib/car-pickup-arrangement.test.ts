/** Sheet 8.2–8.5: a car pinned to a pickup location is collected there. */
import { describe, expect, it } from "vitest";
import { carPickupArrangement } from "../../northwind-site/components/booking/car-pickup-arrangement";
import type { PickupLocation } from "../../northwind-site/lib/vehicles/types";

const loc = (id: string, over: Partial<PickupLocation> = {}) =>
  ({ id, name: id, address: `${id} street`, deliveryFee: 0, isPickupEnabled: true, isReturnEnabled: true, ...over }) as PickupLocation;

const downtown = loc("downtown");
const airport = loc("airport", { deliveryFee: 35 });
const pickupOnly = loc("desk", { isReturnEnabled: false });
const active = [downtown, airport, pickupOnly];
const returns = [downtown, airport];

describe("carPickupArrangement", () => {
  it("leaves the tenant's choices alone when the car has no fixed location (8.3)", () => {
    expect(carPickupArrangement(null, active, returns)).toBeNull();
    expect(carPickupArrangement(undefined, active, returns)).toBeNull();
  });

  it("offers only the car's location, with no chooser (8.2)", () => {
    const a = carPickupArrangement("downtown", active, returns)!;
    expect(a.location).toBe(downtown);
    expect(a.pickupLocations).toEqual([downtown]);
    expect(a.returnLocations).toEqual([downtown]);
    expect(a.modes).toEqual({ fixed: false, location: true, area: false, enabled: ["location"], showChooser: false });
  });

  it("carries the location's own fee (8.5)", () => {
    expect(carPickupArrangement("airport", active, returns)!.pickupLocations[0].deliveryFee).toBe(35);
  });

  it("falls back to the tenant's choices when the car's location is not offered, e.g. inactive (8.4)", () => {
    expect(carPickupArrangement("retired", active, returns)).toBeNull();
  });

  it("lets the car go back to any return point when its location takes no returns", () => {
    expect(carPickupArrangement("desk", active, returns)!.returnLocations).toEqual(returns);
  });
});
