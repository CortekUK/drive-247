import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { CALENDLY_URL } from "@/lib/constants";
import { AuroraBackground } from "@/components/shared/aurora-background";

function DashboardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-xl lg:mx-0">
      <div className="relative max-w-2xl lg:mx-0">
        <div className="mr-8 overflow-hidden rounded-xl border bg-background shadow-2xl shadow-indigo-900/10 sm:mr-16 lg:mr-20">
          <Image
            src="/dashboard-preview-v5.png"
            alt="Drive247 operations dashboard showing revenue tracking and performance analytics"
            width={1440}
            height={828}
            className="w-full dark:hidden"
            priority
          />
          <Image
            src="/dashboard-preview-v5-dark.png"
            alt="Drive247 operations dashboard showing revenue tracking and performance analytics"
            width={1440}
            height={828}
            className="hidden w-full dark:block"
            priority
          />
        </div>
        <div className="-mt-8 ml-4 mr-4 overflow-hidden rounded-xl border bg-background shadow-xl shadow-indigo-900/10 opacity-90 sm:-mt-12 sm:ml-8 sm:mr-8 lg:-mt-20 lg:ml-10 lg:mr-10">
          <Image
            src="/renter-portal-preview-v3.png"
            alt="Drive247 renter portal showing bookings, payments, ID verification, and messaging"
            width={1440}
            height={828}
            className="w-full dark:hidden"
          />
          <Image
            src="/renter-portal-preview-v3-dark.png"
            alt="Drive247 renter portal showing bookings, payments, ID verification, and messaging"
            width={1440}
            height={828}
            className="hidden w-full dark:block"
          />
        </div>
        <div className="-mt-8 ml-8 overflow-hidden rounded-xl border bg-background shadow-xl shadow-indigo-900/10 opacity-85 sm:-mt-12 sm:ml-16 lg:-mt-20 lg:ml-20">
          <Image
            src="/booking-preview-v4.png"
            alt="Drive247 branded booking flow showing trip details, vehicle selection, and insurance steps"
            width={1440}
            height={828}
            className="w-full dark:hidden"
          />
          <Image
            src="/booking-preview-v4-dark.png"
            alt="Drive247 branded booking flow showing trip details, vehicle selection, and insurance steps"
            width={1440}
            height={828}
            className="hidden w-full dark:block"
          />
        </div>
      </div>
      <div className="absolute -right-4 -top-4 -z-10 h-32 w-32 rounded-full bg-indigo-200/40 blur-2xl" />
      <div className="absolute -bottom-6 -left-6 -z-10 h-40 w-40 rounded-full bg-indigo-100/50 blur-2xl" />
    </div>
  );
}

export function Hero() {
  return (
    <AuroraBackground className="pb-4 pt-12 sm:pb-6 sm:pt-16 lg:pt-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left — copy */}
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
              Built for established US rental operators
            </p>

            <h1 className="mt-6 text-4xl font-extrabold tracking-tighter leading-[1.05] text-foreground sm:text-5xl sm:leading-[1.05] lg:text-[3.5rem] lg:leading-[1.02]">
              Own your bookings.
              <br />
              <span className="bg-gradient-to-r from-indigo-600 to-indigo-400 bg-clip-text text-transparent">
                Grow beyond marketplaces.
              </span>
            </h1>

            <p className="mt-8 text-[15px] leading-relaxed text-muted-foreground lg:max-w-[21rem]">
              Everything you need to run direct — website, dashboard, renter
              portal and payments — under your brand.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Button
                asChild
                size="lg"
                className="bg-indigo-600 text-sm font-normal shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30"
              >
                <a
                  href={CALENDLY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book a strategy call
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="text-sm font-normal"
                asChild
              >
                <a href="#features">See how it works</a>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2">
              {["Booking Website", "Admin Dashboard", "Renter Portal"].map(
                (item) => (
                  <span
                    key={item}
                    className="rounded-full border border-indigo-200/40 bg-indigo-50/30 px-3 py-1 text-xs font-medium text-indigo-600/80 dark:border-indigo-800/25 dark:bg-indigo-950/25 dark:text-indigo-400/80"
                  >
                    {item}
                  </span>
                )
              )}
            </div>
          </div>

          {/* Right — product mockup */}
          <div className="hidden lg:block">
            <DashboardPreview />
          </div>
        </div>

        {/* Mobile mockup */}
        <div className="mt-10 lg:hidden">
          <DashboardPreview />
        </div>
      </div>
    </AuroraBackground>
  );
}
