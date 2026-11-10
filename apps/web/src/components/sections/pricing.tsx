"use client";

import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import { EnterpriseCard } from "@/components/pricing/enterprise-card";
import { PlanCard } from "@/components/pricing/plan-card";
import { PricingBreakdown } from "@/components/pricing/pricing-breakdown";
import type { EnterpriseCard as EnterpriseCardData } from "@/lib/enterprise-card-server";
import { useFadeIn } from "@/hooks/use-fade-in";
import type { PromoOffer } from "@/lib/promo-offer";
import { Accent, SectionHeading } from "./section-heading";
import {
  SIGNUP_PLANS,
  type SignupPlan,
  type SignupPlanId,
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
  /**
   * Hand a plan press to the caller instead of opening the signup dialog.
   *
   * Omitted on the marketing page, which is the default and the reason this
   * section exists. Supplying it ALSO withholds <OnboardingProvider>: that
   * provider owns the live dialog, the provisioning overlay and a passive
   * session probe, and a caller running its own flow wants none of them on the
   * page.
   */
  onSelectPlan?(planId: SignupPlanId): void;
  /**
   * A Drive247 promo / referral code the visitor carries. The cards show the
   * discounted price; the signup dialog applies the code at payment.
   */
  offer?: PromoOffer | null;
  /** The contact-only Enterprise card, always last; null when it is switched off. */
  enterprise?: EnterpriseCardData | null;
  /**
   * Four long cards in one container, one per plan, each with its drawing, name and price
   * on top and the breakdown underneath (components/pricing/pricing-breakdown.tsx). The live landing page turns it
   * on; the signup journey, which only needs the cards, leaves it off.
   */
  detailed?: boolean;
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
export function PricingSection({
  plans = SIGNUP_PLANS,
  onSelectPlan,
  offer = null,
  enterprise = null,
  detailed = false,
}: PricingSectionProps) {
  // A low threshold: stacked on a phone the grid is far taller than the screen, and
  // the default 15% of it can be more than a short (landscape) viewport ever shows,
  // which would leave the cards invisible for good.
  const { ref, visible } = useFadeIn(0.04);

  // Belt and braces against an empty array reaching the grid: `fetchSignupPlans`
  // already falls back, but a default parameter only fires for `undefined`.
  const catalogue = plans.length > 0 ? plans : SIGNUP_PLANS;
  const cardCount = catalogue.length + (enterprise ? 1 : 0);
  // One line above the grid when every plan has the same trial. If a super admin
  // ever sets them differently, each card goes back to stating its own.
  const firstTrial = catalogue[0]?.trialDays ?? 0;
  const sharedTrial = catalogue.every((plan) => (plan.trialDays ?? 0) === firstTrial) ? firstTrial : null;
  const TONES = ["lilac", "brand", "deep"] as const;

  const section = (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className={`bg-muted/50 ${detailed ? "pb-section pt-2 pb-20 sm:pb-24" : "py-20 sm:py-24"}`}
    >
      <div className={`mx-auto max-w-[1360px] px-4 sm:px-6${detailed ? " pb-inner" : ""}`}>
        {/* No heading of its own on the landing page: "Your business, online in minutes. With
            simple pricing." above the Launch cards names it (get-started-intro.tsx). */}
        {detailed ? (
          <h2 id="pricing-heading" className="sr-only">
            Pricing
          </h2>
        ) : (
          <SectionHeading
            id="pricing-heading"
            title={
              <>
                Simple pricing, <Accent>sized to your fleet</Accent>
              </>
            }
          />
        )}

        {sharedTrial && !detailed ? (
          <p className="mt-4 text-center text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            {sharedTrial}-day free trial on every plan. Card required, cancel anytime.
          </p>
        ) : null}

        {detailed ? (
          <div ref={ref} className={`pb-body ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
            <PricingBreakdown plans={catalogue} enterprise={enterprise} offer={offer} onSelect={onSelectPlan} showTrial />
          </div>
        ) : (
          <>
        {/* Cards. useFadeIn is applied once, on the wrapper, exactly as the
              other sections do — the observer is one-shot, so it must sit on a
              node that is present from first paint. */}
          <div
            ref={ref}
            // `items-stretch` (not `items-start`) is what makes the three cards
            // one height: each PlanCard is `h-full`, so it only fills the row if
            // the row stretches it. With `items-start` every card shrink-wrapped
            // its own content and the tiers ended up visibly different sizes.
            /*
              Columns follow the number of VISIBLE plans, and the grid narrows to
              match. `md:grid-cols-3` was hardcoded, so hiding a plan in the admin
              dashboard left the remaining cards clinging to the left with a
              third of the row empty — the layout silently assumed three plans
              forever. One plan centres at card width, two at two-thirds, three
              at full width, so the section stays balanced whatever is published.
            */
            /*
              From md the cards share five rows (subgrid, in each card), so names,
              prices, descriptions, buttons and lists all line up across the row
              however long any one of them is. `pc-grid-wrap` marks the grid whose
              cards can wrap: the row gap has to be a margin there (plan-cards.css),
              because a grid gap would also open up inside each card.
            */
            className={`mx-auto mt-12 grid gap-4 md:items-stretch md:gap-y-0 ${
              cardCount === 1
                ? "max-w-sm md:grid-cols-1"
                : cardCount === 2
                  ? "max-w-3xl md:grid-cols-2"
                  : cardCount === 3
                    ? "md:grid-cols-3"
                    : "pc-grid-wrap md:grid-cols-2 lg:grid-cols-4"
            } ${visible ? "fade-in-visible" : "fade-in-hidden"}`}
          >
            {catalogue.map((plan, i) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onSelect={onSelectPlan}
                offer={offer}
                tone={TONES[Math.min(i, TONES.length - 1)]}
                showTrial={sharedTrial === null}
              />
            ))}
            {enterprise && <EnterpriseCard card={enterprise} />}
          </div>
          </>
        )}

      </div>
    </section>
  );

  // A caller that handles plan presses itself gets the grid and nothing else.
  if (onSelectPlan) return section;

  return <OnboardingProvider plans={catalogue}>{section}</OnboardingProvider>;
}
