"use client";

/**
 * The first-load skeleton, remembered from the page itself.
 *
 * Before the portal frame exists (sign-in check, billing gate) there is no page
 * to turn into an <AutoSkeleton>. So every time a v2 page finishes loading, the
 * frame quietly records its SHAPE: the card surfaces (position, size, fill,
 * border, rounding) and a bone for every line of text, picture and control, in
 * the part of the window that shows. No text or data is kept, only rectangles.
 * On the next cold load of that route, the frame redraws that shape while it
 * checks sign-in, so the skeleton is the page as it last looked. Change the UI
 * and the next visit records the new shape.
 *
 * Per browser (localStorage), per route pattern (ids folded to `:id`), per
 * theme; a window of a different width falls back to the generic skeleton.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BoneView, measure, type Bone } from "@/components/skeleton-v2/auto-skeleton";

type Surface = { x: number; y: number; w: number; h: number; r: string; bg: string; border: string; bw: number };
/** Bumped whenever bones change meaning, so older shapes are simply not used. */
const VERSION = 3;
type Shape = { v: number; w: number; h: number; dark: boolean; bones: Bone[]; surfaces: Surface[] };

const PREFIX = "d247.shape.";
const INDEX_KEY = "d247.shape.index";
const MAX_ROUTES = 40;
const MAX_BONES = 900;
const MAX_SURFACES = 200;
/** How long the page must sit still before its shape is taken. */
const QUIET_MS = 900;
const GIVE_UP_MS = 12_000;

/** `/rentals/6e5c…` → `/rentals/:id`, so every record shares one shape. */
export function shapePattern(pathname: string): string {
  return (
    pathname
      .split("/")
      .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d+$/.test(seg) ? ":id" : seg))
      .join("/") || "/"
  );
}

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function transparent(color: string) {
  return color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
}

/** Cards, panels, table header rows: boxes with their own fill or border. */
function measureSurfaces(root: HTMLElement): Surface[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: Surface[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node && out.length < MAX_SURFACES; node = walker.nextNode()) {
    const el = node as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 40) continue;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    // The page's own backdrop is painted by the replay; only boxes on it count.
    if (r.width * r.height > vw * vh * 0.6) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    const bw = parseFloat(style.borderTopWidth) || 0;
    let border = bw > 0 && !transparent(style.borderTopColor) ? style.borderTopColor : "";
    const bg = transparent(style.backgroundColor) ? "" : style.backgroundColor;
    if (!border && !bg) continue;
    // A decorative wash (a soft blob behind a promo) is not a container.
    if (!border && /rgba\([^)]*,\s*0?\.[0-4]\d*\)$/.test(bg)) continue;
    if (r.left < 0 || r.top < 0) continue;
    // A card lifted by a shadow instead of a border would vanish as a flat
    // white box on the light wash, so it gets a hairline edge instead.
    let edge = border ? bw : 0;
    if (!border && style.boxShadow !== "none") {
      border = "hsl(var(--border))";
      edge = 1;
    }
    out.push({ x: r.left, y: r.top, w: r.width, h: r.height, r: style.borderRadius, bg, border, bw: edge });
  }
  return out;
}

type Box = { l: number; t: number; r: number; b: number };

const inside = (x: number, y: number, s: Surface) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
const contains = (outer: Surface, inner: Surface) =>
  inner !== outer && inner.x >= outer.x - 1 && inner.y >= outer.y - 1 &&
  inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;

/**
 * Two pieces belong together when they are neighbours in a column (lined up,
 * of a similar height: a run of links) or in a row (side by side on the same
 * line: an icon and its label, a group of buttons). Pieces from different rows
 * of the page never fuse, however close.
 */
function joins(a: Box, c: Box, gapX: number, gapY: number): boolean {
  const aw = a.r - a.l;
  const cw = c.r - c.l;
  const ah = a.b - a.t;
  const ch = c.b - c.t;
  const overlapX = Math.min(a.r, c.r) - Math.max(a.l, c.l);
  const overlapY = Math.min(a.b, c.b) - Math.max(a.t, c.t);
  if (overlapX > 0 && overlapY > 0) return true;
  const gapBetweenY = Math.max(a.t, c.t) - Math.min(a.b, c.b);
  const gapBetweenX = Math.max(a.l, c.l) - Math.min(a.r, c.r);
  // Only text-sized pieces stack into columns (a run of links, a title over
  // its subtitle); buttons and bars stay in their own row.
  const column =
    Math.max(ah, ch) <= 20 && overlapX >= 0.5 * Math.min(aw, cw) && gapBetweenY <= gapY && Math.max(ah, ch) <= 2 * Math.min(ah, ch);
  const row = overlapY >= 0.5 * Math.min(ah, ch) && gapBetweenX <= gapX;
  return column || row;
}

/**
 * Joins pieces that sit within `gapX` / `gapY` px of each other into one box:
 * a run of sidebar links becomes one block, a divider's wider gap splits groups.
 */
function cluster(boxes: Box[], gapX: number, gapY: number): Box[] {
  const out = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const c = out[j];
        if (joins(a, c, gapX, gapY)) {
          out[i] = { l: Math.min(a.l, c.l), t: Math.min(a.t, c.t), r: Math.max(a.r, c.r), b: Math.max(a.b, c.b) };
          out.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * The page's LAYOUT, not its details: the outermost cards as empty
 * containers, and everything outside them (sidebar groups, the search bar, the
 * title) joined into a few soft blocks. The content lands in these boxes once
 * the frame is up, where the page's own detailed skeleton takes over.
 */
function takeShape(root: HTMLElement): Shape {
  const box = root.getBoundingClientRect();
  const clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const all = measureSurfaces(root);
  const surfaces = all.filter((s) => !all.some((o) => contains(o, s)));
  const loose = measure(root, { keep: false, clip })
    .slice(0, MAX_BONES)
    .map((b) => ({ ...b, x: b.x + box.left, y: b.y + box.top }))
    .filter((b) => !surfaces.some((s) => inside(b.x + b.w / 2, b.y + b.h / 2, s)));
  // A chart outside any card stays a chart; the rest becomes layout blocks.
  const charts = loose.filter((b) => b.k === "c");
  const blocks = cluster(
    loose.filter((b) => b.k !== "c").map((b) => ({ l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h })),
    24,
    30,
  )
    .filter((c) => c.r - c.l >= 24 || c.b - c.t >= 24)
    .map<Bone>((c) => {
      const h = c.b - c.t;
      return { x: c.l, y: c.t, w: c.r - c.l, h, r: h <= 44 ? "999px" : "14px", k: "l" };
    });
  const bones = [...charts, ...blocks].map((b) => ({
    ...b,
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.w),
    h: Math.round(b.h),
  }));
  return { v: VERSION, w: window.innerWidth, h: window.innerHeight, dark: isDark(), bones, surfaces };
}

function save(pattern: string, shape: Shape) {
  try {
    localStorage.setItem(PREFIX + pattern, JSON.stringify(shape));
    const index: string[] = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]").filter((p: string) => p !== pattern);
    index.unshift(pattern);
    for (const stale of index.splice(MAX_ROUTES)) localStorage.removeItem(PREFIX + stale);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage full or blocked: the generic skeleton still works.
  }
}

function load(pattern: string): Shape | null {
  try {
    const raw = localStorage.getItem(PREFIX + pattern);
    const shape = raw ? (JSON.parse(raw) as Shape) : null;
    if (!shape || shape.v !== VERSION) return null;
    if (shape.dark !== isDark()) return null;
    if (Math.abs(shape.w - window.innerWidth) > window.innerWidth * 0.12) return null;
    return shape;
  } catch {
    return null;
  }
}

/** Nothing is still loading, no dialog is open, and the page is on screen. */
function settled(root: HTMLElement) {
  return (
    !document.querySelector('[data-auto-skeleton], [aria-busy="true"], [role="dialog"], [role="alertdialog"]') &&
    document.visibilityState === "visible" &&
    root.getBoundingClientRect().height > 0
  );
}

/**
 * Records the current route's shape once it has loaded and gone quiet. Call it
 * in the frame; `enabled` is false until the frame (not a gate) is showing.
 * The frame's root carries `data-shape-root`.
 */
export function useShapeRecorder(enabled: boolean) {
  const pathname = usePathname();
  useEffect(() => {
    if (!enabled || !pathname) return;
    // The frame can still be behind a later gate when this runs, so the root
    // is looked up on every tick rather than once.
    let root: HTMLElement | null = null;
    const started = Date.now();
    let quietSince = Date.now();
    // Taken again whenever the page changes and settles again (a card that
    // finishes loading late), until GIVE_UP_MS.
    let takenAt = 0;
    const mutation = new MutationObserver(() => {
      quietSince = Date.now();
    });
    const timer = window.setInterval(() => {
      if (!root) {
        root = document.querySelector<HTMLElement>("[data-shape-root]");
        if (root) {
          quietSince = Date.now();
          mutation.observe(root, { subtree: true, childList: true, characterData: true });
        }
      }
      if (Date.now() - started > GIVE_UP_MS) {
        window.clearInterval(timer);
        return;
      }
      if (!root || takenAt > quietSince) return;
      if (Date.now() - quietSince < QUIET_MS || !settled(root) || window.scrollY > 0) return;
      takenAt = Date.now();
      const frame = root;
      const run = () => save(shapePattern(pathname), takeShape(frame));
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 1000 });
      else run();
    }, 300);
    return () => {
      window.clearInterval(timer);
      mutation.disconnect();
    };
  }, [enabled, pathname]);
}

/** The chart bone's drawing, as markup, for the boot script below. */
const CHART_SVG =
  '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
  '<path d="M0 70 C 10 62, 18 46, 30 50 S 50 72, 62 52 S 82 24, 100 30 L100 100 L0 100 Z" class="auto-skeleton-chart-area"/>' +
  '<path d="M0 70 C 10 62, 18 46, 30 50 S 50 72, 62 52 S 82 24, 100 30" class="auto-skeleton-chart-line" vector-effect="non-scaling-stroke"/>' +
  '<path d="M0 99.5 H100" class="auto-skeleton-chart-base" vector-effect="non-scaling-stroke"/></svg>';

/**
 * Paints the remembered shape the moment the HTML arrives, before the app's
 * JavaScript has loaded: without it a hard refresh showed only the page wash
 * until hydration. It mirrors `load()` and <ShapeSkeleton> below, draws into
 * its own element on <body> (outside React), and <ShapeSkeleton> removes that
 * element as soon as it takes over. Every value is checked before it is
 * written, since it comes back out of localStorage.
 */
const BOOT_SCRIPT = `(function(){try{
var p=location.pathname.split('/').map(function(s){return /^[0-9a-f-]{16,}$/i.test(s)||/^\\d+$/.test(s)?':id':s}).join('/')||'/';
var raw=localStorage.getItem('${PREFIX}'+p);if(!raw)return;
var s=JSON.parse(raw);if(s.v!==${VERSION})return;
if(s.dark!==document.documentElement.classList.contains('dark'))return;
if(Math.abs(s.w-innerWidth)>innerWidth*0.12)return;
var ok=/^[#\\w\\s().,%-]*$/;function n(v){return Number(v)||0}function c(v){return typeof v==='string'&&ok.test(v)?v:''}
var h='';
(s.surfaces||[]).forEach(function(x){h+='<div style="position:absolute;left:'+n(x.x)+'px;top:'+n(x.y)+'px;width:'+n(x.w)+'px;height:'+n(x.h)+'px;border-radius:'+c(x.r)+';'+(c(x.bg)?'background:'+c(x.bg)+';':'')+(c(x.border)?'border:'+n(x.bw)+'px solid '+c(x.border)+';':'')+'"><span class="auto-skeleton-sheen"></span></div>'});
(s.bones||[]).forEach(function(b){var st='left:'+n(b.x)+'px;top:'+n(b.y)+'px;width:'+n(b.w)+'px;height:'+n(b.h)+'px;border-radius:'+c(b.r);
h+=b.k==='c'?'<span class="auto-skeleton-chart" style="'+st+'">'+${JSON.stringify(CHART_SVG)}+'</span>':'<span class="auto-skeleton-bone'+(b.k==='l'?' auto-skeleton-bone-soft':'')+'" style="'+st+'"></span>'});
var d=document.createElement('div');d.id='d247-shape-boot';d.setAttribute('aria-hidden','true');
d.style.cssText='position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:40';d.innerHTML=h;document.body.appendChild(d);
}catch(e){}})();`;

function removeBoot() {
  document.getElementById("d247-shape-boot")?.remove();
}

const PENDING = "pending" as const;
const noop = () => () => {};

/**
 * The remembered shape of this route, drawn full-window; `fallback` when there
 * is none yet (first visit, other theme, different window width). During
 * hydration it draws only the backdrop, so the server render never flashes a
 * different skeleton first.
 */
export function ShapeSkeleton({ fallback, className }: { fallback: ReactNode; className?: string }) {
  const pathname = usePathname();
  const shapeJson = useSyncExternalStore(
    noop,
    () => {
      const shape = load(shapePattern(pathname || "/"));
      return shape ? JSON.stringify(shape) : "";
    },
    () => PENDING,
  );
  // Once React is drawing (below), the boot copy steps aside.
  useEffect(() => {
    if (shapeJson !== PENDING) removeBoot();
  }, [shapeJson]);
  useEffect(() => removeBoot, []);
  if (shapeJson === PENDING) {
    return (
      <div aria-hidden className={`fixed inset-0 ${className ?? ""}`}>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </div>
    );
  }
  if (!shapeJson) return <>{fallback}</>;
  const shape = JSON.parse(shapeJson) as Shape;
  return (
    <div role="status" aria-label="Loading" className={`fixed inset-0 overflow-hidden ${className ?? ""}`}>
      {shape.surfaces.map((s, i) => (
        <div
          key={`s${i}`}
          aria-hidden
          className="absolute"
          style={{
            left: s.x,
            top: s.y,
            width: s.w,
            height: s.h,
            borderRadius: s.r,
            background: s.bg || undefined,
            border: s.border ? `${s.bw}px solid ${s.border}` : undefined,
          }}
        >
          <span className="auto-skeleton-sheen" />
        </div>
      ))}
      {shape.bones.map((b, i) => (
        <BoneView key={`b${i}`} bone={b} />
      ))}
    </div>
  );
}

/** A bone in normal flow, for the generic frame below. */
function Bar({ w, h = 10, r = "999px", className }: { w: number | string; h?: number; r?: string; className?: string }) {
  return <span className={`auto-skeleton-bone auto-skeleton-bone-soft block ${className ?? ""}`} style={{ position: "relative", width: w, height: h, borderRadius: r }} />;
}

/** An empty card, the same container the recorded layout draws. */
function Container({ className }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border/60 bg-card/70 ${className ?? ""}`}>
      <span className="auto-skeleton-sheen" />
    </div>
  );
}

/**
 * The v2 frame's layout, drawn generically, for the one load that has no
 * remembered shape yet (first visit to a route, other theme, other window
 * width): sidebar groups, the top bar, a title, an overview and cards. Only
 * big blocks and empty containers, like the recorded layout.
 */
export function GenericFrameSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`fixed inset-0 flex overflow-hidden ${className ?? ""}`}>
      <div className="hidden w-64 shrink-0 flex-col gap-6 px-4 py-5 md:flex">
        <Bar w="70%" h={32} />
        <Bar w="100%" h={40} />
        <Bar w="80%" h={110} r="14px" />
        <Bar w="75%" h={200} r="14px" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-6 px-6 py-4">
        <div className="flex items-center justify-between">
          <Bar w={340} h={40} />
          <Bar w={120} h={40} />
        </div>
        <Bar w={320} h={52} r="14px" className="mt-4" />
        <div className="flex gap-6">
          <Container className="h-56 flex-1" />
          <Container className="hidden h-56 w-80 lg:block" />
        </div>
        <div className="grid flex-1 gap-6 lg:grid-cols-3">
          <Container className="min-h-72" />
          <Container className="hidden min-h-72 lg:block" />
          <Container className="hidden min-h-72 lg:block" />
        </div>
      </div>
    </div>
  );
}
