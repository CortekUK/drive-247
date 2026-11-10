"use client";

import { useEffect, useState, type RefObject } from "react";
import { LINE_MEDIA } from "@/components/sections/launch-section";
import { measureTour, type TourLayout } from "./tour-layout";

/*
 * Measures the tour (tour-layout.ts) once the page has settled, and again whenever it could
 * have moved: a resize, a font or image arriving, any section changing size (an FAQ opening,
 * say), or a section that draws its own part of the line saying where it now starts and ends.
 * Measuring reads the whole page, so it waits for the changes to stop first.
 */
export function useTourLayout(layer: RefObject<HTMLElement | null>): TourLayout | null {
  const [layout, setLayout] = useState<TourLayout | null>(null);

  useEffect(() => {
    let timer = 0;
    let frame = 0;
    const measure = () => {
      timer = 0;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLayout(measureTour(layer.current)));
    };
    const soon = (wait = 180) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, wait);
    };
    const onChange = () => soon();
    const onLoad = () => soon(60);

    soon(80);
    document.fonts?.ready.then(onLoad);
    addEventListener("load", onLoad);
    addEventListener("resize", onChange);

    const main = document.getElementById("main");
    const sizes = new ResizeObserver(onChange);
    const marks = new MutationObserver(onChange);
    if (main) {
      sizes.observe(main);
      for (const child of main.children) sizes.observe(child);
      marks.observe(main, { subtree: true, attributes: true, attributeFilter: ["data-line-in", "data-line-out", "data-line-steps", "data-line-out-y"] });
    }
    const media = matchMedia(LINE_MEDIA);
    media.addEventListener("change", onChange);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      removeEventListener("load", onLoad);
      removeEventListener("resize", onChange);
      sizes.disconnect();
      marks.disconnect();
      media.removeEventListener("change", onChange);
    };
  }, [layer]);

  return layout;
}
