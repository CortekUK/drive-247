"use client";

import { useEffect, useRef, type RefObject } from "react";

/*
 * Phones only (the calendar inside the product track, under 768px): the screen's labels
 * leave the calendar and sit in the margin above and below it, each tied to its booking
 * by a thin curved line (boss, 2026-11-12: "labels can come outside the view, with better
 * UI"). Inside the calendar they were cut off by the pinned car column and the screen edge
 * as it panned; out here they are always whole, and the lines follow the bookings as the
 * calendar slides.
 *
 * The labels themselves are plain markup (CalloutBand). This draws the lines: an SVG over
 * the calendar's inner box, recomputed whenever anything it depends on moves.
 */

const PHONE = "(max-width: 767.98px)";

export type Callout = { note: string; n: number };

/** One band of labels, above (`top`) or below the calendar. Hidden unless on a phone. */
export function CalloutBand({ items, side }: { items: Callout[]; side: "top" | "bottom" }) {
  return (
    <div className={`cs-callouts is-${side}`} aria-hidden>
      {items.map((c) => (
        <span key={c.n} className="cs-callout" data-callout={c.n}>
          <i>{c.n}</i>
          <b>{c.note}</b>
        </span>
      ))}
    </div>
  );
}

/** The lines. `count` labels, numbered 1..count, each matched to a `.cs-bar[data-callout]`. */
export function CalloutLeaders({ rootRef, count, bottomFrom }: { rootRef: RefObject<HTMLElement | null>; count: number; bottomFrom: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    if (!root || !svg) return;
    const media = matchMedia(PHONE);
    let frame = 0;
    let settle = 0;

    const draw = () => {
      frame = 0;
      if (!media.matches || !root.closest(".pt-panel")) return;
      const box = root.getBoundingClientRect();
      const board = root.querySelector<HTMLElement>(".cs-board");
      const car = root.querySelector<HTMLElement>(".cs-car");
      if (!board || !car || box.width === 0) return;
      const b = board.getBoundingClientRect();
      // The part of the lanes you can actually see: right of the pinned cars, inside the screen.
      const visL = car.getBoundingClientRect().right + 6;
      const visR = b.right - 6;
      svg.setAttribute("viewBox", `0 0 ${box.width.toFixed(1)} ${box.height.toFixed(1)}`);

      for (let n = 1; n <= count; n += 1) {
        const chip = root.querySelector<HTMLElement>(`.cs-callout[data-callout="${n}"]`);
        const bar = root.querySelector<HTMLElement>(`.cs-bar[data-callout="${n}"]`);
        const group = svg.querySelector<SVGGElement>(`g[data-callout="${n}"]`);
        if (!chip || !bar || !group) continue;
        const top = n < bottomFrom;
        const c = chip.getBoundingClientRect();
        const r = bar.getBoundingClientRect();
        const segL = Math.max(r.left, visL);
        const segR = Math.min(r.right, visR);
        const seen = segR - segL > 10;
        // Into the middle of what shows of the booking; when it has slid out of sight, to the
        // edge it went past, quieter.
        const x2 = (seen ? (segL + segR) / 2 : r.left + r.width / 2 < (visL + visR) / 2 ? visL : visR) - box.left;
        const y2 = (top ? r.top : r.bottom) - box.top;
        const x1 = c.left + c.width / 2 - box.left;
        const y1 = (top ? c.bottom : c.top) - box.top;
        const dy = y2 - y1;
        const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${x1.toFixed(1)} ${(y1 + dy * 0.55).toFixed(1)} ${x2.toFixed(1)} ${(y2 - dy * 0.45).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        for (const path of group.querySelectorAll("path")) path.setAttribute("d", d);
        const dot = group.querySelector("circle");
        dot?.setAttribute("cx", x2.toFixed(1));
        dot?.setAttribute("cy", y2.toFixed(1));
        group.toggleAttribute("data-off", !seen);
      }
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    // While the bookings rise into place (calendar-section.css), keep drawing for a moment.
    const follow = (ms: number) => {
      const until = performance.now() + ms;
      cancelAnimationFrame(settle);
      const tick = () => {
        draw();
        if (performance.now() < until) settle = requestAnimationFrame(tick);
      };
      settle = requestAnimationFrame(tick);
    };

    const board = root.querySelector<HTMLElement>(".cs-board");
    board?.addEventListener("scroll", queue, { passive: true });
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    media.addEventListener("change", queue);
    const ro = new ResizeObserver(queue);
    ro.observe(root);
    // The bars animate in when the section is revealed; follow them.
    const mo = new MutationObserver(() => follow(1800));
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    follow(1800);

    return () => {
      board?.removeEventListener("scroll", queue);
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
      media.removeEventListener("change", queue);
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settle);
    };
  }, [rootRef, count, bottomFrom]);

  return (
    <svg ref={svgRef} className="cs-leaders" aria-hidden preserveAspectRatio="none">
      {Array.from({ length: count }, (_, i) => (
        <g key={i} data-callout={i + 1}>
          {/* A soft halo under the line keeps it readable where it crosses the grid. */}
          <path className="cs-leader-halo" pathLength={1} />
          <path className="cs-leader" pathLength={1} />
          <circle className="cs-leader-dot" r={3.5} />
        </g>
      ))}
    </svg>
  );
}
