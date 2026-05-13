"use client";

import {
  MessageCircle,
  CalendarPlus,
  FileUp,
  Eye,
  CreditCard,
  Smartphone,
  ArrowRight,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useFadeIn } from "@/hooks/use-fade-in";

const BOOKING_BULLETS = [
  "Your domain and branding",
  "Real-time availability synced with your dashboard",
  "Guided booking flow with insurance and ID at checkout",
  "Run your own Google and Meta campaigns — keep 100% of customers",
];

const LEFT_FEATURES = [
  {
    icon: Eye,
    title: "Booking visibility",
    description:
      "Renters see booking details, vehicle information, pickup instructions, and rental status in one place.",
  },
  {
    icon: MessageCircle,
    title: "Direct messaging",
    description:
      "Structured, per-booking communication that replaces scattered texts and emails.",
  },
  {
    icon: FileUp,
    title: "Document uploads",
    description:
      "Licenses, insurance, and agreements collected securely before pickup.",
  },
];

const RIGHT_FEATURES = [
  {
    icon: CalendarPlus,
    title: "Extension requests",
    description:
      "Renters request additional time directly in the portal. You approve and automatically charge the difference.",
  },
  {
    icon: CreditCard,
    title: "Payment history",
    description:
      "Full transaction visibility — deposits, balances, and receipts.",
  },
  {
    icon: Smartphone,
    title: "No app required",
    description:
      "Works in any browser. Send a secure link and renters are in.",
  },
];

function FeatureItem({
  icon: Icon,
  title,
  description,
  align,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  align: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-left" : "text-right"}>
      <div
        className={`flex items-center gap-2 ${align === "right" ? "justify-start" : "justify-end"}`}
      >
        {align === "left" && (
          <span className="text-sm font-semibold">{title}</span>
        )}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
          <Icon className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
        </div>
        {align === "right" && (
          <span className="text-sm font-semibold">{title}</span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  );
}

export function ProductShowcase() {
  const { ref, visible } = useFadeIn();

  return (
    <section id="features-product" className="bg-muted/50 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section heading */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Customer-facing tools
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Everything your renters see —{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            fully branded
          </span>
        </h2>

        <p className="mx-auto mt-3 max-w-2xl text-center leading-relaxed text-muted-foreground">
          A direct booking website and self-service renter portal, connected in
          real time to your operations dashboard.
        </p>

        {/* Tabbed content */}
        <div
          ref={ref}
          className={`mt-12 ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          <Tabs defaultValue="booking">
            <TabsList
              variant="line"
              className="mx-auto flex w-fit justify-center gap-2 bg-transparent"
            >
              <TabsTrigger
                value="booking"
                className="whitespace-nowrap rounded-full border border-border/60 bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-all after:hidden data-[state=active]:border-indigo-600/30 data-[state=active]:bg-indigo-600/[0.08] data-[state=active]:text-indigo-600 dark:border-neutral-700 dark:data-[state=active]:border-indigo-400/50 dark:data-[state=active]:bg-indigo-400/[0.08] dark:data-[state=active]:text-indigo-400"
              >
                Booking website
              </TabsTrigger>
              <TabsTrigger
                value="portal"
                className="whitespace-nowrap rounded-full border border-border/60 bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-all after:hidden data-[state=active]:border-indigo-600/30 data-[state=active]:bg-indigo-600/[0.08] data-[state=active]:text-indigo-600 dark:border-neutral-700 dark:data-[state=active]:border-indigo-400/50 dark:data-[state=active]:bg-indigo-400/[0.08] dark:data-[state=active]:text-indigo-400"
              >
                Renter portal
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Booking website */}
            <TabsContent
              value="booking"
              className="animate-in fade-in duration-200"
            >
              <div className="relative mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />

                <div className="grid items-center lg:grid-cols-5">
                  {/* Text content — left on desktop, below video on mobile */}
                  <div className="order-2 p-6 lg:order-1 lg:col-span-2 lg:p-8">
                    <p className="text-muted-foreground leading-relaxed">
                      Your website. Your pricing. Your rules.
                    </p>

                    <ul className="mt-6 space-y-2">
                      {BOOKING_BULLETS.map((bullet) => (
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
                      Connected directly to your back office — no fragmented
                      tools.
                    </p>

                    {/* Case study callout */}
                    <div className="mt-6 rounded-xl border border-indigo-200/60 bg-indigo-50/30 p-5 dark:border-indigo-800/30 dark:bg-indigo-950/20">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                          MT
                        </div>
                        <div>
                          <p className="text-[15px] leading-relaxed text-foreground">
                            &ldquo;Went from 100% marketplace to 60% direct in
                            4 months — recovered{" "}
                            <span className="font-bold text-indigo-600 dark:text-indigo-400">
                              $18k in fees
                            </span>
                            .&rdquo;
                          </p>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            Marcus T. &middot; 12-vehicle fleet &middot; Atlanta
                          </p>
                        </div>
                      </div>
                    </div>

                    <a
                      href="/strategy-call"
                      className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                    >
                      See your direct booking site mocked up on your strategy
                      call
                      <ArrowRight className="h-3.5 w-3.5" />
                    </a>
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
                        <div className="mx-auto flex h-6 w-40 items-center justify-center rounded-md bg-background px-3 sm:w-64">
                          <span className="text-[11px] text-muted-foreground">
                            website.drive247.com
                          </span>
                        </div>
                        <div className="w-[52px]" />
                      </div>
                      <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full dark:hidden"
                      >
                        <source
                          src="/drivewebsite-v2.mp4"
                          type="video/mp4"
                        />
                      </video>
                      <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="hidden w-full dark:block"
                      >
                        <source
                          src="/drivewebsite-v2-dark.mp4"
                          type="video/mp4"
                        />
                      </video>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Tab 2: Renter portal */}
            <TabsContent
              value="portal"
              className="animate-in fade-in duration-200"
            >
              <div className="relative mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />

                <div className="p-6 sm:p-8">
                  {/* Three-column: features | phone | features */}
                  <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto_1fr]">
                    {/* Left features (desktop only) */}
                    <div className="hidden space-y-10 lg:block">
                      {LEFT_FEATURES.map((f) => (
                        <FeatureItem key={f.title} {...f} align="left" />
                      ))}
                    </div>

                    {/* Phone mockup */}
                    <div className="flex justify-center">
                      <div className="w-full max-w-[280px]">
                        <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-border/50 bg-card shadow-lg dark:border-neutral-800 dark:bg-black">
                          <div className="relative bg-muted/60 px-4 py-2">
                            <div className="mx-auto h-5 w-24 rounded-full bg-foreground/10" />
                          </div>
                          <video
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="block w-full -mt-px dark:hidden"
                            onLoadedMetadata={(e) => {
                              e.currentTarget.playbackRate = 2;
                            }}
                          >
                            <source
                              src="/renter-portal-video-v2.mp4"
                              type="video/mp4"
                            />
                          </video>
                          <video
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="hidden w-full -mt-px dark:block"
                            onLoadedMetadata={(e) => {
                              e.currentTarget.playbackRate = 2;
                            }}
                          >
                            <source
                              src="/renter-portal-video-v2-dark3.mp4"
                              type="video/mp4"
                            />
                          </video>
                          <div className="relative z-10 -mt-px bg-muted/60 px-4 py-3">
                            <div className="mx-auto h-1 w-28 rounded-full bg-foreground/15" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right features (desktop only) */}
                    <div className="hidden space-y-10 lg:block">
                      {RIGHT_FEATURES.map((f) => (
                        <FeatureItem key={f.title} {...f} align="right" />
                      ))}
                    </div>

                    {/* Mobile: all features in a grid below the phone */}
                    <div className="grid gap-6 sm:grid-cols-2 lg:hidden">
                      {[...LEFT_FEATURES, ...RIGHT_FEATURES].map((f) => (
                        <FeatureItem key={f.title} {...f} align="right" />
                      ))}
                    </div>
                  </div>

                  <p className="mt-6 text-center text-sm text-muted-foreground">
                    No app download required — works in any browser via a secure
                    link.
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
}
