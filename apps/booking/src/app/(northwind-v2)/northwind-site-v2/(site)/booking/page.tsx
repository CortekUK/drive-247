import type { Metadata } from "next";
import { Suspense } from "react";

import { BookingFlowPage, BookingFlowSkeleton } from "@nw/site-v2/book/booking-flow-page";

/**
 * /booking — v2. The booking flow on a page of its own: the trip's dates and
 * times, then a car free for them, with the overview beside it; checkout is
 * the chosen car's page (/booking/<vehicleId>). It used to forward to /fleet
 * (v1's vehicle-first flow); "Book a car" now lands here.
 *
 * Suspense because the flow keeps its step in the query (`useSearchParams`).
 */

export const metadata: Metadata = {
  title: "Book a car",
  description: "Choose your dates and times, pick a car that is free for them, and see the price as you go.",
};

export default function BookingFlowRouteV2() {
  return (
    <Suspense fallback={<BookingFlowSkeleton />}>
      <BookingFlowPage />
    </Suspense>
  );
}
