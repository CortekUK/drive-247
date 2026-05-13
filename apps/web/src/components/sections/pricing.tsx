"use client";

import { useFadeIn } from "@/hooks/use-fade-in";
import { ArrowRight } from "lucide-react";

export function PricingSection() {
  const { ref, visible } = useFadeIn();

  return (
    <section id="pricing" className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section heading */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Pricing
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Tailored to{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            your fleet
          </span>
        </h2>

        <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
          We size pricing to your fleet and revenue. Most operators see ROI
          within the first 60 days.
        </p>

        <div
          ref={ref}
          className="mt-10 flex justify-center"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(16px)",
            transition: "opacity 600ms ease-out, transform 600ms ease-out",
          }}
        >
          <a
            href="/strategy-call"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-colors hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            Get your custom quote on a strategy call
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
