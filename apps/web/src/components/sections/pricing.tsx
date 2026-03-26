"use client";

import { PRICING_TIERS, CALENDLY_URL } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";

function PricingCard({
  tier,
  visible,
  delay,
}: {
  tier: (typeof PRICING_TIERS)[number];
  visible: boolean;
  delay: number;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${tier.popular ? "ring-2 ring-indigo-600 dark:ring-indigo-400" : ""}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition:
          "opacity 600ms ease-out, transform 600ms ease-out, box-shadow 300ms",
        transitionDelay: visible ? `${delay}ms` : "0ms",
      }}
    >
      {/* Top accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />

      <div className="flex h-full flex-col p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold">{tier.name}</h3>
          {tier.popular && (
            <span className="rounded-full bg-indigo-600/10 px-2.5 py-0.5 text-xs font-semibold text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-400">
              Most popular
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {tier.vehicleLimit}
        </p>

        <div className="mt-5">
          <span className="text-4xl font-bold tracking-tight">
            ${tier.price}
          </span>
          <span className="text-sm text-muted-foreground">/mo</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          One-time onboarding: ${tier.setupFee.toLocaleString()}
        </p>

        <div className="my-6 h-px bg-border" />

        <ul className="flex-1 space-y-3">
          {tier.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
              {feature}
            </li>
          ))}
        </ul>

        <a
          href={CALENDLY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-8 block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-colors ${
            tier.popular
              ? "bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              : "border border-indigo-600/30 text-indigo-600 hover:bg-indigo-600/5 dark:border-indigo-400/30 dark:text-indigo-400 dark:hover:bg-indigo-400/5"
          }`}
        >
          Book a strategy call
        </a>
      </div>
    </div>
  );
}

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
          Simple, transparent{" "}
          <span className="text-indigo-600 dark:text-indigo-400">pricing</span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
          Flat monthly fee. No commissions, no per-booking charges, no surprises.
        </p>

        <div
          ref={ref}
          className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {PRICING_TIERS.map((tier, i) => (
            <PricingCard
              key={tier.name}
              tier={tier}
              visible={visible}
              delay={i * 100}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Most operators recoup setup costs within the first month of direct
          bookings.
        </p>
      </div>
    </section>
  );
}
