import type { Metadata } from "next";
import { Suspense } from "react";

import { Template2BookingFlow, Template2BookingFlowSkeleton } from "@nw/template-2/booking-flow";

/** Template 2 ("Glass") — the booking flow on its own page (/template-2/booking). */

export const metadata: Metadata = {
  title: "Book a car",
  description: "Choose your dates and times, pick a car that is free for them, and see the price as you go.",
};

export default function Template2BookingFlowRoute() {
  return (
    <Suspense fallback={<Template2BookingFlowSkeleton />}>
      <Template2BookingFlow />
    </Suspense>
  );
}
