"use client";

import { useCallback, useRef, useState } from "react";
import { PageLine } from "./page-line";
import { TraxGuide } from "./trax-guide";
import { TraxPointer } from "./trax-pointer";
import { useTourLayout } from "./use-tour-layout";

/*
 * The landing page's tour: one line from the top of the page to the end, and Trax walking
 * the visitor through it. On the hero Trax waits in the corner and says hello (trax-guide);
 * below the hero it comes up inside the sections and points at what it's talking about
 * (trax-pointer), for now in the "Your own" rows only. Mounted once, last inside <main>, so
 * the sections that draw their own part of the line have measured themselves first.
 *
 * The line shows where the other thread parts do (1200px wide, 640px tall and up).
 * Stopping the tour (Trax's close button, or "Not now") lasts until the page reloads.
 */

export function LandingTour() {
  const layer = useRef<HTMLDivElement>(null);
  const layout = useTourLayout(layer);
  // Stopping the tour lasts until the page is loaded again, so a reload always brings Trax back.
  const [muted, setMutedState] = useState(false);
  const setMuted = useCallback((on: boolean) => setMutedState(on), []);

  return (
    <>
      <div ref={layer} className="ln-layer" data-tour-layer aria-hidden>
        {layout?.line && <PageLine line={layout.line} stops={layout.stops} />}
      </div>
      <TraxPointer muted={muted} onStop={() => setMuted(true)} />
      <TraxGuide muted={muted} setMuted={setMuted} />
    </>
  );
}
