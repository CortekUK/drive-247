"use client";

import {
  MessageCircle,
  CalendarPlus,
  FileUp,
  Eye,
  CreditCard,
  Smartphone,
} from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";

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

export function RenterPortal() {
  const { ref, visible } = useFadeIn();

  return (
    <section id="features-renter" className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section heading */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Renter self-service
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Give renters a seamless{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            self-service experience
          </span>
        </h2>

        <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
          No app download. No back-and-forth texting. Just a secure link
          that gives renters everything they need from any device.
        </p>

        {/* Three-column: features | phone | features */}
        <div
          ref={ref}
          className={`mt-16 grid items-center gap-10 lg:grid-cols-[1fr_auto_1fr] ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          {/* Left features */}
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
                <video autoPlay loop muted playsInline className="block w-full -mt-px dark:hidden" onLoadedMetadata={(e) => { e.currentTarget.playbackRate = 2; }}>
                  <source src="/renter-portal-video-v2.mp4" type="video/mp4" />
                </video>
                <video autoPlay loop muted playsInline className="hidden w-full -mt-px dark:block" onLoadedMetadata={(e) => { e.currentTarget.playbackRate = 2; }}>
                  <source src="/renter-portal-video-v2-dark3.mp4" type="video/mp4" />
                </video>
                <div className="relative z-10 -mt-px bg-muted/60 px-4 py-3">
                  <div className="mx-auto h-1 w-28 rounded-full bg-foreground/15" />
                </div>
              </div>
            </div>
          </div>

          {/* Right features */}
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
          Replaces back-and-forth texting with a single, structured renter experience.
        </p>
      </div>
    </section>
  );
}
