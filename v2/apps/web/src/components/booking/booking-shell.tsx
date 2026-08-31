"use client";

import { BookingProgress } from "@/components/booking/booking-progress";
import { useBookingStore } from "@/lib/stores/booking-store";

export function BookingShell({ children }: { children: React.ReactNode }) {
  const step = useBookingStore((s) => s.step);

  return (
    <div className="flex flex-col">
      <div className="container-page pt-4 pb-2 sm:pt-6 sm:pb-4">
        <BookingProgress current={step} />
      </div>

      <div className="container-page flex flex-1 items-start justify-center py-6 lg:py-10">
        {children}
      </div>
    </div>
  );
}
