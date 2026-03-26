"use client";

import { useFadeIn } from "@/hooks/use-fade-in";

const BULLETS = [
  "Your domain and branding",
  "Real-time availability synced with your dashboard",
  "Guided booking flow with insurance and ID at checkout",
  "Run your own Google and Meta campaigns — keep 100% of customers",
];

export function BookingWebsite() {
  const { ref, visible } = useFadeIn();

  return (
    <section id="features-booking" className="bg-muted/50 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section heading */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Direct booking website
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Own your direct{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            booking channel
          </span>
        </h2>

        <p className="mx-auto mt-3 max-w-2xl text-center leading-relaxed text-muted-foreground">
          A fully branded website where customers book directly — connected in
          real time to your operations dashboard.
        </p>

        {/* Content row */}
        <div
          ref={ref}
          className={`relative mt-16 overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          {/* Top accent line */}
          <div className="absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />

          <div className="grid items-center lg:grid-cols-5">
            {/* Text content — left on desktop, below video on mobile */}
            <div className="order-2 p-6 lg:order-1 lg:col-span-2 lg:p-8">
              <p className="text-muted-foreground leading-relaxed">
                Your website. Your pricing. Your rules.
              </p>

              <ul className="mt-6 space-y-2">
                {BULLETS.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5"
                  >
                    <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                    <p className="text-sm font-medium">{bullet}</p>
                  </li>
                ))}
              </ul>

              <p className="mt-6 text-sm text-muted-foreground leading-relaxed">
                Connected directly to your back office — no fragmented tools.
              </p>
            </div>

            {/* Browser mockup with video — right on desktop, first on mobile */}
            <div className="order-1 p-4 pb-0 sm:p-6 sm:pb-0 lg:order-2 lg:col-span-3 lg:p-8 lg:pb-8">
              <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/30 shadow-lg">
                <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-3">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-400/80" />
                    <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
                    <div className="h-3 w-3 rounded-full bg-green-400/80" />
                  </div>
                  <div className="mx-auto flex h-6 w-40 sm:w-64 items-center justify-center rounded-md bg-background px-3">
                    <span className="text-[11px] text-muted-foreground">
                      website.drive247.com
                    </span>
                  </div>
                  <div className="w-[52px]" />
                </div>
                <video autoPlay loop muted playsInline className="w-full dark:hidden">
                  <source src="/drivewebsite-v2.mp4" type="video/mp4" />
                </video>
                <video autoPlay loop muted playsInline className="hidden w-full dark:block">
                  <source src="/drivewebsite-v2-dark.mp4" type="video/mp4" />
                </video>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
