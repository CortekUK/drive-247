import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PricingSection } from "@/components/sections/pricing";
import { fetchSignupPlans } from "@/lib/plans-server";

/**
 * Standing preview of the self-serve signup flow. OFF by default.
 *
 * THE FLOW, AS IT STANDS
 * ----------------------
 *   pricing card -> account -> payment -> provisioning -> "Go to portal"
 *
 * The account step collects the credential (email + password, or Google when
 * that is switched on) AND the tenant identity: business name, the web address
 * with live availability, and the terms tick. There is no separate business step
 * any more — everything it used to ask for after the card was charged is either
 * required here, before any money moves, or collected by the portal's own
 * first-run wizard where it can be edited.
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * The public marketing page (`(marketing)/page.tsx`) deliberately does NOT
 * render <PricingSection>. On `main` the live pricing CTA is still "Get your
 * custom quote on a strategy call" -> /strategy-call, and it stays that way
 * until switching self-serve on is a decision somebody makes on purpose.
 *
 * That is the gate. <PricingSection> is the entry point to a flow that creates
 * an auth user, TAKES A CARD PAYMENT and provisions a real tenant — so adding
 * one import to the marketing page turns drive-247.com into a live public
 * checkout. Landing the code and flipping that switch are two separate events,
 * and this route is what keeps them separable: the flow can be exercised end to
 * end here while every visitor to the homepage keeps seeing exactly the page
 * they saw yesterday.
 *
 * This mirrors the pattern V2_PLAN §3/§11 points at —
 * `apps/booking/src/app/booking-v2/page.tsx` — a standing preview route that
 * renders the new design regardless of any flag, so it can be reviewed without
 * switching anyone over.
 *
 * WHY IT IS ENV-GATED AND NOT MERELY UNLISTED
 * -------------------------------------------
 * `noindex` is not access control, and an unlisted URL is not a closed door.
 * The signup-* edge functions are ALREADY DEPLOYED AND LIVE on production, and
 * `getSignupStripeMode()` in `_shared/signup-stripe.ts` defaults to **live**:
 *
 *     Deno.env.get("SIGNUP_STRIPE_MODE") === "test" ? "test" : "live"
 *
 * `SIGNUP_STRIPE_MODE` IS set on the production project, but its value is
 * write-only through the Management API, so nothing in this repo can prove it
 * says "test". If it does not, anyone who reaches this page and completes the
 * form is charged a real card and provisioned as a real tenant sitting beside
 * the 32 paying operators.
 *
 * So the route stays closed until someone opens it deliberately, and the check
 * is SERVER-SIDE — a NEXT_PUBLIC_ variable would be readable in the client
 * bundle and would advertise the route's existence to anyone reading the JS.
 *
 * TO OPEN IT: confirm `SIGNUP_STRIPE_MODE=test` on the Supabase project first,
 * then set `SIGNUP_PREVIEW_ENABLED=true` in the apps/web Vercel environment.
 *
 * TO GO FULLY LIVE, when that is the decision: import PricingSection into
 * `(marketing)/page.tsx`, render it between <Timeline /> and <FAQSection />,
 * take the `#pricing` links in header.tsx and footer.tsx from the source
 * branch, and delete this route. Nothing else moves.
 *
 * The Google button is a separate switch again, and off by default:
 * `NEXT_PUBLIC_SIGNUP_GOOGLE_ENABLED`. It needs a Google provider enabled on the
 * Supabase project (currently disabled on prod AND staging) and
 * `supabase/functions/signup-begin-oauth` deployed. See .env.example.
 *
 * NOT A TENANT GATE, deliberately. The v2 canary model keys on tenant slug
 * (`lib/v2.ts`, `lib/lean-areas.ts`), but a visitor reading the marketing site
 * has no tenant — creating one is the entire point of the flow — so there is no
 * slug to resolve and `isV2('signup', slug)` would have nothing to answer.
 * Route separation plus an off-by-default env switch is the honest equivalent.
 */
export const metadata: Metadata = {
  title: "Signup preview — Drive247",
  robots: { index: false, follow: false },
};

/**
 * Matches the marketing page's ISR window so the preview and the eventual
 * public page behave identically — an admin toggling a plan sees the same
 * 10-second lag here that a visitor would see there. Must stay a literal: Next
 * parses segment config statically and rejects an imported constant.
 */
export const revalidate = 10;

/** Off unless explicitly opened. Any value other than "true" keeps it closed. */
function previewEnabled(): boolean {
  return process.env.SIGNUP_PREVIEW_ENABLED === "true";
}

export default async function SignupPreviewPage() {
  // Fails CLOSED. An unset, misspelt or empty variable is a 404, never a live
  // checkout — the same direction every other gate in this codebase fails.
  if (!previewEnabled()) notFound();

  // Never throws and never returns empty: a Supabase outage yields the
  // hardcoded catalogue rather than a failed build or a blank pricing grid.
  const plans = await fetchSignupPlans();

  return (
    <main>
      <PricingSection plans={plans} />
    </main>
  );
}
