import { ShieldCheck } from "lucide-react";
import Image from "next/image";

import { ReadinessCard } from "@/components/cards/readiness-card";
import { LocationSearchForm } from "@/components/forms/location-search-form";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-brand-cream">
      <div className="container-page relative grid grid-cols-1 items-center gap-x-8 gap-y-10 pb-16 pt-6 sm:gap-y-12 sm:pb-20 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:gap-y-16 lg:pb-28 lg:pt-16">
        <div className="flex flex-col">
          <h1 className="max-w-[540px] text-3xl leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-6xl lg:leading-none">
            Rent the Exact Car You See with Absolute Certainty Every Time
          </h1>

          <div className="pb-6 pt-6 sm:pb-8 sm:pt-10">
            <LocationSearchForm />
          </div>

          <div className="hidden pt-12 lg:block lg:pt-20">
            <div className="flex max-w-[320px] items-start gap-3">
              <span className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-brand-card shadow-[0px_2px_4px_rgba(0,0,0,0.06)]">
                <ShieldCheck
                  className="size-[14px] text-brand-text"
                  strokeWidth={1.6}
                />
              </span>
              <p className="text-xs leading-[17px] text-brand-text-muted">
                Every car in our fleet is digitally inspected and
                safety-certified in real-time to ensure a flawless driving
                experience.
              </p>
            </div>
          </div>
        </div>

        <div className="relative min-h-[280px] sm:min-h-[360px] lg:min-h-[640px]">
          <div className="absolute inset-x-[-4%] inset-y-0 flex items-center lg:inset-x-[-15%]">
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

          <ReadinessCard className="absolute -bottom-2 -right-2 z-10 origin-bottom-right scale-75 sm:scale-90 lg:-bottom-3 lg:-right-5 lg:scale-100" />
        </div>

        <div className="lg:hidden">
          <div className="flex max-w-[420px] items-start gap-3">
            <span className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-brand-card shadow-[0px_2px_4px_rgba(0,0,0,0.06)]">
              <ShieldCheck
                className="size-[14px] text-brand-text"
                strokeWidth={1.6}
              />
            </span>
            <p className="text-xs leading-[17px] text-brand-text-muted">
              Every car in our fleet is digitally inspected and
              safety-certified in real-time to ensure a flawless driving
              experience.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
