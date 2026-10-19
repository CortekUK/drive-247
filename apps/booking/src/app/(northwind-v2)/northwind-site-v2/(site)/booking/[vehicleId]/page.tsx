import type { Metadata } from "next";

import { VehicleBookingPage } from "@nw/site-v2/booking/vehicle-booking-page";

/**
 * /booking/<vehicleId> — v2. A thin server component because `params` is a
 * Promise and a client component cannot await it; the page itself is a live
 * client form. Same metadata as the current site's route.
 */

export const metadata: Metadata = {
  title: "Book a vehicle",
  description: "Choose your dates, add what you need, and see the full price before you pay.",
};

export default async function VehicleBookingRouteV2({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  // A non-UUID segment reaches `useVehicle`, which renders the not-found state.
  return <VehicleBookingPage vehicleId={vehicleId} />;
}
