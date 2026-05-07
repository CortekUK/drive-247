"use client";

import { Check, Fuel, Gauge, User } from "lucide-react";
import Image from "next/image";

import type { Vehicle } from "@/lib/fixtures/landing";
import { cn } from "@/lib/utils";

type VehicleSelectCardProps = {
  vehicle: Vehicle;
  selected: boolean;
  onSelect: () => void;
};

export function VehicleSelectCard({
  vehicle,
  selected,
  onSelect,
}: VehicleSelectCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col rounded-[14px] border bg-white p-4 text-left transition-all",
        selected
          ? "border-brand-amber ring-2 ring-brand-amber/40"
          : "border-brand-border-soft hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)]",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold leading-tight text-brand-text">
            {vehicle.name}
          </h3>
          <p className="text-xs leading-tight text-brand-text-subtle">
            {vehicle.year} · {vehicle.trim}
          </p>
        </div>
        <BrandWingsMark />
      </header>

      <ul className="mt-3 flex items-center gap-3 text-xs leading-tight text-brand-text-soft">
        <li className="inline-flex items-center gap-1">
          <User className="size-3" strokeWidth={1.75} />
          {vehicle.seats}
        </li>
        <li className="inline-flex items-center gap-1">
          <Gauge className="size-3" strokeWidth={1.75} />
          {vehicle.transmission}
        </li>
        <li className="inline-flex items-center gap-1">
          <Fuel className="size-3" strokeWidth={1.75} />
          {vehicle.rangeLiters}L
        </li>
      </ul>

      {vehicle.status === "ready" && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs leading-tight text-brand-text">
          <Check className="size-3" strokeWidth={2.25} />
          Ready for Pickup
        </p>
      )}

      <div className="my-3 flex h-[88px] w-full items-center justify-center">
        <Image
          src={vehicle.image}
          alt={`${vehicle.year} ${vehicle.name}`}
          width={1268}
          height={353}
          className="h-full w-auto object-contain"
        />
      </div>

      <footer className="mt-auto">
        <p className="leading-tight">
          <span className="block text-xl font-semibold leading-tight text-brand-text">
            ${vehicle.pricePerDay}
          </span>
          <span className="block text-xs leading-tight text-brand-text-subtle">
            per day
          </span>
        </p>
      </footer>
    </button>
  );
}

function BrandWingsMark() {
  return (
    <svg
      width="34"
      height="14"
      viewBox="0 0 34 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-brand-text-subtle"
      aria-hidden
    >
      <path
        d="M17 7 L1 4 L4 6 L1 7 L4 8 L1 10 L17 7 L33 4 L30 6 L33 7 L30 8 L33 10 L17 7Z"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="17" cy="7" r="1.2" fill="currentColor" />
    </svg>
  );
}
