/**
 * Sheet 8 (Pickup and handover): where a car the operator pinned to one pickup
 * location is collected. Its own file, with type-only imports, so it can be
 * tested without the app's path aliases.
 */
import type { PickupLocation } from "../../lib/vehicles/types";
import type { DeliveryModeAvailability } from "./booking-rules";

/** Where a car pinned to one pickup location is collected, and returned. */
export interface CarPickupArrangement {
  location: PickupLocation;
  modes: DeliveryModeAvailability;
  pickupLocations: readonly PickupLocation[];
  returnLocations: readonly PickupLocation[];
}

/**
 * The car's own pickup location, when the operator set one on the car
 * (portal → car → Pickup & handover).
 *
 * The booking page used to ignore it and offer the tenant's general choices —
 * "Collect from us" at the head-office address, any pickup point, delivery —
 * so a car kept at the airport could be "collected" downtown, and the
 * airport's fee never reached the quote. A car pinned to a location is
 * collected THERE: one option, that location, its fee in the price.
 *
 * Returns null, leaving the tenant's general arrangement in charge, when the
 * car has no fixed location, or when that location is not offered right now
 * (inactive, or not a pickup point — the locations passed in are already the
 * active pickup ones). A car must never become unbookable because its
 * location was retired. The return leg stays at the same place, unless that
 * location does not take returns, in which case the tenant's return points
 * are offered as before.
 */
export function carPickupArrangement(
  carLocationId: string | null | undefined,
  pickupLocations: readonly PickupLocation[],
  returnLocations: readonly PickupLocation[],
): CarPickupArrangement | null {
  if (!carLocationId) return null;
  const location = pickupLocations.find((l) => l.id === carLocationId);
  if (!location) return null;
  return {
    location,
    modes: { fixed: false, location: true, area: false, enabled: ["location"], showChooser: false },
    pickupLocations: [location],
    returnLocations: location.isReturnEnabled ? [location] : returnLocations,
  };
}
