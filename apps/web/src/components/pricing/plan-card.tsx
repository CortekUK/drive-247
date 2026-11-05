"use client";


import { Button } from "@/components/ui/button";
import { useOptionalOnboarding } from "@/components/onboarding/onboarding-provider";
import {
  formatPlanPriceUsd,
  type SignupPlan,
  type SignupPlanId,
} from "@/lib/plans";
import { discountedPrice, type PromoOffer } from "@/lib/promo-offer";
import { cn } from "@/lib/utils";
import "./plan-cards.css";

/** "$79", "$79.20". */
function formatUsd(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

interface PlanCardProps {
  plan: SignupPlan;
  /**
   * Where a press goes instead of the live signup dialog.
   *
   * Omitted everywhere the marketing site renders the grid, which is the whole
   * point of the card. It exists for a surface that drives its own flow from the
   * same cards rather than a hand-maintained copy of them — see
   * `components/signup-journey/`.
   */
  onSelect?(planId: SignupPlanId): void;
  /** A Drive247 promo / referral code the visitor carries: shown as the discounted price. */
  offer?: PromoOffer | null;
  /** The card's colour; the grid deepens it plan by plan. */
  tone?: "lilac" | "brand" | "deep";
  /** Off when the section states one shared trial above the cards. */
  showTrial?: boolean;
}

/**
 * One tier in the pricing grid.
 *
 * The card is deliberately static markup with a single real <button>: it renders
 * and reads correctly before React hydrates (and with JS off entirely), the
 * Subscribe button is simply inert until the provider is live. That is why
 * there is no loading skeleton and no `disabled` state here — an inert button
 * for ~200 ms beats a layout shift on the highest-intent section of the page.
 *
 * Must be rendered inside <OnboardingProvider> (supplied by PricingSection)
 * UNLESS `onSelect` is given, in which case the provider is never consulted.
 */
export function PlanCard({ plan, onSelect, offer, tone = "lilac", showTrial = true }: PlanCardProps) {
  // `open()` never throws and never rejects — every failure mode (missing Stripe
  // config, missing Supabase env, a dead network) surfaces as a banner inside the
  // dialog itself, per the onboarding spec. The card therefore has no error
  // branch of its own: clicking Subscribe always produces visible feedback.
  const onboarding = useOptionalOnboarding();

  // Kept as loud as the old `useOnboarding()` throw: a card with neither a
  // handler nor a provider is a Subscribe button that does nothing, and that
  // must never reach the marketing page silently.
  if (!onSelect && !onboarding) {
    throw new Error(
      "<PlanCard> needs either an onSelect handler or <OnboardingProvider>",
    );
  }

  const trialDays = plan.trialDays ?? 0;

  const handlePress = () => {
    if (onSelect) onSelect(plan.id);
    else onboarding?.open(plan.id);
  };

  return (
    <div className={cn("pc-card", tone !== "lilac" && `is-${tone}`)}>
      {plan.highlighted && <span className="pc-tag">Most popular</span>}

      <div>
        <p className="pc-name">{plan.name}</p>
        <p className="pc-band">{plan.fleetBand}</p>
      </div>

      <div>
        <div className="pc-price">
          {offer && (
            <span className="pc-was" aria-label={`was ${formatPlanPriceUsd(plan)}`}>
              {formatPlanPriceUsd(plan)}
            </span>
          )}
          <span className="pc-amount">
            {offer ? formatUsd(discountedPrice(plan.priceUsd, offer)) : formatPlanPriceUsd(plan)}
          </span>
          <span className="pc-per">/month</span>
        </div>
        {offer && (
          <p className="pc-note">
            {offer.discountText} {offer.durationText}
          </p>
        )}
        {/* Said once above the grid when every plan has the same trial. */}
        {showTrial && trialDays > 0 && (
          <p className="pc-note">{trialDays}-day free trial · card required, cancel anytime</p>
        )}
      </div>

      <p className="pc-tagline">{plan.tagline}</p>

      <Button
        size="lg"
        onClick={handlePress}
        // Several buttons with one label are ambiguous when a screen reader lists
        // them out of context, so the accessible name carries the tier and price.
        aria-label={
          trialDays > 0
            ? `Start a ${trialDays}-day free trial of ${plan.name}, then ${formatPlanPriceUsd(plan)} per month`
            : `Subscribe to ${plan.name} — ${formatPlanPriceUsd(plan)} per month`
        }
        className="pc-btn"
      >
        {trialDays > 0 ? "Start free trial" : "Subscribe"}
      </Button>

      <ul className="pc-list">
        {plan.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}
