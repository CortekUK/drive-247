"use client";

import { BookingShell } from "@/components/booking/booking-shell";
import { StepConfirmed } from "@/components/booking/step-confirmed";
import { StepCoverage } from "@/components/booking/step-coverage";
import { StepFleet } from "@/components/booking/step-fleet";
import { StepIdentity } from "@/components/booking/step-identity";
import { StepLogistics } from "@/components/booking/step-logistics";
import { StepReview } from "@/components/booking/step-review";
import { useBookingStore } from "@/lib/stores/booking-store";

export default function BookingFlowPage() {
  const step = useBookingStore((s) => s.step);

  return (
    <BookingShell>
      {step === 1 && <StepLogistics />}
      {step === 2 && <StepFleet />}
      {step === 3 && <StepIdentity />}
      {step === 4 && <StepCoverage />}
      {step === 5 && <StepReview />}
      {step === 6 && <StepConfirmed />}
    </BookingShell>
  );
}
