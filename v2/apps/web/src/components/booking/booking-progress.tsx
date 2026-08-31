"use client";

import { TOTAL_STEPS } from "@/lib/fixtures/booking";
import { useBookingStore } from "@/lib/stores/booking-store";
import { cn } from "@/lib/utils";

const STEP_LABELS = [
  "Trip Logistics",
  "Select your Ride",
  "Tell us About Yourself",
  "Coverage & Protection",
  "Review Your Trip",
  "Booking Confirmed",
];

export function BookingProgress({ current }: { current: number }) {
  const setStep = useBookingStore((s) => s.setStep);

  return (
    <ol
      aria-label={`Step ${current} of ${TOTAL_STEPS}`}
      className="flex items-center justify-center gap-2 sm:gap-3"
    >
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
        const stepIndex = i + 1;
        const isComplete = stepIndex <= current;
        const isReachable = stepIndex < current;
        const isCurrent = stepIndex === current;
        const label = STEP_LABELS[i] ?? `Step ${stepIndex}`;

        return (
          <li
            key={stepIndex}
            aria-current={isCurrent ? "step" : undefined}
            className="contents"
          >
            <button
              type="button"
              onClick={() => {
                if (isReachable) setStep(stepIndex);
              }}
              disabled={!isReachable}
              aria-label={`Step ${stepIndex}: ${label}${isCurrent ? " (current)" : ""}`}
              title={label}
              className={cn(
                "h-1 w-8 rounded-full transition-all sm:w-12",
                isComplete ? "bg-brand-text" : "bg-brand-border",
                isReachable
                  ? "cursor-pointer hover:h-1.5 hover:bg-brand-text/85"
                  : "cursor-default",
                isCurrent && "h-1.5",
              )}
            />
          </li>
        );
      })}
    </ol>
  );
}
