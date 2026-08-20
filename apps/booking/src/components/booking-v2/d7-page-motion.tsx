"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { loadGsap } from "./d7-motion";

/**
 * Scroll reveals for the pages booking-v2 inherits rather than owns.
 *
 * The landing animates section by section with framer-motion, because it was
 * built for it. /fleet, /about, /contact and the rest were not, so this applies
 * the same vocabulary — a short rise out of a blur — to their sections using
 * GSAP ScrollTrigger, without touching a single one of those files.
 *
 * Two deliberate safeguards, because a reveal that misfires hides content:
 *
 *  - `fromTo` with `immediateRender: false`. The element keeps its natural
 *    appearance until its trigger actually fires, so if ScrollTrigger never
 *    runs the page is simply un-animated rather than blank.
 *  - only sections BELOW the fold are animated. Animating what is already on
 *    screen would flash it out and back in on load.
 */
export function D7PageMotion() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    /* The landing runs its own, richer reveals — don't double up. */
    if (document.querySelector("[data-d7-landing]")) return;

    let ctx: { revert: () => void } | null = null;
    let cancelled = false;

    /* Let the route paint and its data settle before measuring positions. */
    const timer = setTimeout(() => {
      loadGsap().then(bundle => {
        if (!bundle || cancelled) return;
        const { gsap } = bundle;

        const sections = Array.from(document.querySelectorAll<HTMLElement>("section"))
          .filter(el => !el.closest("header") && !el.closest("footer"))
          .filter(el => el.getBoundingClientRect().top > window.innerHeight * 0.9)
          .slice(0, 24);

        if (!sections.length) return;

        ctx = gsap.context(() => {
          sections.forEach(el => {
            gsap.fromTo(el,
              { opacity: 0, y: 34, filter: "blur(6px)" },
              {
                opacity: 1, y: 0, filter: "blur(0px)",
                duration: 0.85, ease: "power3.out",
                immediateRender: false,
                scrollTrigger: { trigger: el, start: "top 88%", once: true },
              });
          });
        });
      });
    }, 450);

    return () => { cancelled = true; clearTimeout(timer); ctx?.revert(); };
  }, [pathname]);

  return null;
}
