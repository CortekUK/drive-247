import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SignupJourney } from "@/components/signup-journey/signup-journey";
import { fetchSignupPlans } from "@/lib/plans-server";

/**
 * The whole first-run journey on one surface: choose a plan on the real pricing
 * grid, create an account, confirm by code, pay with a real Stripe card form,
 * land in the portal.
 *
 * Step one is `<PricingSection>` itself — the component the marketing page
 * renders — handed an `onSelectPlan` callback. There is no second pricing page
 * to keep in step with the first.
 *
 * DEVELOPMENT ONLY, AND STRUCTURALLY SO
 * -------------------------------------
 * The guard is written DEV-BRANCH-FIRST on purpose, and the order is the whole
 * point:
 *
 *     if (IS_DEV) { …render… }
 *     notFound();
 *
 * `process.env.NODE_ENV` is replaced with a string literal at build time, so in
 * a production build `IS_DEV` folds to `false`, the branch folds away with it,
 * `<SignupJourney>` becomes an unreferenced import, and the whole tree is
 * tree-shaken out of the bundle. Nothing of it ships.
 *
 * The obvious spelling — `if (!IS_DEV) notFound(); return <Flow/>;` — does NOT
 * do that. No minifier knows `notFound()` never returns, so the render stays
 * reachable and every byte of this flow, including the Stripe test key it
 * defaults to, is bundled into production and merely 404s at runtime. A route
 * that exists and refuses is not the same thing as a route that does not exist.
 *
 * `notFound()` is still called: it is the runtime guarantee for the one build
 * where the fold does not happen (`next dev` behind `NODE_ENV=production`, an
 * unminified debug build, a future bundler change).
 *
 * WHY `SIGNUP_PREVIEW_ENABLED` IS GONE
 * ------------------------------------
 * This route used to render the REAL signup — the one that creates an
 * `auth.users` row, TAKES A CARD PAYMENT through the deployed `signup-*` edge
 * functions and provisions a tenant beside the paying operators. That needed a
 * switch a person turns on knowingly, because `getSignupStripeMode()` defaults
 * to **live** and nothing in this repo can prove production says otherwise.
 *
 * It no longer renders that. Nothing in this tree calls `signup-begin`,
 * `signup-begin-oauth`, `signup-slug-check`, `signup-payment-intent` or
 * `signup-provision`, so there is no charge to gate and no tenant to prevent —
 * and the stronger, simpler guarantee is that the route cannot exist in
 * production at all. An env switch is a runtime decision; this is a build-time
 * one. `SIGNUP_PREVIEW_ENABLED` in `.env.example` is now inert.
 *
 * WHAT IT IS SAFE TO ASSUME ABOUT IT
 * ----------------------------------
 * No auth user, no tenant, no subscription and no database write happens
 * anywhere in this tree. The only outbound request is Stripe's, from a
 * test-mode publishable key, to tokenise a card — no PaymentIntent, no charge.
 * See `lib/signup-journey.ts`.
 */
export const metadata: Metadata = {
  title: "Get started — Drive247",
  robots: { index: false, follow: false },
};

const IS_DEV = process.env.NODE_ENV === "development";

export default async function SignupPreviewPage() {
  if (IS_DEV) {
    // The live published catalogue, so step one quotes the same plans and the
    // same prices a visitor would see. Never throws and never returns empty —
    // a Supabase outage yields the hardcoded three rather than a blank grid.
    const plans = await fetchSignupPlans();
    return <SignupJourney plans={plans} />;
  }

  notFound();
}
