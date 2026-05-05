import { ShieldCheck } from "lucide-react";
import Image from "next/image";

import { ReadinessCard } from "@/components/cards/readiness-card";
import { LocationSearchForm } from "@/components/forms/location-search-form";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background">
      <div className="container-page relative grid grid-cols-1 items-center gap-x-8 gap-y-16 pb-24 pt-12 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:pb-28 lg:pt-16">
        <div className="flex flex-col">
          <h1 className="max-w-[540px] text-4xl leading-tight tracking-tight text-[#111210] sm:text-5xl lg:text-6xl lg:leading-none">
            Rent the Exact Car You See with Absolute Certainty Every Time
          </h1>

          <div className="pb-8 pt-10">
            <LocationSearchForm />
          </div>

          <div className="pt-12 lg:pt-20">
            <div className="flex max-w-[320px] items-start gap-3">
              <span className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#fefffe] shadow-[0px_2px_4px_rgba(0,0,0,0.06)]">
                <ShieldCheck
                  className="size-[14px] text-[#111210]"
                  strokeWidth={1.6}
                />
              </span>
              <p className="text-xs leading-[17px] text-[#4b4e47]">
                Every car in our fleet is digitally inspected and
                safety-certified in real-time to ensure a flawless driving
                experience.
              </p>
            </div>
          </div>
        </div>

        <div className="relative min-h-[420px] lg:min-h-[640px]">
          <div className="absolute inset-x-[-8%] inset-y-0 flex items-center lg:inset-x-[-15%]">
            <Image
              src="/booking_landingpage/lexus-hero.png"
              alt="Lexus RX in Nori Green Pearl"
              width={934}
              height={501}
              priority
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="h-auto w-full drop-shadow-[0px_25px_30px_rgba(0,0,0,0.12)]"
            />
          </div>

          <ReadinessCard className="absolute -bottom-3 -right-5 z-10" />
        </div>
      </div>
    </section>
  );
}
