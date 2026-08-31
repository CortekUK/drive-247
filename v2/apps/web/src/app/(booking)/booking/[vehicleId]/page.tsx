import type { Metadata } from "next";

import { VehicleBookingPage } from "@/components/booking/vehicle-booking-page";

/**
 * /booking/<vehicleId> — the complete booking page for ONE vehicle.
 *
 * The first dynamic route in v2. It is a thin server component for one reason:
 * `params` is a Promise in Next 16, and a client component cannot await it.
 * Everything below the await is client-side, because the whole page is a live
 * form whose price re-computes on every keystroke.
 */

export const metadata: Metadata = {
  title: "Book a vehicle",
  description:
    "Choose your dates, add what you need, and see the full price before you pay.",
};

export default async function VehicleBookingRoute({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  // A segment that is not a UUID reaches `useVehicle`, which recognises
  // Postgres' 22P02 and renders the not-found state rather than an error.
  return <VehicleBookingPage vehicleId={vehicleId} />;
}
