"use client";

import { CtaBand, Footer } from "./d7-close";
import { Fleet, Ticker } from "./d7-fleet";
import { d7Display, d7Ui } from "./d7-fonts";
import { Hero } from "./d7-hero";
import { Cursor, SmoothScroll } from "./d7-motion";
import { D7Nav } from "./d7-nav";
import { OffersRow } from "./d7-offers";
import { D7ThemeInit } from "./d7-theme";
import { ScrollProgress } from "./d7-ui";
import { WhyChoose } from "./d7-why";
import "./v2.css";

/**
 * Drive247 — booking-v2 landing.
 *
 * Design only. Nothing is fetched, validated, priced or submitted; every
 * value on the page comes from `d7-data.ts`, so a tenant serving this sees
 * placeholder vehicles and rates rather than their own inventory.
 *
 * hero + search + promise strip → trust ticker → fleet rail →
 * why choose + counted stats → offers / reviews / journal → cta → footer
 *
 * Motion: framer-motion for reveals, layout transitions and scroll progress;
 * GSAP ScrollTrigger (via d7-motion) for parallax, driven off Lenis;
 * Aceternity UI and Magic UI effects live in d7-ui.tsx.
 *
 * Everything is namespaced under `.d7`, which is why this can be dropped into
 * the tenant home page without colliding with globals.css.
 */
export default function BookingV2Landing() {
  return (
    <div className={`d7 ${d7Display.variable} ${d7Ui.variable}`}>
      <Cursor>
        <D7ThemeInit />
        <SmoothScroll />
        <ScrollProgress />
        <D7Nav />
        <main>
          <Hero />
          <Ticker />
          <Fleet />
          <WhyChoose />
          <OffersRow />
          <CtaBand />
        </main>
        <Footer />
      </Cursor>
    </div>
  );
}
