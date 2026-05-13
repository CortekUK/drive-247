"use client";

import { CalendarCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsultationForm } from "@/components/forms/consultation-form";
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

        {/* Form card */}
        <div
          ref={ref}
          className={`relative mx-auto mt-10 max-w-lg overflow-hidden rounded-lg border bg-card p-6 shadow-lg ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />
          <ConsultationForm />

          {/* Strategy call booking */}
          <div className="mt-5 flex flex-col items-center gap-2 border-t pt-5">
            <Button
              asChild
              variant="outline"
              size="lg"
              className="w-full gap-2 text-sm font-medium"
            >
              <a href="/strategy-call">
                <CalendarCheck className="h-4 w-4" />
                Book a time directly
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Prefer to speak directly? Choose a time that works for you.
            </p>
          </div>
        </div>

        {/* Reassurance */}
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground/80">
          <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>Clear next steps. We move fast on our side.</span>
        </div>
      </div>
    </section>
  );
}
