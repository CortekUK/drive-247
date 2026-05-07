"use client";

import { ArrowRight, Check } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { FLEET } from "@/lib/fixtures/landing";
import { useBookingStore } from "@/lib/stores/booking-store";

function formatDateTime(date: Date | null, time: string) {
  if (!date) return "—";
  const day = date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
  return time ? `${day}, ${time}` : day;
}

function diffDays(a: Date | null, b: Date | null) {
  if (!a || !b) return 1;
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function StepReview() {
  const store = useBookingStore();
  const {
    pickupDate,
    pickupTime,
    dropoffDate,
    dropoffTime,
    pickupLocation,
    selectedVehicleId,
    agreedToTerms,
  } = store;
  const [error, setError] = useState<string>("");

  const vehicle = FLEET.find((v) => v.id === selectedVehicleId) ?? FLEET[0];
  const days = diffDays(pickupDate, dropoffDate);
  const total = vehicle.pricePerDay * days;

  function handleConfirm() {
    if (!agreedToTerms) {
      setError("Please agree to the Terms & Conditions");
      return;
    }
    setError("");
    store.next();
  }

  return (
    <article className="w-full max-w-[480px] rounded-[16px] bg-white p-6 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.12)] ring-1 ring-brand-border-soft sm:p-8">
      <h1 className="text-[22px] font-semibold leading-tight text-brand-text">
        Review Your Trip
      </h1>

      <dl className="mt-5 space-y-2 text-[13px]">
        <SummaryRow
          term="Pick-up"
          value={formatDateTime(pickupDate, pickupTime)}
        />
        <SummaryRow
          term="Return"
          value={formatDateTime(dropoffDate, dropoffTime)}
        />
        <SummaryRow term="Location" value={pickupLocation || "—"} />
      </dl>

      {/* Vehicle card snapshot */}
      <div className="mt-5 flex items-center gap-3 overflow-hidden rounded-[12px] bg-brand-cream/60 p-4 ring-1 ring-brand-border-soft">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-text">
            {vehicle.name}
          </p>
          <p className="text-[11px] text-brand-text-subtle">
            {vehicle.year} · {vehicle.trim}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-text">
            <Check className="size-3" strokeWidth={2.25} />
            Ready for Pickup
          </p>
          <p className="mt-3 text-base font-semibold text-brand-text">
            ${vehicle.pricePerDay}
            <span className="ml-1 text-[10px] font-normal text-brand-text-subtle">
              per day
            </span>
          </p>
        </div>
        <Image
          src={vehicle.image}
          alt={vehicle.name}
          width={1268}
          height={353}
          className="h-auto w-[120px] shrink-0 object-contain sm:w-[160px]"
        />
      </div>

      {/* Pricing */}
      <dl className="mt-6 space-y-2 border-t border-brand-border-soft pt-4 text-[13px]">
        <SummaryRow term="Base Rental (per day)" value={`$${vehicle.pricePerDay}`} />
        <SummaryRow term="Duration" value={`${days} ${days === 1 ? "Day" : "Days"}`} />
      </dl>

      <div className="mt-4 flex items-center justify-between border-t border-brand-border-soft pt-4">
        <span className="text-sm font-semibold text-brand-text">
          Total Amount
        </span>
        <span className="text-xl font-semibold text-brand-text">${total}</span>
      </div>

      {/* Terms */}
      <label className="mt-5 flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-brand-text-soft">
        <Checkbox
          checked={agreedToTerms}
          onCheckedChange={(v) => store.set("agreedToTerms", v === true)}
          className="mt-0.5"
        />
        <span>
          I have read and agree to the Rental{" "}
          <a className="font-medium text-brand-text underline" href="#">
            Terms &amp; Conditions
          </a>{" "}
          and the{" "}
          <a className="font-medium text-brand-text underline" href="#">
            Vehicle Usage Policy
          </a>
          .
        </span>
      </label>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <button
        type="button"
        onClick={handleConfirm}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-forest text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Confirm &amp; Book Now
        <ArrowRight className="size-4" strokeWidth={2} />
      </button>
    </article>
  );
}

function SummaryRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-brand-text-soft">{term}</dt>
      <dd className="font-medium text-brand-text">{value}</dd>
    </div>
  );
}
