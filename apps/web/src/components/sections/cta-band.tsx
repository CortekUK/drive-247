"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFadeIn } from "@/hooks/use-fade-in";

export function CTABand() {
  const { ref, visible } = useFadeIn();

  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      {/* Background — very subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-slate-50/60 dark:to-slate-900/10" />
      <div className="absolute inset-x-0 top-0 h-px bg-border" />

      <div className="relative mx-auto max-w-[1060px] px-4 sm:px-6">
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Get Started
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-extrabold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Ready to take control of{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            your growth?
          </span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center leading-relaxed text-muted-foreground">
          Launch your direct booking channel in 7 days and start capturing
          higher-margin bookings.
        </p>

        <div
          ref={ref}
          className={`mt-10 flex flex-col items-center gap-4 ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          <Button
            asChild
            size="lg"
            className="bg-indigo-600 px-8 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <a href="/strategy-call">
              Book your strategy call
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
            <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>20-minute call. No obligation. Clear next steps.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
