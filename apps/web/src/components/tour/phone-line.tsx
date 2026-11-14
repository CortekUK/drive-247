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
 *   - Out of the last rental feature, and from there on into every section, it is drawn as one
 *     kind of arrow: from the end of the block above, one curve across, and down beside the
 *     next heading (see measure). Each section's top margin is set on phones to give it room.
 *
 * Everything is measured from the page, in document px, and re-measured whenever the page's
 * size changes. The layer sits under every section (page-line.css), so screens and cards hide it.
 */

const PHONE = "(max-width: 767.98px)";
/** The lanes: the middle of the page's 20px side margins. */
const GUTTER = 10;

type Seg = { x: number; y0: number; y1: number };

/** Blocks whose margins the line set on phones (see measure), so they can be put back. */
const roomed = new Set<HTMLElement>();
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

/** An element's text, line by line: each line's top, bottom and right edge, in viewport px. */
function textLines(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const lines: { top: number; bottom: number; right: number }[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1) continue;
    const line = lines.find((l) => Math.abs(l.top - r.top) < 4);
    if (line) {
      line.right = Math.max(line.right, r.right);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ top: r.top, bottom: r.bottom, right: r.right });
  }
  return lines.sort((a, b) => a.top - b.top);
}

/** Does this element paint a solid ground of its own (a card, a phone, a coloured band)? */
function solid(e: Element) {
  const cs = getComputedStyle(e);
  const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
  const alpha = m ? Number(m[1].split(",")[3] ?? 1) : 0;
  return alpha >= 0.9 || (cs.backgroundImage !== "none" && !cs.backgroundImage.startsWith("radial"));
}

/** The outermost solid ground between `el` and `stop`, if any: the line passes behind it. */
function solidAround(el: Element, stop: Element) {
  let found: HTMLElement | null = null;
  for (let e = el.parentElement; e && e !== stop; e = e.parentElement) if (solid(e)) found = e;
  return found;
}

function measure(layer: HTMLElement): Layout | null {
  const origin = layer.getBoundingClientRect();
  /*
   * Where things sit in the page's layout, leaving out what transforms add: sections slide and
   * fade in as they come into view (translate, transform), and are measured before that has
   * finished, often before it has started. Measured with their slide-in offsets, the arrows and
   * the room above each section came out 40px wrong once they had arrived (Ghulam, 2026-11-14).
   */
  const shifts = new Map<Element, { x: number; y: number }>();
  const shiftOf = (el: Element | null): { x: number; y: number } => {
    if (!el || el === document.body || el === document.documentElement) return { x: 0, y: 0 };
    const known = shifts.get(el);
    if (known) return known;
    const up = shiftOf(el.parentElement);
    const cs = getComputedStyle(el);
    let x = up.x;
    let y = up.y;
    if (cs.translate && cs.translate !== "none") {
      const [tx, ty = "0px"] = cs.translate.split(" ");
      const size = el instanceof HTMLElement ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
      const len = (v: string, of: number) => (v.endsWith("%") ? (parseFloat(v) / 100) * of : parseFloat(v) || 0);
      x += len(tx, size.w);
      y += len(ty, size.h);
    }
    if (cs.transform && cs.transform !== "none") {
      const m = new DOMMatrixReadOnly(cs.transform);
      x += m.e;
      y += m.f;
    }
    const at = { x, y };
    shifts.set(el, at);
    return at;
  };
  /** An element's rectangle in the viewport, as laid out (without transforms). */
  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    const sh = shiftOf(el);
    return { top: r.top - sh.y, bottom: r.bottom - sh.y, left: r.left - sh.x, right: r.right - sh.x, width: r.width, height: r.height };
  };
  const box = (el: Element) => {
    const r = rectOf(el);
    return { top: r.top - origin.top, bottom: r.bottom - origin.top, left: r.left - origin.left, right: r.right - origin.left, cx: (r.left + r.right) / 2 - origin.left, cy: (r.top + r.bottom) / 2 - origin.top };
  };
  const width = document.documentElement.clientWidth;
  const L = GUTTER - origin.left;
  const R = width - GUTTER - origin.left;
  const runs: Run[] = [];
  const catches: Catch[] = [];
  const MID = width / 2 - origin.left;

  /*
   * Every arrow is drawn the same way (Ghulam, 2026-11-14: "all arrows must have equal space to
   * left and right, and an equal curve"). It starts where the block above it ends, at the left
   * lane (or at the number it comes out of), makes one curve of the same height across to the
   * right lane, and comes straight down that lane beside the next heading to its last line, so
   * it points at the whole heading. Onto something with no heading beside it (a coloured band, a
   * card, the footer) it lands just above it, after a short straight drop.
   *
   * So every arrow has the same room, each section's top margin is set on phones to leave exactly
   * that room above it: more where it was tight (the arrow cut a card or the words), less where
   * there was a gap (the blog). The margins are measured from the page, so they are right for any
   * phone and any font, and they are taken off again wider than a phone (see PhoneLine).
   */
  // The two lanes, the same distance in from each edge.
  const LANE = width - 18 - origin.left;
  const START = 18 - origin.left;
  const CURVE = 56;
  const DOT = 6;
  const BESIDE = 10;
  const STUB = 20;
  const footer = document.querySelector<HTMLElement>("footer.ft") ?? Array.from(document.querySelectorAll<HTMLElement>("footer")).pop() ?? null;
  const main = document.getElementById("main");

  /**
   * Where a block's own words, pictures and cards start and end (not its padding). What a clipping
   * box hides (a demo's other screens, a scrolling logo strip) does not count. A block that pins
   * part of itself while you scroll (Trax, the Turo story, the pricing heads) ends where its box
   * ends: what it pins travels all the way down it.
   */
  const edges = (sec: HTMLElement) => {
    const b = box(sec);
    let top = Infinity;
    let bottom = -Infinity;
    let pinned = false;
    const walk = (el: Element, clipTop: number, clipBottom: number) => {
      for (const kid of Array.from(el.children)) {
        const cs = getComputedStyle(kid);
        if (cs.display === "none") continue;
        if (cs.position === "sticky") pinned = true;
        const r = rectOf(kid);
        const t = r.top - origin.top;
        const btm = r.bottom - origin.top;
        if (r.width >= 4 && r.height >= 4 && cs.visibility !== "hidden" && btm > clipTop && t < clipBottom) {
          const media = /^(IMG|SVG|VIDEO|CANVAS|IFRAME|PICTURE|BUTTON|INPUT)$/i.test(kid.tagName);
          const text = Array.from(kid.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
          const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none";
          if (media || text || painted) {
            top = Math.min(top, Math.max(t, clipTop));
            bottom = Math.max(bottom, Math.min(btm, clipBottom));
          }
        }
        if (kid instanceof SVGElement) continue;
        const clips = cs.overflowY !== "visible" || cs.overflowX !== "visible";
        walk(kid, clips ? Math.max(clipTop, t) : clipTop, clips ? Math.min(clipBottom, btm) : clipBottom);
      }
    };
    walk(sec, b.top, b.bottom);
    return { top: top < Infinity ? top : b.top, bottom: pinned || bottom === -Infinity ? b.bottom : bottom };
  };
  const visibleHeading = (sec: HTMLElement) =>
    Array.from(sec.querySelectorAll<HTMLElement>("h2, h1")).find((h) => {
      const r = h.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    });

  type Aim = {
    x: number;
    tip: number;
    /** The curve must end by here. */
    by: number;
    /** A path of its own after the start, in place of the curve across (and no room is set for it). */
    path?: Seg[];
  };
  /** The logo wall's top and foot, and the gap between columns nearest the middle (right of it on a tie). */
  const wallGap = (sec: HTMLElement) => {
    const wall = sec.querySelector(".om-wall");
    const cols = Array.from(sec.querySelectorAll(".om-col")).map(box).sort((x, y) => x.left - y.left);
    if (!wall || cols.length < 2) return null;
    const gaps = cols.slice(1).map((c, i) => (cols[i].right + c.left) / 2);
    const x = gaps.reduce((best, g) => (Math.abs(g - MID) < Math.abs(best - MID) - 1 || (Math.abs(Math.abs(g - MID) - Math.abs(best - MID)) <= 1 && g > best) ? g : best));
    const w = box(wall);
    return { x, top: w.top, bottom: w.bottom };
  };

  /** Where the arrow into a block lands. Null: the block gets no arrow (it belongs to the one above). */
  const aimAt = (sec: HTMLElement): Aim | null => {
    if (sec === footer) {
      // Into the footer as an arrow, as everywhere else (Ghulam, 2026-11-14).
      const t = box(sec).top;
      return { x: LANE, tip: t - 6, by: t - 6 - STUB };
    }
    // A section that draws its own part of the line (Bryan's quote) says where it comes in:
    // the line runs to its top there and the section carries it on (data-line-in, viewport px).
    const handIn = Number(sec.dataset.lineIn);
    if (Number.isFinite(handIn) && handIn > 0 && sec.dataset.lineOut) {
      const t = box(sec).top;
      return { x: handIn - origin.left, tip: t, by: t - STUB };
    }
    if (!sec.querySelector("h2, h1")) return null;
    // Numbered steps under the heading (the launch steps): straight down 8px in from the edge, clear
    // of the heading and its words (Ghulam, 2026-11-14: "give some space"), into number 1, so it runs on as the steps' own line (Ghulam, 2026-11-14).
    const steps = Array.from(sec.querySelectorAll<HTMLElement>(".ls-step-no")).filter(shown);
    if (steps.length > 1) {
      const n = box(steps[0]);
      return { x: n.cx, tip: n.top - 4, by: -Infinity, path: [{ x: 8 - origin.left, y0: 0, y1: n.top - 46 }, { x: n.cx, y0: n.top - 14, y1: n.top }] };
    }
    const heading = visibleHeading(sec);
    const e = edges(sec);
    // Trax's blue is painted by a layer beside its heading, not around it, so it is named here.
    const band = sec.id === "trax" || sec.id === "turo" || solid(sec) ? sec : heading && main ? solidAround(heading, main) : null;
    if (band) {
      // Onto a coloured band that fills the width (Trax, the Turo story, Bryan's): the arrow
      // comes down the middle onto it, after a longer straight drop so it is seen (Ghulam, 2026-11-14).
      const t = box(band).top;
      return { x: MID, tip: t - 8, by: t - 8 - STUB * 2 };
    }
    // The logo wall: as on desktop, the line comes across and goes straight down through it, in
    // the gap between two columns just right of the middle, and on out of its foot (Ghulam, 2026-11-14).
    if (sec.id === "operators") {
      const w = wallGap(sec);
      return w ? { x: w.x, tip: w.bottom - 10, by: w.top - STUB } : null;
    }
    // Nothing to point beside (the plan cards): onto the middle of what is there (Ghulam, 2026-11-14).
    if (!heading) return { x: MID, tip: e.top - 8, by: e.top - 8 - STUB };
    const sh = shiftOf(heading);
    const lines = textLines(heading).map((l) => ({ top: l.top - sh.y - origin.top, bottom: l.bottom - sh.y - origin.top, right: l.right - sh.x - origin.left }));
    const first = lines[0]?.top ?? box(heading).top;
    const fit: typeof lines = [];
    for (const l of lines) {
      if (l.right > LANE - 10) break;
      fit.push(l);
    }
    const clear = Math.min(first, e.top) - 6;
    if (!fit.length) return { x: LANE, tip: first - 6, by: Math.min(first - 6 - STUB, clear) };
    let tip = fit[fit.length - 1].bottom - 8;
    // The whole heading clears the lane: on down beside its sub-line too, while that clears it,
    // so the arrow fills the room down to what comes next (Ghulam, 2026-11-14, the blog).
    if (fit.length === lines.length) {
      const hb = box(heading).bottom;
      const sub = Array.from(sec.querySelectorAll<HTMLElement>("p")).find((el) => {
        const b = box(el);
        return b.top >= hb - 2 && b.top - hb < 60 && el.textContent!.trim();
      });
      if (sub) {
        const ss = shiftOf(sub);
        const sl = textLines(sub).map((l) => ({ bottom: l.bottom - ss.y - origin.top, right: l.right - ss.x - origin.left }));
        if (sl.length && sl.every((l) => l.right <= LANE - 10)) tip = sl[sl.length - 1].bottom + 12;
      }
    }
    return { x: LANE, tip, by: Math.min(first - BESIDE, clear) };
  };

  /** What the line does after reaching a block, where that is more than an arrow onto its heading. */
  const beyond = (sec: HTMLElement, aim: Aim): { segs: Seg[]; runs: Run[]; arrow: boolean; laneEnd?: number } => {
    if (sec.id === "operators" || sec.dataset.lineIn) return { segs: [], runs: [], arrow: false };
    // George's film: as on desktop, the line comes down past the heading and draws a frame round it.
    const film = sec.querySelector(".ts-frame");
    if (film && shown(film)) {
      const fb = box(film);
      const G = 8;
      const R = 20;
      const x0 = fb.left - G;
      const x1 = fb.right + G;
      const y0 = fb.top - G;
      const y1 = fb.bottom + G;
      // The line arrives on the middle of the frame's top and the frame draws down both sides at
      // once from there, meeting at its foot on the right, where the line leaves (desktop's way).
      const cx = (x0 + x1) / 2;
      const left = `M${cx} ${y0}L${x0 + R} ${y0}Q${x0} ${y0} ${x0} ${y0 + R}L${x0} ${y1 - R}Q${x0} ${y1} ${x0 + R} ${y1}L${x1 - R} ${y1}`;
      const right = `M${cx} ${y0}L${x1 - R} ${y0}Q${x1} ${y0} ${x1} ${y0 + R}L${x1} ${y1 - R}Q${x1} ${y1} ${x1 - R} ${y1}`;
      const out: Run[] = [
        { d: left, y0, y1, ys: [y0, y1], xs: [x0, x0] },
        { d: right, y0, y1, ys: [y0, y1], xs: [x1, x1] },
      ];
      // Then on down from the frame's foot, past the list of films, as an arrow onto the renters'
      // own words under it (Ghulam, 2026-11-14: "then going down to the user").
      const quotes = sec.querySelector(".ts-quotes");
      if (quotes && shown(quotes)) {
        const q = box(quotes).top;
        // Straight on down the frame's right side, clear of the films' lengths (padded on phones).
        const exit = run([{ x: x1, y0: y1 - R, y1: q - 8 }], true);
        if (exit && q - 8 > y1 + 40) out.push(exit);
      }
      return { segs: [{ x: cx, y0, y1: y0 }], runs: out, arrow: false, laneEnd: Math.min(aim.tip, y0 - 36) };
    }
    return { segs: [], runs: [], arrow: true };
  };

  /** Where the line into the next block starts: just under this one, or out of its last number. */
  const fromOf = (sec: HTMLElement): { x: number; y: number; lead?: Seg } => {
    const nums = Array.from(sec.querySelectorAll<HTMLElement>(".rc-step-n, .ls-step-no")).filter(shown);
    const stage = sec.classList.contains("tps") ? sec.querySelector(".tps-box") : null;
    const bottom = stage ? box(stage).bottom : edges(sec).bottom;
    const handOut = Number(sec.dataset.lineOut);
    if (Number.isFinite(handOut) && handOut > 0) return { x: handOut - origin.left, y: box(sec).bottom };
    const wall = sec.id === "operators" ? wallGap(sec) : null;
    if (wall) return { x: wall.x, y: wall.bottom + DOT, lead: { x: wall.x, y0: wall.bottom - 10, y1: wall.bottom + DOT } };
    if (nums.length > 1) {
      const xs = nums.map((n) => box(n).cx);
      if (Math.max(...xs) - Math.min(...xs) < 4) {
        // Numbered steps one above the other: on down from the last number, then the curve.
        const n = box(nums[nums.length - 1]);
        const y = Math.max(bottom, n.bottom) + DOT + 8;
        return { x: n.cx, y, lead: { x: n.cx, y0: n.bottom, y1: y } };
      }
    }
    return { x: START, y: bottom + DOT };
  };

  // The blocks, in order: the rental features, each product screen, then every section after them, then the footer.
  const kids = main ? Array.from(main.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains("ln-layer") && shown(el)) : [];
  const stages = Array.from(document.querySelectorAll<HTMLElement>(".tps")).filter(shown);
  const rcTrack = kids.find((k) => k.querySelector(".rc-list"));
  const track = stages.length ? kids.find((k) => k.contains(stages[0])) : undefined;
  const blocks: HTMLElement[] = [];
  if (rcTrack && track) {
    blocks.push(rcTrack, ...stages, ...kids.slice(kids.indexOf(track) + 1));
    if (footer) blocks.push(footer);
  }
  // An intro and the thing it introduces are one: no arrow between them.
  const joined = (prev: HTMLElement) => prev.classList.contains("di");

  /*
   * Where the line starts: a dot in the middle, on the foot of the hero's picture, so it starts
   * from the end of it (Ghulam, 2026-11-14), clear of the wash over the rows' top. It
   * swings over to the first row's side in the same curve as every arrow, so the first row is
   * given the room for that curve, as each section is below.
   */
  const area = document.querySelector<HTMLElement>("#features");
  const rows = Array.from(document.querySelectorAll<HTMLElement>("#features .pg-row")).filter(shown);
  let start = 0;
  if (area && rows.length) {
    // Right at the foot of the hero's picture, as far down as it shows (the hero crops it).
    const hero = area.previousElementSibling;
    // Exactly at the bottom edge of the hero's dashboard screens, the middle of it, as desktop's
    // line comes out of the foot of its screens (Ghulam, 2026-11-14); the curve stays below it.
    const screens = hero?.querySelector(".hg-marquee");
    start = screens ? box(screens).bottom : hero instanceof HTMLElement ? edges(hero).bottom : box(area).top;
    const delta = start + CURVE + BESIDE - edges(rows[0]).top;
    if (Math.abs(delta) >= 2) {
      const m = parseFloat(getComputedStyle(rows[0]).marginTop) || 0;
      rows[0].style.setProperty("margin-top", `${Math.round(Math.max(-120, Math.min(200, m + delta)))}px`, "important");
      roomed.add(rows[0]);
    }
  }

  // First, the room: each block's top margin so its arrow has exactly the room it needs.
  for (let i = 1; i < blocks.length; i++) {
    if (joined(blocks[i - 1])) continue;
    const aim = aimAt(blocks[i]);
    if (!aim || aim.path) continue;
    const delta = fromOf(blocks[i - 1]).y + CURVE - aim.by;
    if (Math.abs(delta) < 2) continue;
    const m = parseFloat(getComputedStyle(blocks[i]).marginTop) || 0;
    blocks[i].style.setProperty("margin-top", `${Math.round(Math.max(-200, Math.min(320, m + delta)))}px`, "important");
    // So the two blocks' margins never fold into one, which would swallow the change.
    blocks[i - 1].style.setProperty("margin-bottom", "0px", "important");
    roomed.add(blocks[i]);
    roomed.add(blocks[i - 1]);
  }

  // Room over George's film for the line to curve from beside the heading onto the middle of its frame.
  for (const sec of blocks) {
    const film = sec.querySelector<HTMLElement>(".ts-frame");
    const aim = film && shown(film) ? aimAt(sec) : null;
    if (!film || !aim) continue;
    const delta = aim.tip + 44 - (box(film).top - 8);
    if (Math.abs(delta) < 2) continue;
    const m = parseFloat(getComputedStyle(film).marginTop) || 0;
    film.style.setProperty("margin-top", `${Math.round(Math.max(0, Math.min(160, m + delta)))}px`, "important");
    roomed.add(film);
  }

  // 1. From the hero, through the "Your own" rows and the rental features, into the product screens.
  const features = Array.from(document.querySelectorAll<HTMLElement>(".rc-list > li")).filter(shown);
  // The line ends as an arrow into the footer, not on a ring.
  const end: Layout["end"] = null;
  if (area && rows.length) {
    const segs: Seg[] = [];
    segs.push({ x: MID, y0: start, y1: start });
    rows.forEach((row, i) => {
      const b = box(row);
      segs.push({ x: i % 2 === 0 ? L : R, y0: i === 0 ? start + CURVE : b.top, y1: b.bottom });
    });
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
    // Out of the last number and into the calendar, as every arrow after it is drawn.
    const aim = blocks.length > 1 ? aimAt(blocks[1]) : null;
    if (aim && rcTrack) {
      const f = fromOf(rcTrack);
      if (f.lead) segs.push(f.lead);
      segs.push({ x: aim.x, y0: f.y + CURVE, y1: aim.tip });
    }
    const r = run(segs, !!aim);
    if (r) runs.push(r);
  }

  // 2. Every arrow after that: one into each block, from the end of the one before.
  for (let i = 2; i < blocks.length; i++) {
    if (joined(blocks[i - 1])) continue;
    const aim = aimAt(blocks[i]);
    if (!aim) continue;
    let f = fromOf(blocks[i - 1]);
    // Into the logo wall the line carries on from the right, the side the arrow before it was on
    // (Ghulam, 2026-11-14), and curves in from there to the gap it runs down.
    if (blocks[i].id === "operators" && !f.lead) f = { ...f, x: LANE };
    const toFooter = blocks[i] === footer;
    const more = toFooter ? { segs: [], runs: [], arrow: true } : beyond(blocks[i], aim);
    const segs: Seg[] = f.lead ? [f.lead] : [{ x: f.x, y0: f.y, y1: f.y }];
    if (aim.path) {
      // Its own path, starting just under the block before; it runs on into what it reaches
      // (the steps' own line), so it ends straight, with no arrowhead (Ghulam, 2026-11-14).
      // Its first stretch is straight from the start: out at its x, not the usual lane's.
      const [first, ...rest] = aim.path;
      segs[0] = { x: first.x, y0: f.y, y1: f.y };
      segs.push({ ...first, y0: f.y }, ...rest);
      more.arrow = false;
    } else if (!f.lead && Math.abs(f.x - aim.x) < 20) {
      // Already as good as in line (into and out of Bryan's quote): straight down, no kink. Out
      // of a section that draws its own line it keeps that line's x exactly, so the two are one.
      const x = blocks[i - 1].dataset.lineOut ? f.x : aim.x;
      segs[0] = { x, y0: f.y, y1: more.laneEnd ?? aim.tip };
      segs.push(...more.segs);
    } else {
      segs.push({ x: aim.x, y0: f.y + CURVE, y1: more.laneEnd ?? aim.tip });
      segs.push(...more.segs);
    }
    const r = run(segs, more.arrow);
    if (!r) continue;
    runs.push(r, ...more.runs);
  }

  if (!runs.length) return null;
  const height = Math.max(...runs.map((r) => r.y1)) + 20;
  // The rental features' heading-and-picture blocks stick, on a copy of the page's ground that
  // hides what is behind them, this line included; they show the line through (see PhoneLine).
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".rc-panel.rc-inline")).filter(shown);
  // The "Your own" rows paint a purple wash over their top that greyed the line out where it
  // starts (Ghulam, 2026-11-14): they show it through as well, over the wash, under their content.
  if (area && shown(area)) panels.push(area as HTMLElement);
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
    const marks = new MutationObserver(redo);
    marks.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-line-in", "data-line-out"] });
    addEventListener("load", redo);
    const late = setTimeout(redo, 2500);
    return () => {
      ro.disconnect();
      marks.disconnect();
      removeEventListener("load", redo);
      clearTimeout(late);
      cancelAnimationFrame(frame);
      // Wider than a phone, every section keeps its own margins.
      roomed.forEach((el) => {
        el.style.removeProperty("margin-top");
        el.style.removeProperty("margin-bottom");
      });
      roomed.clear();
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
      return { panel, svg, shift, clip: shift.querySelector("rect")!, tip: shift.querySelector<SVGCircleElement>("circle.pg-thread-tip")! };
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
