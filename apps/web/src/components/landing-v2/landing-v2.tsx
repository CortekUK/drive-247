import { DM_Sans, Manrope, Playfair_Display } from "next/font/google";
import type { SignupPlan } from "@/lib/plans";
import { fetchSignupPlans } from "@/lib/plans-server";
import type { PromoOffer } from "@/lib/promo-offer";
import { LandingV4 } from "@/components/landing-v4/landing-v4";

/*
 * The v2 landing page, served when the super-admin switch says "v2" or on
 * `/?landing=v2`.
 *
 * Since 2026-10-20 this renders components/landing-v4: the page reworked after
 * the team review of Claude Design's "Drive247 Landing v3" (components/landing-v3,
 * no longer mounted). Its Trax, testimonials, FAQ, CTA and footer are v3's own;
 * the rest is rebuilt in the portal v2 design language. The whole page is set in
 * the portal's typeface. The earlier section-by-section rebuild in this folder is
 * not mounted either.
 *
 * Pricing shows the live signup catalogue. page.tsx only fetches it while the
 * self-serve pricing switch is on, so it is read here otherwise. `offer` still
 * arrives for when referral arrivals are wired back in.
 */

// The portal v2 typeface (apps/portal/src/app/layout.tsx), used for the whole page.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
// The northwind v1 booking site's face — only inside the website-editor mock-up, which shows that site.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
// The booking widget's headings (Inter body comes from the root layout's --font-sans) — only in the checkout mock-up.
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-playfair", display: "swap" });

export async function LandingV2({
  plans,
}: {
  plans: readonly SignupPlan[] | null;
  offer: PromoOffer | null;
}) {
  const catalogue = plans ?? (await fetchSignupPlans());
  return (
    <div className={`${manrope.variable} ${dmSans.variable} ${playfair.variable}`}>
      <LandingV4 plans={catalogue} />
    </div>
  );
}
