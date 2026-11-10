"use client";

import { useEffect, useMemo, useRef } from "react";
import { runX, TIP_AT, type LineLayout, type MeasuredStop } from "./tour-layout";
import "@/components/sections/portal-glass.css";
import { LINE_SPLASH_EVENT } from "@/components/layout/footer-water";
import "./page-line.css";

/*
 * The routed parts of the page line (see tour-layout.ts). It looks exactly like the parts the
 * sections draw themselves: the dotted path ahead, the solid path behind the tip, and the tip
 * at 70% of the screen. Everything above the tip is drawn, so a clip that grows with the
 * scroll is all the drawing needs. A stop's dot fills as the tip reaches it, which is when
 * Trax speaks.
 */
export function PageLine({ line, stops }: { line: LineLayout; stops: MeasuredStop[] }) {
  const clipRef = useRef<SVGRectElement>(null);
  const tipRef = useRef<SVGCircleElement>(null);
  const nodeRefs = useRef<(SVGCircleElement | null)[]>([]);
  const nodes = useMemo(() => stops.filter((stop) => stop.node), [stops]);

  useEffect(() => {
    const clip = clipRef.current;
    const tip = tipRef.current;
    if (!clip || !tip) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frame = 0;
    /** Whether the tip was already in the footer at the last paint: the splash is for the moment it goes in. */
    let sunk: boolean | null = null;
    const paint = () => {
      frame = 0;
      const at = scrollY + innerHeight * TIP_AT;
      clip.setAttribute("height", String(still ? line.originY + line.height : Math.max(0, at)));

      const run = line.runs.find((r) => at >= r.y0 && at <= r.y1);
      const hidden = still || !run || run.gaps.some(([a, b]) => at > a && at < b);
      if (hidden || !run) {
        tip.style.visibility = "hidden";
      } else {
        tip.setAttribute("cx", String(runX(run, at)));
        tip.setAttribute("cy", String(at));
        tip.style.visibility = "visible";
      }

      nodes.forEach((stop, i) => nodeRefs.current[i]?.classList.toggle("is-on", still || at >= stop.node!.y));
      if (line.end) {
        // The end of the line drops into the footer: tell the water where, once per arrival.
        const down = at >= line.end.y;
        if (down && sunk === false && !still) {
          dispatchEvent(new CustomEvent(LINE_SPLASH_EVENT, { detail: { clientX: line.end.x - scrollX } }));
        }
        sunk = down;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [line, nodes]);

  return (
    <svg className="ln-svg" width={line.width} height={line.height} viewBox={`0 0 ${line.width} ${line.height}`} fill="none" aria-hidden>
      <defs>
        <clipPath id="ln-reveal" clipPathUnits="userSpaceOnUse">
          <rect ref={clipRef} x={0} y={0} width={line.originX + line.width} height={0} />
        </clipPath>
      </defs>
      {/* Paths are in page pixels; this moves them onto the layer. */}
      <g transform={`translate(${-line.originX} ${-line.originY})`}>
        {line.runs.map((run, i) => (
          <path key={`rest-${i}`} className="pg-thread-rest" d={run.d} />
        ))}
        <g clipPath="url(#ln-reveal)">
          {line.runs.map((run, i) => (
            <path key={`live-${i}`} className="ln-live" d={run.d} />
          ))}
        </g>
        {nodes.map((stop, i) => (
          <circle
            key={stop.id}
            ref={(el) => {
              nodeRefs.current[i] = el;
            }}
            className="pg-thread-stop ln-node"
            cx={stop.node!.x}
            cy={stop.node!.y}
            r="5"
          />
        ))}
        <circle ref={tipRef} className="pg-thread-tip" r="5" style={{ visibility: "hidden" }} />
      </g>
    </svg>
  );
}
