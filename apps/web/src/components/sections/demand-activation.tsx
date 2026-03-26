"use client";

import { useFadeIn } from "@/hooks/use-fade-in";
import { Crosshair, BarChart3, RefreshCw, Megaphone } from "lucide-react";

const BULLETS = [
  {
    icon: Megaphone,
    text: "Meta & Google campaign structure and ongoing management",
  },
  {
    icon: Crosshair,
    text: "Local targeting for airport and regional rental markets",
  },
  {
    icon: BarChart3,
    text: "Conversion-optimised booking flows",
  },
  {
    icon: RefreshCw,
    text: "Retention strategy to drive repeat direct bookings",
  },
];

export function DemandActivation() {
  const { ref, visible } = useFadeIn();

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Demand activation
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <div
          ref={ref}
          className={`mt-10 grid items-center gap-12 lg:grid-cols-2 ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          {/* Left: Heading + subheading */}
          <div>
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[40px] lg:leading-tight">
              Activate paid demand.{" "}
              <span className="text-indigo-600 dark:text-indigo-400">
                Keep control.
              </span>
            </h2>
            <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">
              Drive247 gives you the infrastructure. We manage paid acquisition
              to help you generate and retain direct bookings beyond
              marketplaces.
            </p>
          </div>

          {/* Right: Bullets */}
          <div>
            <ul className="divide-y divide-border">
              {BULLETS.map((bullet) => (
                <li
                  key={bullet.text}
                  className="flex items-center gap-3 py-3.5"
                >
                  <bullet.icon className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-sm font-medium">{bullet.text}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 space-y-1 text-xs leading-relaxed text-muted-foreground">
              <p>
                Ad management is optional and designed for operators scaling
                beyond marketplace dependency.
              </p>
              <p>
                Campaigns run through your own ad accounts — you retain
                ownership and data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
