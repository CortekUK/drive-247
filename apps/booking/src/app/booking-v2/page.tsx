import BookingV2Landing from "@/components/booking-v2/landing";

/**
 * Standing preview URL for the booking-v2 design, reachable on every tenant
 * regardless of their `booking_v2_enabled` flag. The flag controls whether the
 * design also replaces the tenant's home page — see `src/app/page.tsx`.
 */
export default function Page() {
  return <BookingV2Landing />;
}
