"use client";

import { Check } from "lucide-react";

import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import { PlanCard } from "@/components/pricing/plan-card";
import { useFadeIn } from "@/hooks/use-fade-in";
import {
  PLATFORM_INCLUDED,
  PRICING_FOOTNOTE,
  SIGNUP_PLANS,
  type SignupPlan,
} from "@/lib/plans";

interface PricingSectionProps {
  /**
   * The live catalogue, read from `signup_plans` by the (server) marketing page.
   *
   * Optional, and defaulted to the hardcoded three, for one reason: this section
   * must never render an empty grid. A caller that forgets the prop, or a fetch
   * that came back with nothing, still gets three cards.
   */
  plans?: readonly SignupPlan[];
}

/**
 * The public pricing grid and the entry point to self-serve signup.
 *
 * `id="pricing"` is load-bearing twice over: it is the target of the `#pricing`
 * links in the header, the footer and NAV_LINKS, and `use-active-section.ts`
 * observes that exact element id for the scroll-spy.
 *
 * <OnboardingProvider> wraps the cards (not the page) because it owns all signup
 * state and network, and it also mounts the onboarding dialog and the
 * provisioning overlay. Scoping it here keeps the rest of the marketing page a
 * server component and means a visitor who never scrolls to pricing pays nothing
 * for the flow.
 *
 * The same `plans` array goes to the cards AND to the provider. The dialog runs
 * in the browser and would otherwise have to resolve its own copy from the
 * hardcoded catalogue — so a visitor could read $199 on a card and then be shown
 * a different figure in the dialog header and order summary. One array, one
 * price.
 */
export function PricingSection({ plans = SIGNUP_PLANS }: PricingSectionProps) {
  const { ref, visible } = useFadeIn();

  // Belt and braces against an empty array reaching the grid: `fetchSignupPlans`
  // already falls back, but a default parameter only fires for `undefined`.
  const catalogue = plans.length > 0 ? plans : SIGNUP_PLANS;

  return (
    <OnboardingProvider plans={catalogue}>
      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="bg-muted/50 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Section heading */}
          <div className="flex items-center justify-center gap-4">
            <div className="h-px w-12 bg-border" />
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Pricing
            </p>
            <div className="h-px w-12 bg-border" />
          </div>

          <h2
            id="pricing-heading"
            className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight"
          >
            Simple pricing,{" "}
            <span className="text-indigo-600 dark:text-indigo-400">
              sized to your fleet
            </span>
          </h2>

          <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
            Pick the plan that fits your fleet today. Every plan includes the
            whole platform — you can be taking direct bookings the same day.
          </p>

          {/* Cards. useFadeIn is applied once, on the wrapper, exactly as the
              other sections do — the observer is one-shot, so it must sit on a
              node that is present from first paint. */}
          <div
            ref={ref}
            // `items-stretch` (not `items-start`) is what makes the three cards
            // one height: each PlanCard is `h-full`, so it only fills the row if
            // the row stretches it. With `items-start` every card shrink-wrapped
            // its own content and the tiers ended up visibly different sizes.
            className={`mt-12 grid gap-6 md:grid-cols-3 md:items-stretch ${
              visible ? "fade-in-visible" : "fade-in-hidden"
            }`}
          >
            {catalogue.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>

          {/* Nothing in PLATFORM_INCLUDED is plan-gated, which is exactly why it
              is listed once here instead of being repeated on all three cards. */}
          <div className="mt-12 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <h3 className="text-center text-lg font-semibold tracking-tight">
              Every plan includes the full platform
            </h3>
            <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORM_INCLUDED.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2.5 text-sm text-muted-foreground"
                >
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400"
                    aria-hidden="true"
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {PRICING_FOOTNOTE}
          </p>
        </div>
      </section>
    </OnboardingProvider>
  );
}
