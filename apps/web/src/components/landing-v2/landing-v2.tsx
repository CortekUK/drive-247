import { Bricolage_Grotesque, Geist_Mono, Instrument_Serif, Manrope, Unbounded } from "next/font/google";
import type { SignupPlan } from "@/lib/plans";
import type { PromoOffer } from "@/lib/promo-offer";
import { LandingV3 } from "@/components/landing-v3/landing-v3";

/*
 * The v2 landing page, served when the super-admin switch says "v2" or on
 * `/?landing=v2`.
 *
 * Since 2026-10-15 this renders Claude Design's "Drive247 Landing v3" in full
 * (components/landing-v3). The section-by-section rebuild below it (Trax,
 * Bookings, Rentals, Integrations, the 24/7 tour hero) is no longer mounted;
 * its files are left in place.
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
// Landing v3's display and mono faces (Claude Design).
const unbounded = Unbounded({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-unbounded", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });
// Landing v3 (Trax Glass): section headings, and the serif italic accents in them.
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz"], variable: "--font-bricolage", display: "swap" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap" });

export function LandingV2(_props: {
  plans: readonly SignupPlan[] | null;
  offer: PromoOffer | null;
}) {
  return <LandingV3 fontClasses={`${manrope.variable} ${unbounded.variable} ${geistMono.variable} ${instrumentSerif.variable} ${bricolage.variable}`} />;
}
