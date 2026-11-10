import { LINE_MEDIA } from "@/components/sections/launch-section";
import { threadEndX } from "@/components/sections/operations-dashboard";
import { TOUR, type TourStop } from "./tour-script";

/*
 * Where the tour's stops are, and the one line that runs down the whole landing page.
 *
 * Everything is measured from the page as it is, in document pixels, so it follows any
 * section's layout at any width. Nothing here is hard-coded to a section except the four
 * that already draw their own part of the line, which this joins up:
 *
 *   #features    the "Your own" rows' thread (operations-dashboard.tsx), ending on
 *   .rc-track    the rail down the held feature list (rental-cards.tsx)
 *   #trax        #launch, #demo-intro and #your-site, which say where their line comes in
 *                and goes out with data-line-in / data-line-out
 *
 * A section can also ask the routed line to keep to its left with data-line-lane="left"
 * (the phones section, so the line does not run down between the phones), or hand it exact
 * steps with data-line-steps: JSON [{x, y0, y1}] in page px, the line running straight down
 * each step's lane and turning across the space between steps (the operator wall, where it
 * runs down the gap between the logo columns nearest the middle).
 *
 * And a section can hand the line something to frame: the line comes down onto the top of
 * the element marked data-line-frame, splits round it in a rounded frame, meets again at the
 * bottom and carries on (the founder film in the testimonials).
 *
 * Between those, the line is routed here. Each section is cut into bands (runs of content
 * that sit side by side), and in every band the line takes the free lane nearest the middle
 * of the screen: beside the words, never across them, and straight behind solid things like
 * screens and cards, which hide it. It turns from lane to lane only in the open space
 * between bands, which is where it "slides in" under a heading to the top of a screen.
 */

export type MeasuredStop = {
  id: string;
  /** The page height (document px) the tip has to reach for this stop to be the current one. */
  y: number;
  /** The dot on the line, when the line draws one for this stop. */
  node: { x: number; y: number } | null;
  /** Stops in one held section, and the selector that marks this one as showing. */
  group?: string;
  activeWhen?: string;
};

export type LineRun = {
  d: string;
  y0: number;
  y1: number;
  /** x along the run by height: the tip's position at any height, by interpolation. */
  ys: number[];
  xs: number[];
  /** Heights where the run is hidden (it had to pass under text). */
  gaps: [number, number][];
};

export type LineLayout = {
  /** Where the line's layer sits on the page; everything below is in page px. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  runs: LineRun[];
  end: { x: number; y: number } | null;
};

export type TourLayout = {
  stops: MeasuredStop[];
  line: LineLayout | null;
};

/** The tip sits this far down the screen, as on every other part of the thread. */
export const TIP_AT = 0.7;

type Box = { left: number; top: number; right: number; bottom: number };
/** "free": solid, the line passes behind it. "text" and "box": the line must go round. */
type Block = Box & { kind: "free" | "text" | "box" };
/** `home`: the lane this band's section asked for (data-line-lane), in place of the middle of the screen. */
type Band = { top: number; bottom: number; blocks: Block[]; home?: number; lane?: number };

const MERGE_GAP = 24;
/* The line never comes closer than this to words or cards, and would rather keep 48px away. */
const TEXT_PAD = 12;
const TEXT_ROOM = 48;
const LANE_STEP = 8;

/* ---------------------------------------------------------------------------------------- */

function alpha(color: string): number {
  if (!color || color === "transparent") return 0;
  const parts = color.match(/[\d.]+/g);
  if (!parts) return 0;
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

function isOpaque(style: CSSStyleDeclaration): boolean {
  return alpha(style.backgroundColor) >= 0.85 || style.backgroundImage.includes("url(");
}

/*
 * A card the line would show through: framed (a border on every side, or a ring drawn as a
 * shadow), or tinted see-through. The line goes round these. A full-width wash behind a whole
 * section is background, not a card.
 */
function isSeeThroughCard(style: CSSStyleDeclaration, rect: DOMRect): boolean {
  if (rect.width < 60 || rect.height < 40 || rect.width >= document.documentElement.clientWidth * 0.96) return false;
  const sides = ["top", "right", "bottom", "left"] as const;
  const framed = sides.every(
    (side) =>
      parseFloat(style.getPropertyValue(`border-${side}-width`)) >= 1 && alpha(style.getPropertyValue(`border-${side}-color`)) > 0.04,
  );
  // Zeroed shadows (the page switches Tailwind's off) compute to a transparent colour.
  const ringed = style.boxShadow !== "none" && (style.boxShadow.match(/(rgba?|color|oklab|oklch|lab|lch)\([^)]*\)/g) ?? ["x"]).some((c) => alpha(c) > 0.04);
  const tinted = alpha(style.backgroundColor) > 0.04 || style.backgroundImage.includes("gradient");
  return framed || ringed || tinted;
}

/*
 * A held section's pinned part moves with the scroll. Its children are measured against
 * where it sits before the hold, so the result doesn't depend on where the page was.
 */
function stickyShift(el: Element): number {
  let node: Element | null = el;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === "sticky") {
      const parent = node.parentElement;
      if (!parent) return 0;
      const rest = parent.getBoundingClientRect().top + parseFloat(getComputedStyle(parent).paddingTop);
      return rest - node.getBoundingClientRect().top;
    }
    node = node.parentElement;
  }
  return 0;
}

function pageBox(rect: DOMRect | Box, shift = 0): Box {
  return { left: rect.left, right: rect.right, top: rect.top + scrollY + shift, bottom: rect.bottom + scrollY + shift };
}

/*
 * What a section puts in the line's way: its visible words (as tight line boxes), its
 * outlined cards and big drawings, and the solid things the line can pass behind.
 */
let blockCache = new WeakMap<Element, Block[]>();

function blocksOf(section: Element): Block[] {
  const cached = blockCache.get(section);
  if (cached) return cached;
  const blocks: Block[] = [];
  const range = document.createRange();

  const visit = (el: Element, shift: number) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const own = style.position === "sticky" ? stickyShift(el) : 0;
    const total = shift + own;
    const rect = el.getBoundingClientRect();

    if (el instanceof SVGSVGElement) {
      if (rect.width >= 48 && rect.height >= 48) blocks.push({ kind: "box", ...pageBox(rect, total) });
      return;
    }
    if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(el.tagName)) {
      if (rect.width > 1 && rect.height > 1) blocks.push({ kind: "free", ...pageBox(rect, total) });
      return;
    }
    if (rect.width > 1 && rect.height > 1 && isOpaque(style)) {
      const box = pageBox(rect, total);
      // A pinned panel covers its whole track as the page scrolls past behind it.
      if (style.position === "sticky" && el.parentElement) {
        const track = el.parentElement.getBoundingClientRect();
        box.top = track.top + scrollY;
        box.bottom = track.bottom + scrollY;
      }
      blocks.push({ kind: "free", ...box });
      return;
    }
    const outlined = rect.width > 1 && rect.height > 1 && isSeeThroughCard(style, rect);
    const mark = blocks.length;

    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.nodeValue?.trim()) continue;
        range.selectNodeContents(child);
        for (const line of range.getClientRects()) {
          if (line.width > 1 && line.height > 1) blocks.push({ kind: "text", ...pageBox(line, total) });
        }
      } else if (child instanceof Element) {
        visit(child, total);
      }
    }

    // A frame around a solid screen (a browser window, say) is solid too.
    if (outlined) {
      const area = rect.width * rect.height;
      const filled = blocks
        .slice(mark)
        .some((block) => block.kind === "free" && (block.right - block.left) * (block.bottom - block.top) >= area * 0.85);
      blocks.push({ kind: filled ? "free" : "box", ...pageBox(rect, total) });
    }
  };

  for (const child of section.children) visit(child, 0);
  blockCache.set(section, blocks);
  return blocks;
}

function bandsOf(blocks: Block[]): Band[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top);
  const bands: Band[] = [];
  for (const block of sorted) {
    const last = bands[bands.length - 1];
    if (last && block.top <= last.bottom + MERGE_GAP) {
      last.bottom = Math.max(last.bottom, block.bottom);
      last.blocks.push(block);
    } else {
      bands.push({ top: block.top, bottom: block.bottom, blocks: [block] });
    }
  }
  return bands;
}

/*
 * What each lane costs in one band. It may never cross words or an outlined card, it keeps
 * some room from them, and it keeps off the very edge of the screen. Where the band holds a
 * screen, the line wants its middle (that is how it plugs into the top of a screen); anywhere
 * else the middle hardly matters, so the line stays where it is rather than wander.
 */
function bandCost(band: Band, width: number, xs: number[]): Float64Array {
  // data-line-steps: this lane and no other.
  if (band.lane !== undefined) return Float64Array.from(xs, (x) => (Math.abs(x - band.lane!) < 0.5 ? 0 : 1000000));
  const home = band.home ?? width / 2;
  const blocking = band.blocks.filter((block) => block.kind !== "free");
  const screen = band.blocks.some(
    (block) => block.kind === "free" && block.right - block.left >= width * 0.35 && block.left < home && block.right > home,
  );
  // A section that names its lane (data-line-lane) holds the line to it as firmly as a screen does.
  const pull = band.home !== undefined || screen ? 2 : 0.15;
  const costs = new Float64Array(xs.length);
  xs.forEach((x, i) => {
    let cost = Math.abs(x - home) * pull + (x < 32 || x > width - 32 ? 120 : 0);
    for (const block of blocking) {
      const off = x < block.left ? block.left - x : x > block.right ? x - block.right : 0;
      if (off < TEXT_PAD) cost += 100000 + (block.bottom - block.top);
      else if (off < TEXT_ROOM) cost += (TEXT_ROOM - off) * 5;
    }
    costs[i] = cost;
  });
  return costs;
}

/*
 * A move to another lane costs its distance, plus a fixed price for the turn itself so the
 * line makes as few as it can, plus more where the open space to turn in is tight (a turn
 * squeezed into a thin gap reads as a flat hairline).
 */
function moveCost(dx: number, room: number): number {
  if (dx < 2) return 0;
  if (room < 16) return 100000;
  return dx * 0.6 + 160 + Math.max(0, 60 - room) * 3;
}

/*
 * The lanes for a whole run of bands at once, cheapest overall (a shortest path over the
 * bands), so the line never makes a detour for one band only to come straight back.
 */
function planLanes(slots: { band: Band; room: number }[], startX: number, end: { x: number; room: number } | null, width: number): number[] {
  const home = width / 2;
  const xs: number[] = [];
  for (let x = home - Math.floor((home - 20) / LANE_STEP) * LANE_STEP; x <= width - 20; x += LANE_STEP) xs.push(x);
  for (const extra of [startX, end?.x, ...slots.map((slot) => slot.band.lane)]) if (extra !== undefined && !xs.includes(extra)) xs.push(extra);
  xs.sort((a, b) => a - b);
  const n = xs.length;

  let cost = new Float64Array(n);
  const first = bandCost(slots[0].band, width, xs);
  for (let j = 0; j < n; j += 1) cost[j] = moveCost(Math.abs(xs[j] - startX), slots[0].room) + first[j];
  const back: Int32Array[] = [];
  for (let s = 1; s < slots.length; s += 1) {
    const here = bandCost(slots[s].band, width, xs);
    const next = new Float64Array(n);
    const from = new Int32Array(n);
    for (let j = 0; j < n; j += 1) {
      let best = Infinity;
      let arg = 0;
      for (let i = 0; i < n; i += 1) {
        const c = cost[i] + moveCost(Math.abs(xs[j] - xs[i]), slots[s].room);
        if (c < best) {
          best = c;
          arg = i;
        }
      }
      next[j] = best + here[j];
      from[j] = arg;
    }
    back.push(from);
    cost = next;
  }
  if (end) for (let j = 0; j < n; j += 1) cost[j] += moveCost(Math.abs(end.x - xs[j]), end.room);

  let at = 0;
  for (let j = 1; j < n; j += 1) if (cost[j] < cost[at]) at = j;
  const lanes = [xs[at]];
  for (let s = back.length - 1; s >= 0; s -= 1) {
    at = back[s][at];
    lanes.unshift(xs[at]);
  }
  return lanes;
}

/* Where a band at this lane still crosses something it couldn't avoid. */
function gapsIn(band: Band, x: number): [number, number][] {
  const gaps = band.blocks
    .filter((block) => block.kind !== "free" && x > block.left - TEXT_PAD && x < block.right + TEXT_PAD)
    .map((block): [number, number] => [block.top - 14, block.bottom + 14])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const gap of gaps) {
    const last = merged[merged.length - 1];
    if (last && gap[0] <= last[1]) last[1] = Math.max(last[1], gap[1]);
    else merged.push([...gap]);
  }
  return merged;
}

/* ---------------------------------------------------------------------------------------- */

type Seg = { kind: "v"; x: number; y0: number; y1: number } | { kind: "c"; x0: number; x1: number; y0: number; y1: number };

class RunBuilder {
  segs: Seg[] = [];
  gaps: [number, number][] = [];
  x: number;
  y: number;
  readonly y0: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.y0 = y;
  }

  down(to: number) {
    if (to <= this.y) return;
    const last = this.segs[this.segs.length - 1];
    if (last?.kind === "v" && last.x === this.x) last.y1 = to;
    else this.segs.push({ kind: "v", x: this.x, y0: this.y, y1: to });
    this.y = to;
  }

  /* Over to a new lane within the open space [this.y, until], ending straight down. */
  turn(x: number, until: number, { endAtBottom = false } = {}) {
    if (Math.abs(x - this.x) < 2) {
      this.down(until);
      return;
    }
    const room = until - this.y;
    const start = this.y + room * 0.2;
    const end = endAtBottom ? until : until - room * 0.2;
    this.down(start);
    this.segs.push({ kind: "c", x0: this.x, x1: x, y0: start, y1: end });
    this.x = x;
    this.y = end;
    this.down(until);
  }

  build(): LineRun {
    const ys: number[] = [];
    const xs: number[] = [];
    const parts: string[] = [];
    let pen: { x: number; y: number } | null = null;
    const move = (x: number, y: number) => {
      if (!pen || pen.x !== x || pen.y !== y) parts.push(`M${x.toFixed(1)} ${y.toFixed(1)}`);
    };

    for (const seg of this.segs) {
      if (seg.kind === "v") {
        ys.push(seg.y0, seg.y1);
        xs.push(seg.x, seg.x);
        // The pieces of this stretch that aren't under a gap.
        let from = seg.y0;
        const cuts = this.gaps.filter(([a, b]) => b > seg.y0 && a < seg.y1);
        for (const [a, b] of [...cuts, [seg.y1, seg.y1] as [number, number]]) {
          const to = Math.min(a, seg.y1);
          if (to - from > 4) {
            move(seg.x, from);
            parts.push(`L${seg.x.toFixed(1)} ${to.toFixed(1)}`);
            pen = { x: seg.x, y: to };
          }
          from = Math.max(from, b);
        }
      } else {
        const mid = (seg.y0 + seg.y1) / 2;
        move(seg.x0, seg.y0);
        parts.push(`C${seg.x0.toFixed(1)} ${mid.toFixed(1)} ${seg.x1.toFixed(1)} ${mid.toFixed(1)} ${seg.x1.toFixed(1)} ${seg.y1.toFixed(1)}`);
        pen = { x: seg.x1, y: seg.y1 };
        for (let i = 0; i <= 24; i += 1) {
          const t = i / 24;
          const u = 1 - t;
          xs.push(u * u * u * seg.x0 + 3 * u * u * t * seg.x0 + 3 * u * t * t * seg.x1 + t * t * t * seg.x1);
          ys.push(u * u * u * seg.y0 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * seg.y1);
        }
      }
    }
    return { d: parts.join(""), y0: this.y0, y1: this.y, ys, xs, gaps: this.gaps };
  }
}

/** x of a run at a page height. */
export function runX(run: LineRun, y: number): number {
  const { ys, xs } = run;
  if (!ys.length) return 0;
  if (y <= ys[0]) return xs[0];
  for (let i = 1; i < ys.length; i += 1) {
    if (ys[i] >= y) {
      const span = ys[i] - ys[i - 1];
      return span > 0 ? xs[i - 1] + ((xs[i] - xs[i - 1]) * (y - ys[i - 1])) / span : xs[i];
    }
  }
  return xs[xs.length - 1];
}

/*
 * The frame round an element: two halves of a rounded rectangle from the top middle, one each
 * way, meeting at the bottom middle. The clip that grows with the scroll draws both at once.
 * The tip rides the right-hand half.
 */
const FRAME_PAD = 14;

function frameRun(el: HTMLElement): LineRun {
  const box = pageBox(el.getBoundingClientRect());
  const left = box.left - FRAME_PAD;
  const right = box.right + FRAME_PAD;
  const top = box.top - FRAME_PAD;
  const bottom = box.bottom + FRAME_PAD;
  const r = Math.min((parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) + FRAME_PAD, (right - left) / 2, (bottom - top) / 2);
  const cx = (left + right) / 2;
  const f = (n: number) => n.toFixed(1);
  const half = (edge: number, sweep: 0 | 1, inner: number) =>
    `M${f(cx)} ${f(top)}H${f(inner)}A${f(r)} ${f(r)} 0 0 ${sweep} ${f(edge)} ${f(top + r)}V${f(bottom - r)}A${f(r)} ${f(r)} 0 0 ${sweep} ${f(inner)} ${f(bottom)}H${f(cx)}`;
  return {
    d: half(right, 1, right - r) + half(left, 0, left + r),
    y0: top,
    y1: bottom,
    ys: [top, top, top + r, bottom - r, bottom, bottom],
    xs: [cx, right - r, right, right, right - r, cx],
    gaps: [],
  };
}

/* ---------------------------------------------------------------------------------------- */

/** `outY`: where the line leaves, when not the section's bottom (data-line-out-y, page px). */
type Owned = { inX: number; outX: number; outY?: number };

function ownedPart(el: HTMLElement): Owned | null {
  if (el.dataset.lineIn && el.dataset.lineOut) {
    const outY = el.dataset.lineOutY ? Number(el.dataset.lineOutY) : undefined;
    return { inX: Number(el.dataset.lineIn), outX: Number(el.dataset.lineOut), outY };
  }
  if (el.id === "features") {
    const thread = el.querySelector(".pg-thread");
    if (thread && getComputedStyle(thread).display !== "none") {
      const out = threadEndX();
      if (out !== null) return { inX: out, outX: out };
    }
  }
  if (el.matches(".rc-track")) {
    const rail = el.querySelector(".rc-rail")?.getBoundingClientRect();
    if (rail && rail.width > 0) {
      const x = rail.left + rail.width / 2;
      return { inX: x, outX: x };
    }
  }
  return null;
}

/* Where a stop sits on the page, before any hold is taken into account. */
function anchorY(target: Element, at: TourStop["at"]): number {
  const rect = target.getBoundingClientRect();
  const shift = stickyShift(target);
  const top = rect.top + scrollY + shift;
  if (at === "top") return top - 18;
  if (at === "middle") return top + rect.height / 2;
  // The first words (or the first solid thing) inside it.
  const first = blocksOf(target)
    .filter((block) => block.kind !== "box")
    .reduce((min, block) => Math.min(min, block.top), Infinity);
  return (Number.isFinite(first) ? first + shift : top) - 26;
}

function heldY(held: NonNullable<TourStop["held"]>): number | null {
  const track = document.querySelector<HTMLElement>(held.track);
  if (!track) return null;
  const room = track.offsetHeight - innerHeight;
  if (room < innerHeight * 0.5) return null;
  return track.getBoundingClientRect().top + scrollY + TIP_AT * innerHeight + held.share * room;
}

function measureStops(): MeasuredStop[] {
  const out: MeasuredStop[] = [];
  for (const stop of TOUR) {
    const target = document.querySelector(stop.target);
    if (!target || target.getBoundingClientRect().height === 0) continue;
    const held = stop.held ? heldY(stop.held) : null;
    out.push({
      id: stop.id,
      y: held ?? anchorY(target, stop.at),
      node: null,
      group: held !== null && stop.held?.activeWhen ? stop.held.track : undefined,
      activeWhen: held !== null ? stop.held?.activeWhen : undefined,
    });
  }
  return out.sort((a, b) => a.y - b.y);
}

function measureLine(layer: HTMLElement, stops: MeasuredStop[]): LineLayout | null {
  const main = document.getElementById("main");
  if (!main || !matchMedia(`${LINE_MEDIA}`).matches) return null;

  const width = document.documentElement.clientWidth;
  const children = [...main.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.offsetHeight > 0 && !el.hasAttribute("data-tour-layer"),
  );
  const heroAt = children.findIndex((el) => el.matches(".hg-hero"));
  const sections = children.slice(heroAt + 1);
  if (!sections.length) return null;

  const runs: LineRun[] = [];
  let entry: { x: number; y: number } | null = null;
  let start: { x: number; y: number } | null = null;
  let bands: Band[] = [];
  let end: { x: number; y: number } | null = null;

  // Draws the run gathered so far, ending into a section that draws its own part, or (last
  // of all) straight down into the footer, where it makes a splash (page-line.tsx).
  const flush = (into: { x: number; y: number } | null) => {
    if (!start) return;
    let y = start.y;
    const slots = bands.map((band) => {
      const room = band.top - y;
      y = band.bottom;
      return { band, room };
    });
    const lanes = slots.length ? planLanes(slots, start.x, into ? { x: into.x, room: into.y - y } : null, width) : [];
    const run = new RunBuilder(start.x, start.y);
    slots.forEach(({ band }, i) => {
      run.turn(lanes[i], Math.max(run.y, band.top));
      run.gaps.push(...gapsIn(band, lanes[i]));
      run.down(band.bottom);
    });
    if (into) {
      run.turn(into.x, into.y, { endAtBottom: true });
      runs.push(run.build());
    } else {
      // The line ends by dropping straight into the footer, which opens under <main>.
      run.down(Math.max(run.y + 56, main.getBoundingClientRect().bottom + scrollY));
      const built = run.build();
      runs.push(built);
      end = { x: runX(built, built.y1), y: built.y1 };
    }
    start = null;
    bands = [];
  };

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    const top = rect.top + scrollY;
    const bottom = rect.bottom + scrollY;
    const owned = ownedPart(section);

    if (owned) {
      // Straight from one section that draws its own part into another: still join them, with a
      // turn across the room between (product-track.css gives the track that room).
      if (!start && entry && Math.abs(entry.x - owned.inX) > 1 && top > entry.y) start = { ...entry };
      flush({ x: owned.inX, y: top });
      entry = { x: owned.outX, y: owned.outY ?? bottom };
      continue;
    }

    // Something to frame: down onto its top middle, round it, then on from its bottom middle.
    const framed = section.querySelector<HTMLElement>("[data-line-frame]");
    const framedBox = framed?.getBoundingClientRect();
    if (framed && framedBox && framedBox.width > 0) {
      if (!start) start = { x: entry?.x ?? width / 2, y: entry?.y ?? top };
      const frame = frameRun(framed);
      const cx = (framedBox.left + framedBox.right) / 2;
      flush({ x: cx, y: frame.y0 });
      runs.push(frame);
      start = { x: cx, y: frame.y1 };
      for (const band of bandsOf(blocksOf(section))) {
        const floor = bands.length ? bands[bands.length - 1].bottom : start.y;
        if (band.bottom <= floor) continue;
        bands.push({ ...band, top: Math.max(band.top, floor) });
      }
      continue;
    }

    if (!start) start = { x: entry?.x ?? width / 2, y: entry?.y ?? top };
    // data-line-steps: exact lanes, whatever the section holds.
    if (section.dataset.lineSteps) {
      let steps: { x: number; y0: number; y1: number }[] = [];
      try {
        steps = JSON.parse(section.dataset.lineSteps);
      } catch {
        steps = [];
      }
      for (const step of steps) {
        const floor = bands.length ? bands[bands.length - 1].bottom : start.y;
        if (step.y1 > floor) bands.push({ top: Math.max(step.y0, floor), bottom: step.y1, blocks: [], lane: step.x });
      }
      if (steps.length) continue;
    }
    // data-line-lane="left": the line keeps to the left of this section, not its middle.
    const home = section.dataset.lineLane === "left" ? 0 : undefined;
    for (const band of bandsOf(blocksOf(section))) {
      const floor = bands.length ? bands[bands.length - 1].bottom : start.y;
      if (band.bottom <= floor) continue;
      bands.push({ ...band, top: Math.max(band.top, floor), home });
    }
  }
  flush(null);

  // Dots for the stops the routed line passes through.
  for (const stop of stops) {
    const def = TOUR.find((s) => s.id === stop.id);
    if (!def || def.node === false || def.held) continue;
    // Stops inside the sliding track: the track shows its own screens; no dots on the line's
    // crossing into it.
    if (document.querySelector(def.target)?.closest(".pt-outer")) continue;
    const on = runs.find((r) => stop.y >= r.y0 && stop.y <= r.y1 && !r.gaps.some(([a, b]) => stop.y > a && stop.y < b));
    if (on) stop.node = { x: runX(on, stop.y), y: stop.y };
  }

  const box = layer.getBoundingClientRect();
  const originX = box.left;
  const originY = box.top + scrollY;
  const mainBottom = main.getBoundingClientRect().bottom + scrollY;
  return {
    originX,
    originY,
    width,
    height: Math.max(0, mainBottom - originY - 1),
    runs,
    end,
  };
}

export function measureTour(layer: HTMLElement | null): TourLayout {
  blockCache = new WeakMap();
  const stops = measureStops();
  const line = layer ? measureLine(layer, stops) : null;
  return { stops, line };
}

