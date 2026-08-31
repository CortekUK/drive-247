"use client";

import { ArrowRight, Check, Mail } from "lucide-react";
import Link from "next/link";

import { useBookingStore } from "@/lib/stores/booking-store";

export function StepConfirmed() {
  const reset = useBookingStore((s) => s.reset);

  return (
    <div className="flex w-full max-w-[640px] flex-col items-center text-center">
      <span className="inline-flex size-20 items-center justify-center rounded-full bg-success">
        <Check className="size-9 text-white" strokeWidth={3} />
      </span>

      <h1 className="mt-6 text-[26px] font-semibold leading-tight text-brand-text sm:text-[30px]">
        Booking Confirmed.
      </h1>
      <p className="mt-2 max-w-[320px] text-sm text-brand-text-soft sm:max-w-[420px] sm:text-base">
        Your vehicle is prepped, sanitized, and waiting for you.
      </p>

      <Link
        href="/"
        onClick={() => reset()}
        className="mt-8 inline-flex h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-full bg-brand-forest px-8 text-sm font-medium text-white transition-opacity hover:opacity-90 sm:w-auto sm:max-w-none"
      >
        Back to Home
        <ArrowRight className="size-4" strokeWidth={2} />
      </Link>

      {/* Email confirmation — stacked icon+text on mobile, inline pill on tablet+ */}
      <div className="mt-12 flex flex-col items-center gap-2 text-[12px] leading-relaxed text-brand-text sm:inline-flex sm:flex-row sm:gap-2 sm:rounded-full sm:bg-white sm:px-4 sm:py-2 sm:shadow-sm sm:ring-1 sm:ring-brand-border-soft">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-cream ring-1 ring-brand-border-soft sm:size-auto sm:bg-transparent sm:p-0 sm:ring-0">
          <Mail className="size-3.5" strokeWidth={1.75} />
        </span>
        <span className="max-w-[280px] text-center sm:max-w-none sm:text-left">
          Check Your Email: We’ve sent your full rental agreement and pickup
          instructions.
        </span>
      </div>
    </div>
  );
}
