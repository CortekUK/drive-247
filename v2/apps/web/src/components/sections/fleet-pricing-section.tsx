"use client";

import { Check, Fuel, Gauge, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { FLEET } from "@/lib/fixtures/landing";
import type { Vehicle } from "@/lib/fixtures/landing";
import { cn } from "@/lib/utils";

type Period = "day" | "week" | "month";

const PERIOD_MULTIPLIER: Record<Period, number> = {
  day: 1,
  week: 6,
  month: 22,
};

const PERIOD_LABEL: Record<Period, string> = {
  day: "per day",
  week: "per week",
  month: "per month",
};

const TABS: { id: Period; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];

export function FleetPricingSection() {
  const [period, setPeriod] = useState<Period>("day");

  return (
    <section className="bg-white">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            Our Fleet
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            Browse our curated selection of premium vehicles, each maintained
            to perfection and ready for immediate pickup
          </p>
        </header>

        {/* Day / Weekly / Monthly tabs */}
        <div
          role="tablist"
          aria-label="Pricing period"
          className="mx-auto mt-8 flex w-fit items-center gap-1 rounded-full border border-brand-border-soft bg-white p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          {TABS.map((tab) => {
            const active = tab.id === period;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPeriod(tab.id)}
                className={cn(
                  "inline-flex h-9 items-center justify-center rounded-full px-5 text-sm transition-colors",
                  active
                    ? "bg-brand-text text-white"
                    : "text-brand-text-subtle hover:text-brand-text",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Vehicle grid */}
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {FLEET.map((vehicle) => (
            <FleetVehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              period={period}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

type FleetVehicleCardProps = {
  vehicle: Vehicle;
  period: Period;
};

function FleetVehicleCard({ vehicle, period }: FleetVehicleCardProps) {
  const price = vehicle.pricePerDay * PERIOD_MULTIPLIER[period];

  return (
    <article className="flex flex-col rounded-[14px] border border-brand-border-soft bg-white p-4 transition-shadow hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)]">
      <header className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold leading-tight text-brand-text">
            {vehicle.name}
          </h3>
          <p className="text-xs leading-tight text-brand-text-subtle">
            {vehicle.year} · {vehicle.trim}
          </p>
        </div>
        <BrandWingsMark className="text-brand-text-subtle" />
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

      <footer className="flex items-end justify-between">
        <p className="leading-tight">
          <span className="block text-xl font-semibold leading-tight text-brand-text">
            ${price}
          </span>
          <span className="block text-xs leading-tight text-brand-text-subtle">
            {PERIOD_LABEL[period]}
          </span>
        </p>
        <Link
          href={`/booking?vehicle=${vehicle.id}`}
          className="inline-flex items-center justify-center rounded-full bg-brand-forest px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          Rent Now
        </Link>
      </footer>
    </article>
  );
}

function BrandWingsMark({ className }: { className?: string }) {
  return (
    <svg
      width="34"
      height="14"
      viewBox="0 0 34 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
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
