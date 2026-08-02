"use client";

import { ArrowRight, Check, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "@/components/onboarding/onboarding-provider";
import { formatPlanPriceUsd, type SignupPlan } from "@/lib/plans";
import { cn } from "@/lib/utils";

interface PlanCardProps {
  plan: SignupPlan;
}

/**
 * One tier in the pricing grid.
 *
 * The card is deliberately static markup with a single real <button>: it renders
 * and reads correctly before React hydrates (and with JS off entirely), the
 * Subscribe button is simply inert until `useOnboarding` is live. That is why
 * there is no loading skeleton and no `disabled` state here — an inert button
 * for ~200 ms beats a layout shift on the highest-intent section of the page.
 *
 * Must be rendered inside <OnboardingProvider> (supplied by PricingSection).
 */
export function PlanCard({ plan }: PlanCardProps) {
  // `open()` never throws and never rejects — every failure mode (missing Stripe
  // config, missing Supabase env, a dead network) surfaces as a banner inside the
  // dialog itself, per the onboarding spec. The card therefore has no error
  // branch of its own: clicking Subscribe always produces visible feedback.
  const { open } = useOnboarding();

  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:shadow-md",
        plan.highlighted
          ? // The lift is `md:`-prefixed so the recommended card does not float out
            // of alignment on a phone, where the grid is a single column — there it
            // reads as recommended from the indigo border and the badge alone.
            "border-indigo-600/40 shadow-lg shadow-indigo-600/10 dark:border-indigo-400/30 md:-mt-4 md:pb-10"
          : "border-border"
      )}
    >
      {/* Top accent hairline — a hint of the brand indigo without a full gradient. */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
          plan.highlighted ? "via-indigo-600/40" : "via-indigo-600/20"
        )}
      />

      {plan.highlighted && (
        <Badge className="absolute right-5 top-5 gap-1 bg-indigo-600 text-white dark:bg-indigo-500">
          <Sparkles className="h-3 w-3" aria-hidden="true" /> Most popular
        </Badge>
      )}

      <p className="text-sm font-semibold tracking-tight">{plan.name}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">
        {plan.fleetBand}
      </p>

      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-4xl font-bold tracking-tighter">
          {formatPlanPriceUsd(plan)}
        </span>
        <span className="text-sm text-muted-foreground">/month</span>
      </div>
      {/* min-h keeps the three CTAs on one baseline when taglines wrap differently. */}
      <p className="mt-2 min-h-[2.5rem] text-sm leading-relaxed text-muted-foreground">
        {plan.tagline}
      </p>

      <Button
        size="lg"
        onClick={() => open(plan.id)}
        // Three buttons all labelled "Subscribe" are ambiguous when a screen
        // reader lists them out of context, so the accessible name carries the
        // tier and the price.
        aria-label={`Subscribe to ${plan.name} — ${formatPlanPriceUsd(plan)} per month`}
        variant={plan.highlighted ? "default" : "outline"}
        className={cn(
          "mt-6 w-full",
          plan.highlighted &&
            "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        )}
      >
        Subscribe <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <ul className="mt-6 space-y-2.5 border-t pt-6">
        {plan.bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-2.5 text-sm text-muted-foreground"
          >
            <Check
              className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400"
              aria-hidden="true"
            />
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}
