"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { VehicleSelectCard } from "@/components/booking/vehicle-select-card";
import { BRANDS, FLEET } from "@/lib/fixtures/landing";
import { useBookingStore } from "@/lib/stores/booking-store";
import { cn } from "@/lib/utils";

export function StepFleet() {
  const store = useBookingStore();
  const { selectedVehicleId, brandFilter } = store;
  const [error, setError] = useState<string>("");

  const filtered = FLEET.filter((v) => v.brandId === brandFilter);

  function handleProceed() {
    if (!selectedVehicleId) {
      setError("Please select a vehicle to continue");
      return;
    }
    setError("");
    store.next();
  }

  return (
    <div className="w-full max-w-[1100px]">
      <h1 className="text-center text-[26px] font-semibold leading-tight text-brand-text sm:text-[32px]">
        Select your Ride
      </h1>

      {/* Brand filter — horizontal scroll on mobile, wrap-centered on tablet+ */}
      <div className="-mx-6 mt-6 overflow-x-auto px-6 pb-2 sm:overflow-visible sm:px-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-center gap-1 sm:w-auto sm:flex-wrap sm:justify-center">
          {BRANDS.map((brand) => {
            const active = brand.id === brandFilter;
            return (
              <button
                key={brand.id}
                type="button"
                onClick={() => store.set("brandFilter", brand.id)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm transition-all",
                  active
                    ? "border border-brand-border-soft bg-white text-brand-text shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "border border-transparent text-brand-text-subtle hover:text-brand-text",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-3 rounded-full",
                    active ? "bg-brand-text" : "bg-brand-text-subtle/60",
                  )}
                />
                {brand.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Vehicle grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((v) => (
          <VehicleSelectCard
            key={v.id}
            vehicle={v}
            selected={v.id === selectedVehicleId}
            onSelect={() => store.selectVehicle(v)}
          />
        ))}
      </div>

      {error && (
        <p className="mt-4 text-center text-xs text-danger">{error}</p>
      )}

      <div className="sticky bottom-6 mt-8 flex justify-center">
        <button
          type="button"
          onClick={handleProceed}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-forest px-8 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgba(0,0,0,0.25)] transition-opacity hover:opacity-90"
        >
          Proceed to Book
          <ArrowRight className="size-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
