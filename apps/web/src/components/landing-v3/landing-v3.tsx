"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { LANDING_V3_MARKUP } from "./landing-v3-markup";
import { runLandingV3Design } from "./landing-v3-design";
import { installLucideShim } from "./landing-v3-lucide";
import "./landing-v3.css";
import "./landing-v3-responsive.css";

/*
 * Drive247 Landing v3 (Trax Glass) — Claude Design's
 * `ui_kits/landing/Drive247 Landing v3 - Trax Glass.html`, served as the v2
 * landing page (`/?landing=v2`).
 *
 * The design is one hand-written document whose markup, CSS and scripts are
 * carried over as they are (regenerated from the design, not re-authored), so
 * the page stays identical to it and can be re-synced:
 *
 *   landing-v3-markup.ts     generated — the design's <body>, icons inlined
 *   landing-v3.css           generated — the design's CSS, scoped to html.d3p
 *   landing-v3-design.ts     generated — the design's scripts, near-verbatim
 *   landing-v3-icons.ts      generated — lucide icon data the scripts read
 *   landing-v3-lucide.ts     stand-in for the lucide CDN script
 *   landing-v3-responsive.css  hand-written additions (kept across re-syncs)
 *   public/landing-v3/       images, product-section stylesheet, avatars
 *
 * The scripts have no teardown, by design: they own the whole document, and
 * every link out of this page is a plain <a> (a full navigation), so they live
 * exactly as long as the page does. They run once per page load.
 */

export function LandingV3({ fontClasses }: { fontClasses: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    // Once per page: React's dev double-invoke and fast refresh must not start
    // a second copy of the design's listeners and loops.
    if (!el || el.dataset.d3Ran) return;
    el.dataset.d3Ran = "1";
    const html = document.documentElement;
    html.classList.add(...fontClasses.split(/\s+/).filter(Boolean));
    // The globals the design loads from CDNs, provided from npm.
    Object.assign(window, { gsap, ScrollTrigger, Lenis });
    installLucideShim();
    runLandingV3Design();
    // the pre-hydration seal (inline script below) hands over to body.sealed
    html.classList.remove("d3p-sealed");
  }, [fontClasses]);

  return (
    <>
      {/* Before hydration: scope the CSS and hold the page sealed on the hero,
          so the first paint is already the design and nothing can scroll early. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.classList.add("d3p","d3p-sealed",${fontClasses
            .split(/\s+/)
            .filter(Boolean)
            .map((c) => JSON.stringify(c))
            .join(",")});`,
        }}
      />
      <div ref={ref} className="d3-root" dangerouslySetInnerHTML={{ __html: LANDING_V3_MARKUP }} />
    </>
  );
}
