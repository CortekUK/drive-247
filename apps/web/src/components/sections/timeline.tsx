"use client";

import { Check } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";

const STEPS = [
  {
    time: "Day 0",
    title: "Kickoff call",
    description:
      "We align on your fleet, pricing strategy, branding and growth goals.",
  },
  {
    time: "48 hours",
    title: "Admin access + branded site",
    description:
      "Your dashboard is live and your direct booking website is ready for review.",
  },
  {
    time: "~1 week",
    title: "Go live. Capture direct bookings.",
    description:
      "Payments, documents and verification are connected. You begin taking direct bookings.",
  },
  {
    time: "Ongoing",
    title: "Scale support",
    description:
      "Platform updates, feature improvements, retention systems, and optional paid demand activation to scale your direct channel.",
  },
];

const BUILT_FOR = [
  "Turo power hosts building a direct channel",
  "Operators scaling beyond marketplace dependency",
  "Independent fleets focused on long-term brand equity",
  "Airport and local rental operators ready to control pricing",
  "Businesses investing in paid traffic and retention",
];

export function Timeline() {
  const { ref, visible } = useFadeIn();

  return (
    <section id="timeline" className="py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            How it works
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Launch your direct channel{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            in 7 days
          </span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
          From setup to live bookings — without marketplace dependency.
        </p>

        <div
          ref={ref}
          className={`mt-12 grid items-center gap-10 lg:gap-16 lg:grid-cols-2 ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          {/* Left: Vertical stepper */}
          <div className="relative">
            {/* Vertical connecting line */}
            <div className="absolute top-3 bottom-3 left-[15px] w-[1.5px] bg-border" />

            <div className="space-y-6">
              {STEPS.map((step, i) => (
                <div key={i} className="relative flex gap-5">
                  {/* Step dot */}
                  <div className="relative z-10 flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-full border bg-card text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                    {i + 1}
                  </div>

                  <div className="pb-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      {step.time}
                    </p>
                    <h3 className="mt-0.5 text-[15px] font-bold tracking-tight">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground/80">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Built for */}
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="text-[17px] font-extrabold tracking-tight">
              Designed for operators ready to scale.
            </h3>
            <ul className="mt-4 space-y-3">
              {BUILT_FOR.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
                    <Check className="h-2.5 w-2.5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <span className="text-sm font-medium leading-snug">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Paid acquisition management is optional and runs through your own ad
          accounts — you retain ownership and data.
        </p>
      </div>
    </section>
  );
}
