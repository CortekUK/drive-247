import { Button } from "@/components/ui/button";
import Image from "next/image";
import { ArrowRight, Check } from "lucide-react";
import type { CSSProperties } from "react";
import { HeroTitle } from "./hero-motion";
import "./hero.css";

/*
 * One job per tile, close enough to read. `aspect` is never narrower than the picture, so
 * a tile can only lose the foot of a long list, never its sides.
 */
type Screen = { label: string; light: string; dark: string; aspect: number };
const close = (name: string, label: string, aspect: number): Screen => ({
  label,
  light: `/v2/hero/close-${name}.webp`,
  dark: `/v2/hero/close-${name}-dark.webp`,
  aspect,
});

const SCREENS: Screen[] = [
  close("requests", "Every booking request", 0.82),
  close("insights", "Payments and profit", 1.22),
  close("agreements", "Agreements, signed", 1.6),
  close("site", "Your own website", 1.6),
  { label: "Your renters' portal", light: "/v2/phone-renter.png", dark: "/v2/phone-renter-dark.png", aspect: 0.62 },
  close("fleet", "Your fleet", 2.08),
  close("trax", "Trax answers", 0.8),
];

/**
 * Three things a first-time visitor should know before scrolling: it is free to try,
 * Drive247 takes no cut of their bookings, and someone will help them set up.
 *
 * `trialDays` comes from the live plans (the shortest trial among them), so the chip
 * never promises more than every plan gives; with no trial on offer it is left out.
 * "0% commission" is true on every charge path today (no application fees), and the
 * free 30-minute onboarding call is offered to every self-serve signup.
 */
function proofPoints(trialDays: number): string[] {
  return [
    ...(trialDays > 0 ? [`${trialDays}-day free trial`] : []),
    "Free onboarding call",
    // Longest last: on a phone the first two then share a row.
    "0% commission on your bookings",
  ];
}

export function Hero({ trialDays = 0 }: { trialDays?: number }) {
  const proof = proofPoints(trialDays);

  return (
    <section className="hg-hero">
      <div className="hg-grid" aria-hidden />

      {/* The white-lettered logo in both themes: the top of the hero is always midnight. */}
      <div className="hg-top">
        <a href="/" className="hg-logo" aria-label="Drive247 home">
          <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} priority />
        </a>
        <nav className="hg-nav" aria-label="Get started">
          <Button asChild size="sm" className="hg-ghost">
            <a href="/strategy-call">Book a demo</a>
          </Button>
          <Button asChild size="sm" className="hg-primary">
            <a href="#pricing">Start free trial</a>
          </Button>
        </nav>
      </div>

      <div className="hg-copy">
        <HeroTitle />

        <p className="hg-sub text-base leading-relaxed text-white/85 sm:text-lg">
          For <b className="hg-who">independent car rental operators</b>. Bookings, payments, agreements, your website and Trax, all in one place.
        </p>

        <ul className="hg-proof" aria-label="What you get">
          {proof.map((point) => (
            <li key={point}>
              <Check strokeWidth={2.5} aria-hidden />
              {point}
            </li>
          ))}
        </ul>

        {/* Phones only: the two first steps, big enough to thumb, where the eye already is.
            The top-row buttons hide at this width, so these are the same two, not extra ones. */}
        <div className="hg-cta">
          <Button asChild className="hg-primary hg-cta-main">
            <a href="#pricing">
              Start free trial
              <ArrowRight aria-hidden />
            </a>
          </Button>
          <Button asChild className="hg-ghost hg-cta-alt">
            <a href="/strategy-call">Book a demo</a>
          </Button>
        </div>
      </div>

      {/* Real screens, edge to edge. The set is doubled so the loop has no seam. */}
      <div className="hg-marquee" role="img" aria-label="Drive247 screens: booking requests, payments and profit, agreements, your website, the renter portal, your fleet and Trax">
        <div className="hg-track">
          {[0, 1].map((set) => (
            <div key={set} className="hg-set">
              {SCREENS.map((screen) => {
                const sizes = `${Math.ceil(70 * screen.aspect)}vh`;
                return (
                  <div
                    key={screen.label}
                    className="hg-col"
                    // `--a` lets a phone cap the width of the wide screens (hero.css).
                    style={{ aspectRatio: screen.aspect, "--a": screen.aspect } as CSSProperties}
                  >
                    <div className="hg-tile">
                      <div className="hg-shot">
                        <Image src={screen.light} alt="" fill sizes={sizes} className="dark:hidden" />
                        <Image src={screen.dark} alt="" fill sizes={sizes} className="hidden dark:block" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
