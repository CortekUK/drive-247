import { Geist_Mono, Manrope, Unbounded } from "next/font/google";
import type { SignupPlan } from "@/lib/plans";
import type { PromoOffer } from "@/lib/promo-offer";
import { BookingsSection } from "./bookings-section";
import { Hero247Tour } from "./hero-247-tour";
import { IntegrationsSection } from "./integrations-section";
import { RentalsSection } from "./rentals-section";
import { TraxSection } from "./trax-section";
import "./landing-v2.css";

/*
 * The v2 landing page, served when the super-admin switch says "v2" or on
 * `/?landing=v2`.
 *
 * Being rebuilt one section at a time (Ghulam, 2026-10-07) on a plain canvas
 * in the brand indigo, #442DD7 (brighter and darker steps were tried; this
 * one stayed). Every section is a single centred column, never split left
 * and right. The full earlier draft is parked in sections-draft.tsx.
 *
 * `plans` and `offer` still arrive from page.tsx so pricing and referral
 * arrivals can be wired back in when those sections return.
 */

// The portal v2 typeface (apps/portal/src/app/layout.tsx).
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
// The 24/7 hero's display and mono faces (Claude Design, Hero 24-7 Tour).
const unbounded = Unbounded({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-unbounded", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

export function LandingV2(_props: {
  plans: readonly SignupPlan[] | null;
  offer: PromoOffer | null;
}) {
  return (
    <main id="main" className={`${manrope.variable} ${unbounded.variable} ${geistMono.variable} lv2-canvas`}>
      <Hero247Tour />
      <TraxSection />
      <BookingsSection />
      <RentalsSection />
      <IntegrationsSection />
    </main>
  );
}
