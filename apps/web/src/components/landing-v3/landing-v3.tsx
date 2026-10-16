"use client";

import { useEffect, useRef } from "react";
import { LANDING_V3_MARKUP } from "./landing-v3-markup";
import { mountLandingV3 } from "./landing-v3-runtime";
import "./landing-v3.css";

/*
 * Drive247 Landing v3 — Claude Design's `ui_kits/landing/Drive247 Landing v3.html`,
 * served as the v2 landing page (`/?landing=v2`).
 *
 * The design is one hand-written document: its markup, CSS and scripts are
 * ported as they are rather than re-authored as JSX, so the page stays
 * identical to the design and can be re-synced from it. The markup is
 * server-rendered (SEO, no flash), the behaviour mounts once on the client.
 *
 *   landing-v3-markup.ts   generated — the design's <body>, icons inlined
 *   landing-v3.css         generated — the design's CSS, scoped to html.d3p
 *   landing-v3-icons.ts    generated — icons for markup inserted at runtime
 *   landing-v3-runtime.ts  the design's four scripts, with teardown
 *   public/landing-v3/     images, and the embedded How-it-works page
 */

export function LandingV3({ fontClasses }: { fontClasses: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = document.documentElement;
    const fonts = fontClasses.split(/\s+/).filter(Boolean);
    html.classList.add(...fonts);
    const unmount = mountLandingV3(el);
    // the pre-hydration seal (see the inline script below) hands over to body.sealed
    html.classList.remove("d3p-sealed");
    return () => {
      unmount();
      html.classList.remove(...fonts, "d3p-sealed");
    };
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
