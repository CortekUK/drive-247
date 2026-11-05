import { BookingPageSkeleton } from "@nw/site-v2/booking/vehicle-booking-page";

/** /booking/<vehicleId> while it loads — on from "Continue to checkout", say. */
export default function VehicleBookingLoadingV2() {
  return <BookingPageSkeleton />;
}
