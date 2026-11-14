"use client";

import { useEffect, useRef, useState } from "react";
import { TIP_AT } from "./tour-layout";
import "@/components/sections/portal-glass.css";
import "./page-line.css";
import "./phone-line.css";

/*
 * The page line on phones (boss, 2026-11-14): the line appears at the start of the page and
 * follows the content all the way down, as it does on desktop (page-line.tsx and the sections'
 * own parts, which only draw from 1200px up). It looks the same: the dotted path ahead, the solid
 * path behind the tip, and the tip at 70% of the screen.
 *
 *   - It starts under the hero and swings into the "Your own" rows, then takes the same curves
 *     as desktop: down beside each row, crossing to the other side between rows, as desktop's
 *     thread crosses between the words and the screens. Curves happen in the open space at the
 *     end of a row or section, never along the side of one.
 *   - In "Everything around each rental" it drops onto each feature's number 1 and runs down
 *     through every number, catching each one the same way; a number turns purple as the line
 *     reaches it. No arrows between the numbers: the line is the link.
 *   - It turns into an arrow only where desktop has one: going into the product screens
 *     (calendar, messages, insights) and into the demo ("Now try it yourself").
 *   - It comes out again at the end of the product screens, at the end of Trax and under the
 *     demo, and at the end drops into the footer.
 *
 * Everything is measured from the page, in document px, and re-measured whenever the page's
 * size changes. The layer sits under every section (page-line.css), so screens and cards hide it.
 */

const PHONE = "(max-width: 767.98px)";
/** The lanes: the middle of the page's 20px side margins. */
const GUTTER = 10;

type Seg = { x: number; y0: number; y1: number };
type Run = { d: string; y0: number; y1: number; ys: number[]; xs: number[] };
type Catch = { el: HTMLElement; y: number };
type Layout = { width: number; height: number; runs: Run[]; catches: Catch[]; end: { x: number; y: number } | null; panels: HTMLElement[] };

/** A run through straight segments joined by S-curves in the space between them, as desktop's thread is drawn. */
function run(segs: Seg[], arrow: boolean): Run | null {
  const ok = segs.filter((s) => s.y1 >= s.y0);
  if (!ok.length) return null;
  let d = `M${ok[0].x} ${ok[0].y0}L${ok[0].x} ${ok[0].y1}`;
  const ys: number[] = [ok[0].y0, ok[0].y1];
  const xs: number[] = [ok[0].x, ok[0].x];
  for (let i = 1; i < ok.length; i++) {
    const a = ok[i - 1];
    const b = ok[i];
    const mid = (a.y1 + b.y0) / 2;
    d += `C${a.x} ${mid} ${b.x} ${mid} ${b.x} ${b.y0}L${b.x} ${b.y1}`;
    // Points along the curve, so the tip follows it.
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const u = 1 - t;
      ys.push(u * u * u * a.y1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * b.y0);
      xs.push(u * u * u * a.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * b.x);
    }
    ys.push(b.y1);
    xs.push(b.x);
  }
  const last = ok[ok.length - 1];
  if (arrow) d += `M${last.x - 6} ${last.y1 - 7}L${last.x} ${last.y1}L${last.x + 6} ${last.y1 - 7}`;
  return { d, y0: ok[0].y0, y1: last.y1, ys, xs };
}

function xAt(r: Run, y: number) {
  for (let i = 1; i < r.ys.length; i++) {
    if (y <= r.ys[i]) {
      const span = r.ys[i] - r.ys[i - 1];
      const t = span > 0 ? (y - r.ys[i - 1]) / span : 1;
      return r.xs[i - 1] + (r.xs[i] - r.xs[i - 1]) * t;
    }
  }
  return r.xs[r.xs.length - 1];
}

const shown = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

function measure(layer: HTMLElement): Layout | null {
  const origin = layer.getBoundingClientRect();
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - origin.top, bottom: r.bottom - origin.top, left: r.left - origin.left, right: r.right - origin.left, cx: (r.left + r.right) / 2 - origin.left, cy: (r.top + r.bottom) / 2 - origin.top };
  };
  const width = document.documentElement.clientWidth;
  const L = GUTTER - origin.left;
  const R = width - GUTTER - origin.left;
  const runs: Run[] = [];
  const catches: Catch[] = [];

  // 1. From the hero, through the "Your own" rows and the rental features, into the product screens.
  const area = document.querySelector("#features");
  const rows = Array.from(document.querySelectorAll<HTMLElement>("#features .pg-row")).filter(shown);
  const features = Array.from(document.querySelectorAll<HTMLElement>(".rc-list > li")).filter(shown);
  const firstStage = document.querySelector<HTMLElement>(".tps");
  if (area && rows.length) {
    const segs: Seg[] = [];
    const a = box(area);
    // It appears under the hero, in the middle, and swings over to the first row's side.
    segs.push({ x: width / 2 - origin.left, y0: a.top + 8, y1: a.top + 24 });
    rows.forEach((row, i) => {
      const b = box(row);
      segs.push({ x: i % 2 === 0 ? L : R, y0: b.top, y1: b.bottom });
    });
    // Back to the left between the rows and the features (desktop's rail is on the left).
    features.forEach((li) => {
      const b = box(li);
      const nums = Array.from(li.querySelectorAll<HTMLElement>(".rc-step-n")).filter(shown);
      if (!nums.length) {
        segs.push({ x: L, y0: b.top, y1: b.bottom });
        return;
      }
      const first = box(nums[0]);
      const last = box(nums[nums.length - 1]);
      // Down beside the feature's words and picture, then onto its number 1 and down through the rest.
      segs.push({ x: L, y0: b.top, y1: first.top - 26 });
      segs.push({ x: first.cx, y0: first.top - 2, y1: last.bottom });
      nums.forEach((n) => catches.push({ el: n.closest<HTMLElement>(".rc-step") ?? n, y: box(n).cy }));
    });
    if (firstStage) {
      // Into the product screens: an arrow down onto the calendar's heading.
      const s = box(firstStage.querySelector(".tps-title") ?? firstStage);
      const lastEnd = segs[segs.length - 1].y1;
      segs.push({ x: L, y0: Math.min(lastEnd + 40, s.top - 30), y1: s.top - 6 });
      const r = run(segs, true);
      if (r) runs.push(r);
    } else {
      const r = run(segs, false);
      if (r) runs.push(r);
    }
  }

  // 2. Out of the end of the product screens, down into Trax.
  const stages = Array.from(document.querySelectorAll<HTMLElement>(".tps")).filter(shown);
  const trax = document.querySelector("#trax");
  if (stages.length && trax) {
    // It comes out of the bottom of the last screen's last number, swings over to the left and
    // goes down into Trax as an arrow.
    const lastStage = stages[stages.length - 1];
    const lastNum = Array.from(lastStage.querySelectorAll(".tps-steps .tps-n")).filter(shown).pop();
    const t = box(trax).top;
    if (lastNum) {
      const n = box(lastNum);
      const r = run([{ x: n.cx, y0: n.bottom, y1: n.bottom + 4 }, { x: L, y0: Math.min(n.bottom + 40, t - 30), y1: t - 6 }], true);
      if (r) runs.push(r);
    } else {
      const from = box(lastStage).bottom;
      const r = t - from > 24 ? run([{ x: L, y0: from, y1: t - 6 }], true) : null;
      if (r) runs.push(r);
    }
  }

  // 3. Out of the end of Trax, an arrow down into the demo.
  const intro = document.querySelector("#demo-intro");
  const demo = document.querySelector("#your-site");
  if (trax && intro) {
    const t = box(trax).bottom;
    const i = box(intro);
    const stop = demo ? Math.min(i.bottom, box(demo).top) : i.bottom;
    const r = run([{ x: L, y0: t + 6, y1: stop - 10 }], true);
    if (r) runs.push(r);
  }

  /*
   * 4. Out from under the demo, down the rest of the page into the footer. As on desktop, it
   * doesn't keep to one margin: each section has it on the other side from the last, and it
   * sweeps across in the open space where one section ends and the next begins. It becomes an
   * arrow onto the number dials (desktop's arrow there, on the right), comes out under them,
   * runs through the launch steps' numbers, and drops into the footer.
   */
  // The site's footer (the demo draws footers of its own inside its screens).
  const footer = document.querySelector("footer.ft") ?? Array.from(document.querySelectorAll("footer")).pop() ?? null;
  const main = document.getElementById("main");
  let end: Layout["end"] = null;
  if (demo && footer && main) {
    const kids = Array.from(main.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains("ln-layer") && shown(el));
    const after = kids.slice(kids.indexOf(demo as HTMLElement) + 1);
    const dials = document.querySelector<HTMLElement>("#numbers-intro + .nm");
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".ls-step-no")).filter(shown);
    const stepXs = steps.map((s) => box(s).cx);
    const stacked = steps.length > 1 && Math.max(...stepXs) - Math.min(...stepXs) < 4;
    /*
     * Where a section's own content starts and ends (its words, pictures and cards, not its
     * padding), so the line only crosses the page in space that is really empty, and keeps to
     * its side where two sections' content nearly meet (Ghulam, 2026-11-14: the sweep into
     * pricing cut the plan card's corner).
     */
    const content = (sec: HTMLElement) => {
      let top = Infinity;
      let bottom = -Infinity;
      for (const el of Array.from(sec.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.opacity === "0") continue;
        const media = /^(IMG|SVG|VIDEO|CANVAS|IFRAME|PICTURE|BUTTON|INPUT)$/i.test(el.tagName);
        const text = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
        const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none";
        if (!media && !text && !painted) continue;
        top = Math.min(top, r.top - origin.top);
        bottom = Math.max(bottom, r.bottom - origin.top);
      }
      const b = box(sec);
      return top < bottom ? { top: Math.max(b.top, top), bottom: Math.min(b.bottom, bottom) } : { top: b.top, bottom: b.bottom };
    };
    /** The empty room a sweep across the page needs between two sections' content. */
    const ROOM = 90;
    const AIR = 12;
    let segs: Seg[] = [{ x: L, y0: box(demo).bottom + 6, y1: box(demo).bottom + 6 }];
    let lane = L;
    let floor = box(demo).bottom;
    for (const sec of after) {
      const b = box(sec);
      if (sec === dials) {
        // The arrow onto the dials, then on again from under them.
        const prev = segs[segs.length - 1];
        segs.push({ x: R, y0: Math.max(prev.y1 + 40, b.top - 90), y1: b.top - 8 });
        const r = run(segs, true);
        if (r) runs.push(r);
        segs = [{ x: R, y0: b.bottom + 8, y1: b.bottom + 8 }];
        lane = R;
        floor = b.bottom;
        continue;
      }
      if (sec.id === "turo") {
        // Into the middle of the Turo story's top as an arrow, as desktop's line goes into it (Ghulam, 2026-11-14).
        const mid = width / 2 - origin.left;
        const prev = segs[segs.length - 1];
        segs.push({ x: mid, y0: Math.max(prev.y1 + 24, b.top - 40), y1: b.top - 4 });
        const r = run(segs, true);
        if (r) runs.push(r);
        // Out again on the right, clear of the next heading: the dials' arrow is on that side.
        segs = [{ x: R, y0: b.bottom + 4, y1: b.bottom + 4 }];
        lane = R;
        floor = b.bottom;
        continue;
      }
      if (sec.id === "operators") {
        // The operators' logo wall fills the page edge to edge in see-through tiles, so there is no
        // side to run down: the line stops above it and picks up again under it (Ghulam, 2026-11-14).
        const r = run(segs, false);
        if (r) runs.push(r);
        segs = [{ x: lane, y0: b.bottom, y1: b.bottom }];
        floor = b.bottom;
        continue;
      }
      const c = content(sec);
      const room = c.top - floor >= ROOM;
      if (stacked && sec.contains(steps[0])) {
        // Down the left beside the heading, then onto number 1 and through the rest.
        const first = box(steps[0]);
        const last = box(steps[steps.length - 1]);
        segs.push({ x: L, y0: c.top - AIR, y1: first.top - 30 });
        segs.push({ x: first.cx, y0: first.top - 2, y1: last.bottom });
        steps.forEach((s) => catches.push({ el: s, y: box(s).cy }));
        segs.push({ x: L, y0: last.bottom + 40, y1: c.bottom + AIR });
        lane = L;
        floor = c.bottom;
        continue;
      }
      // The dials' heading has the line on the right, where desktop's arrow is; the launch steps'
      // heading has it on the left, where their numbers are. Elsewhere it changes side when there's room.
      const next = sec.nextElementSibling;
      const want = next === dials ? R : stacked && next?.contains(steps[0]) ? L : lane === L ? R : L;
      if (room) lane = want;
      segs.push({ x: lane, y0: room ? c.top - AIR : segs[segs.length - 1].y1 + 1, y1: c.bottom + AIR });
      floor = c.bottom;
    }
    const f = box(footer).top;
    segs.push({ x: lane, y0: segs[segs.length - 1].y1 + 1, y1: f });
    const r = run(segs, false);
    if (r) {
      runs.push(r);
      end = { x: lane, y: f };
    }
  }

  if (!runs.length) return null;
  const height = Math.max(...runs.map((r) => r.y1)) + 20;
  // The rental features' heading-and-picture blocks stick, on a copy of the page's ground that
  // hides what is behind them, this line included; they show the line through (see PhoneLine).
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".rc-panel.rc-inline")).filter(shown);
  return { width, height, runs, catches, end, panels };
}

export function PhoneLine() {
  const layerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<SVGRectElement>(null);
  const tipRef = useRef<SVGCircleElement>(null);
  const endRef = useRef<SVGCircleElement>(null);
  const [phone, setPhone] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    const media = matchMedia(PHONE);
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // Measure, and again whenever the page's height changes (pictures, fonts, opened details).
  useEffect(() => {
    const layer = layerRef.current;
    if (!phone || !layer) return;
    let frame = 0;
    let last = "";
    const redo = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure(layer);
        const key = JSON.stringify(next && [next.width, next.height, next.runs.map((r) => r.d)]);
        if (key !== last) {
          last = key;
          setLayout(next);
        }
      });
    };
    redo();
    const ro = new ResizeObserver(redo);
    ro.observe(document.body);
    addEventListener("load", redo);
    const late = setTimeout(redo, 2500);
    return () => {
      ro.disconnect();
      removeEventListener("load", redo);
      clearTimeout(late);
      cancelAnimationFrame(frame);
    };
  }, [phone]);

  // Draw down to the tip as the page scrolls; light each number as the tip reaches it.
  useEffect(() => {
    const layer = layerRef.current;
    const clip = clipRef.current;
    const tip = tipRef.current;
    if (!phone || !layout || !layer || !clip || !tip) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const NS = "http://www.w3.org/2000/svg";
    const throughs = layout.panels.map((panel, i) => {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "pl-through");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("fill", "none");
      const rest = layout.runs.map((r) => `<path class="pg-thread-rest" d="${r.d}"/>`).join("");
      const live = layout.runs.map((r) => `<path class="ln-live pl-live" d="${r.d}"/>`).join("");
      svg.innerHTML = `<g><clipPath id="pl-reveal-${i}" clipPathUnits="userSpaceOnUse"><rect x="-50" y="0" width="${layout.width + 100}" height="0"/></clipPath>${rest}<g clip-path="url(#pl-reveal-${i})">${live}</g><circle class="pg-thread-tip" r="5" style="visibility:hidden"/></g>`;
      panel.appendChild(svg);
      const shift = svg.firstElementChild as SVGGElement;
      return { panel, svg, shift, clip: shift.querySelector("rect")!, tip: shift.querySelector("circle")! };
    });
    let frame = 0;
    const paint = () => {
      frame = 0;
      const top = layer.getBoundingClientRect().top;
      const at = innerHeight * TIP_AT - top;
      clip.setAttribute("height", String(still ? layout.height : Math.max(0, at)));
      const r = layout.runs.find((run) => at >= run.y0 && at <= run.y1);
      if (still || !r) tip.style.visibility = "hidden";
      else {
        tip.setAttribute("cx", String(xAt(r, at)));
        tip.setAttribute("cy", String(at));
        tip.style.visibility = "visible";
      }
      layout.catches.forEach((c) => c.el.toggleAttribute("data-lined", still || at >= c.y));
      endRef.current?.classList.toggle("is-on", still || (!!layout.end && at >= layout.end.y));
      // The stuck blocks show the line exactly where it runs behind them, as if see-through.
      const origin = layer.getBoundingClientRect();
      throughs.forEach(({ panel, shift, clip: c, tip: t }) => {
        const r = panel.getBoundingClientRect();
        shift.setAttribute("transform", `translate(${origin.left - r.left} ${origin.top - r.top})`);
        c.setAttribute("height", clip.getAttribute("height") ?? "0");
        t.style.visibility = tip.style.visibility;
        t.setAttribute("cx", tip.getAttribute("cx") ?? "0");
        t.setAttribute("cy", tip.getAttribute("cy") ?? "0");
      });
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
      layout.catches.forEach((c) => c.el.removeAttribute("data-lined"));
      throughs.forEach(({ svg }) => svg.remove());
    };
  }, [phone, layout]);

  return (
    <div ref={layerRef} className="ln-layer pl-layer" aria-hidden>
      {phone && layout && (
        <svg className="ln-svg" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} fill="none">
          <defs>
            <clipPath id="pl-reveal" clipPathUnits="userSpaceOnUse">
              <rect ref={clipRef} x={-50} y={0} width={layout.width + 100} height={0} />
            </clipPath>
          </defs>
          {layout.runs.map((r, i) => (
            <path key={`rest-${i}`} className="pg-thread-rest" d={r.d} />
          ))}
          <g clipPath="url(#pl-reveal)">
            {layout.runs.map((r, i) => (
              <path key={`live-${i}`} className="ln-live pl-live" d={r.d} />
            ))}
          </g>
          {layout.end && <circle ref={endRef} className="pg-thread-stop ln-node ln-end" cx={layout.end.x} cy={layout.end.y} r="5" />}
          <circle ref={tipRef} className="pg-thread-tip" r="5" style={{ visibility: "hidden" }} />
        </svg>
      )}
    </div>
  );
}
