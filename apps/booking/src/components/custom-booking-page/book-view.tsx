"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MultiStepBookingWidget from "@/components/MultiStepBookingWidget";
import { useBookingStore } from "@/stores/booking-store";
import { CBP } from "./use-site-content";

/* ========================================================================== *
 * The booking page — /custom-booking-page/book.
 *
 * "Find My Ride" on the home page's booking bar writes the trip into the
 * shared booking store and sends the customer here, so vehicle choice,
 * insurance, details and review run on a page of their own rather than
 * unfolding underneath the home page.
 *
 * The bar IS this site's trip-details form, so the engine's own step one is
 * never shown here: arriving with no trip, walking back to step one, or
 * starting over all return the customer to the bar. The store is persisted in
 * localStorage, so a signed-in customer keeps their place on a refresh; a
 * guest's trip is cleared on every full page load (BookingPersistenceGuard),
 * so a guest who refreshes is sent back to the bar, as on the old site.
 * ========================================================================== */

export function BookView() {
  const router = useRouter();
  const currentStep = useBookingStore(s => s.currentStep);

  // The server has no stored trip, so nothing is decided until the browser's
  // copy of the store has loaded — otherwise a refresh on step 3 would read
  // the default step 1 and bounce the customer home.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const p = useBookingStore.persist;
    if (p.hasHydrated()) setHydrated(true);
    return p.onFinishHydration(() => setHydrated(true));
  }, []);

  const hasTrip = currentStep >= 2;
  useEffect(() => {
    if (hydrated && !hasTrip) router.replace(`${CBP}#booking`);
  }, [hydrated, hasTrip, router]);

  if (!hydrated || !hasTrip) {
    return <div className="cbp-wrap min-h-[70vh]" aria-busy="true" />;
  }

  return (
    <div className="cbp-wrap pb-16">
      <MultiStepBookingWidget stayInBookingAfterVerify />
    </div>
  );
}
