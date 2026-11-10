"use client";

import { useRef } from "react";
import { PageLine } from "./page-line";
import { useTourLayout } from "./use-tour-layout";

/*
 * The landing page's line: one line from the top of the page to the end. Mounted once,
 * last inside <main>, so the sections that draw their own part of the line have measured
 * themselves first. It shows where the other thread parts do (1200px wide, 640px tall and up).
 *
 * Trax walking the visitor through the page (the hello in the corner, trax-guide.tsx, and
 * the pointer inside the sections, trax-pointer.tsx) is OFF (Ghulam, 2026-11-10: "remove
 * this Trax thing altogether"). Both files are kept; mounting <TraxPointer> and <TraxGuide>
 * here again brings the tour back.
 */

export function LandingTour() {
  const layer = useRef<HTMLDivElement>(null);
  const layout = useTourLayout(layer);

  return (
    <div ref={layer} className="ln-layer" data-tour-layer aria-hidden>
      {layout?.line && <PageLine line={layout.line} stops={layout.stops} />}
    </div>
  );
}
