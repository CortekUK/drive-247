"use client";

import { PLATFORM_FEATURES, CALENDLY_URL } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";
import { Check } from "lucide-react";

export function PricingSection() {
  const { ref, visible } = useFadeIn();

  return (
    <section id="pricing" className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section heading — matches site-wide pattern */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            What&apos;s included
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Everything you need to{" "}
          <span className="text-indigo-600 dark:text-indigo-400">grow</span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
          One platform, flat monthly fee. No commissions, no per-booking
          charges. Pricing tailored to your fleet size.
        </p>

        {/* Split card */}
        <div
          ref={ref}
          className="relative mt-14 overflow-hidden rounded-2xl border bg-card shadow-sm"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(16px)",
            transition: "opacity 600ms ease-out, transform 600ms ease-out",
          }}
        >
          {/* Top accent line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />

          <div className="grid lg:grid-cols-2">
            {/* Left — value prop + CTA */}
            <div className="flex flex-col justify-center p-8 sm:p-12 lg:p-14">
              <p className="text-lg font-semibold tracking-tight">
                Your complete rental operations platform
              </p>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                We&apos;ll walk you through the right plan for your fleet
                size and goals — no pressure, no commitment.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href={CALENDLY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-lg bg-indigo-600 px-7 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-colors hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  Book a strategy call
                </a>
                <span className="text-sm text-muted-foreground">
                  1 hr · free
                </span>
              </div>
            </div>

            {/* Right — feature checklist */}
            <div className="border-t bg-muted/30 p-8 sm:p-12 lg:border-l lg:border-t-0 lg:p-14">
              <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {PLATFORM_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
