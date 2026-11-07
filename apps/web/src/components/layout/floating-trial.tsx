"use client";

import { useEffect, useState } from "react";

import { HeaderCta } from "./header-cta";
import "./floating-trial.css";

/**
 * The landing page's one floating button, bottom right (Ghulam, 2026-11-07: no nav bar
 * once the hero scrolls away; if only one button stays, it is "Start free trial").
 *
 * It appears once the hero's own buttons have scrolled off, and steps aside while
 * Pricing, the closing section or the footer is on screen, because each of those
 * already offers the same step. Like the old header button it becomes "Dashboard" for
 * an operator who is already signed in on drive-247.com.
 */
const COVERED_BY = ["#pricing", "#nb-title", "footer"];

export function FloatingTrial() {
  const [pastHero, setPastHero] = useState(false);
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    const onScroll = () => setPastHero(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const targets = COVERED_BY.map((selector) => {
      const el = document.querySelector(selector);
      // The closing section is watched as a whole, not just its heading.
      return selector === "#nb-title" ? el?.closest("section") ?? null : el;
    }).filter((el): el is Element => el !== null);
    if (!targets.length) return;

    const onScreen = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onScreen.add(entry.target);
          else onScreen.delete(entry.target);
        }
        setCovered(onScreen.size > 0);
      },
      // "On screen" means crossing the middle of the screen, which works the same for a
      // short section and for Pricing, which is many screens tall on a phone.
      { rootMargin: "-35% 0px -35% 0px", threshold: 0 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  const shown = pastHero && !covered;

  return (
    <div className={`fcta${shown ? " is-shown" : ""}`} aria-hidden={!shown || undefined} inert={!shown || undefined}>
      <HeaderCta label="Start free trial" href="#pricing" className="fcta-btn" />
    </div>
  );
}
