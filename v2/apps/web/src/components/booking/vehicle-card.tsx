"use client";

import { cn } from "@/lib/utils";
import type { Vehicle } from "@/lib/vehicles/types";

import { VehicleGallery } from "./vehicle-gallery";
import { VehicleOverview } from "./vehicle-overview";

/**
 * The car, as one card.
 *
 * This is the anchor of the page and the first thing in the DOM, so a phone
 * meets the vehicle before a wall of fields and a desktop reads it on the left
 * while the form fills the right. Photos, name, headline rate and the spec grid
 * are one surface rather than three stacked blocks — the gap between them was
 * pure page height, and the photo used to sit in a column of its own doing
 * nothing while every field queued up in a 420px gutter beside it.
 *
 * `overflow-hidden` is safe here: the sticky element is the rail that wraps this
 * card, not the card itself, so clipping the gallery to the card's radius costs
 * nothing. Nothing inside opens a popover.
 */
export function VehicleCard({
  vehicle,
  className,
}: {
  vehicle: Vehicle;
  className?: string;
}) {
  return (
    /*
      Three shapes, one card. Stacked on a phone; SIDE BY SIDE between `sm` and
      `lg`, because that is the band where the card spans the whole page and a
      full-width 16:10 photo is 450px of scroll before a single field; stacked
      again at `lg`, where the card is back in a ~380px rail.
    */
    <div
      className={cn(
        "overflow-hidden rounded-[18px] border border-brand-border-soft bg-white sm:flex lg:block",
        className,
      )}
    >
      <VehicleGallery
        images={vehicle.images}
        alt={vehicle.displayName}
        variant="inset"
        className="sm:w-[42%] sm:shrink-0 sm:self-start lg:w-full"
      />
      <VehicleOverview
        vehicle={vehicle}
        className="p-4 sm:min-w-0 sm:flex-1 lg:flex-none"
      />
    </div>
  );
}
