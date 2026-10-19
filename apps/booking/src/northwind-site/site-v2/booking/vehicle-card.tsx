"use client";

import { cn } from "@nw/lib/utils";
import type { Vehicle } from "@nw/lib/vehicles/types";
import { CARD } from "@nw/site-v2/kit";

import { VehicleGallery } from "./vehicle-gallery";
import { VehicleOverview } from "./vehicle-overview";

/**
 * The car, as one card — v2. Same props as `components/booking/vehicle-card`.
 * The photos sit flush at the top (the card clips them to its 16px radius) and
 * the overview below. Nothing inside opens a popover, so `overflow-hidden` is
 * safe.
 */
export function VehicleCard({
  vehicle,
  className,
}: {
  vehicle: Vehicle;
  className?: string;
}) {
  return (
    <div className={cn(CARD, "overflow-hidden", className)}>
      <VehicleGallery images={vehicle.images} alt={vehicle.displayName} variant="inset" />
      <VehicleOverview vehicle={vehicle} className="p-4 md:p-5" />
    </div>
  );
}
