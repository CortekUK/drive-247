"use client";

import { useState } from "react";

import { VehicleCard } from "@/components/cards/vehicle-card";
import { BRANDS, FLEET } from "@/lib/fixtures/landing";
import { cn } from "@/lib/utils";

export function FleetSection() {
  const [active, setActive] = useState<string>(BRANDS[1]?.id ?? BRANDS[0].id);

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

        <div className="mt-10 flex flex-wrap items-center justify-center gap-1">
          {BRANDS.map((brand) => {
            const isActive = brand.id === active;
            return (
              <button
                key={brand.id}
                type="button"
                onClick={() => setActive(brand.id)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm transition-all",
                  isActive
                    ? "border border-brand-border-soft bg-white text-brand-text shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "border border-transparent text-brand-text-subtle hover:text-brand-text",
                )}
              >
                <BrandIcon brandId={brand.id} active={isActive} />
                {brand.name}
              </button>
            );
          })}
        </div>

        <div className="-mx-6 mt-10 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-3">
            {FLEET.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        </div>
      </div>

      <MarqueeStrip />
    </section>
  );
}

function BrandIcon({
  brandId,
  active,
}: {
  brandId: string;
  active: boolean;
}) {
  const color = active ? "#111210" : "#8a8c88";

  switch (brandId) {
    case "bentley":
      return (
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
          <path
            d="M1 7 L5 3 L9 5 L13 3 L17 7 L13 11 L9 9 L5 11 L1 7Z"
            stroke={color}
            strokeWidth="0.6"
          />
          <circle cx="9" cy="7" r="1" fill={color} />
        </svg>
      );
    case "aston-martin":
      return (
        <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
          <path
            d="M10 5 L1 3 L4 5 L1 7 L10 5 L19 3 L16 5 L19 7 L10 5Z"
            stroke={color}
            strokeWidth="0.6"
          />
          <circle cx="10" cy="5" r="0.9" fill={color} />
        </svg>
      );
    case "audi":
      return (
        <svg width="22" height="10" viewBox="0 0 22 10" fill="none">
          <circle cx="4" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="8.5" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="13" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="17.5" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
        </svg>
      );
    case "bmw":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="0.7" />
          <path d="M7 1 V7 L13 7" stroke={color} strokeWidth="0.7" />
          <path d="M7 13 V7 L1 7" stroke={color} strokeWidth="0.7" />
        </svg>
      );
    case "chevrolet":
      return (
        <svg width="18" height="10" viewBox="0 0 18 10" fill="none">
          <path
            d="M1 4 H7 V1 H11 V4 H17 V6 H11 V9 H7 V6 H1 Z"
            stroke={color}
            strokeWidth="0.6"
            fill="none"
          />
        </svg>
      );
    case "lexus":
      return (
        <svg width="20" height="12" viewBox="0 0 20 12" fill="none">
          <ellipse
            cx="10"
            cy="6"
            rx="8"
            ry="5"
            stroke={color}
            strokeWidth="0.6"
          />
          <path d="M11 3 L8 8 H13" stroke={color} strokeWidth="0.6" />
        </svg>
      );
    default:
      return null;
  }
}

function MarqueeStrip() {
  const items = [
    "PICK UP ANYTIME",
    "NO COUNTER LINES",
    "NO HIDDEN FEES",
    "100% TRANSPARENCY",
    "DRIVING THE MOVE",
  ];
  const repeated = [...items, ...items, ...items];

  return (
    <div className="overflow-hidden bg-brand-cream py-[16px] text-brand-text">
      <div className="marquee-track flex w-max items-center whitespace-nowrap">
        {repeated.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="inline-flex items-center text-sm font-semibold uppercase tracking-[0.14em]"
          >
            {item}
            <span className="mx-6 text-brand-text/45">•</span>
          </span>
        ))}
      </div>
    </div>
  );
}
