"use client";

/**
 * AutoSkeleton: the page is its own skeleton.
 *
 * While `loading`, the children render as normal, fed placeholder rows (see
 * `lib/skeleton-data.ts`), with every text, picture and control made
 * invisible (styles/auto-skeleton.css). This component then measures what is
 * really on screen and lays a bone over each piece:
 *
 *   text      a soft pill per line, as wide as the line really is
 *   pictures  img / svg / video, their own size, never sharper than soft
 *   people    avatars as circles
 *   controls  buttons, inputs, selects, switches, checkboxes
 *   charts    a faint line over a baseline, not a grey slab
 *
 * Icons and dots beside a label join the label's pill; specks are dropped.
 * When the data lands, the region's sections arrive one after another.
 *
 * Nothing is drawn by hand, so the skeleton can never drift from the page: add
 * a column, move a card, change a font, and the next load shows the new shape.
 *
 * Escape hatches, all optional:
 *   data-skeleton-keep    show this as it is (static labels, headings)
 *   data-skeleton-block   draw this whole element as one bone
 *   data-skeleton-ignore  draw nothing for this element or anything inside it
 * Table column headers are kept automatically.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * One bone. `k` is what it stands for, which decides how it is drawn:
 * t text line (a pill), b block (control, picture), i icon, a avatar (circle),
 * s swatch (legend dot), c chart (a faint line, not a slab), l layout block
 * (a whole group, in the first-load layout; drawn softer).
 */
export type BoneKind = "t" | "b" | "i" | "a" | "s" | "c" | "l";
export type Bone = { x: number; y: number; w: number; h: number; r: string; k: BoneKind };

const KEEP = 'thead, [role="columnheader"], [data-skeleton-keep]';
const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"]);
const CONTROL = new Set(["BUTTON", "INPUT", "TEXTAREA", "SELECT"]);
const CONTROL_ROLES = new Set(["button", "combobox", "switch", "checkbox", "radio", "slider"]);
/** A "button" taller than this is a clickable card, not a control: look inside it. */
const MAX_CONTROL_HEIGHT = 56;
const MIN_SIZE = 3;
/** Specks smaller than this are left out: they are noise, not shape. */
const MIN_SPECK = 6;
const PILL = "999px";

export type Clip = { left: number; top: number; right: number; bottom: number };

function isControl(el: Element, rect: DOMRect): boolean {
  const role = el.getAttribute("role");
  if (!(CONTROL.has(el.tagName) || (role && CONTROL_ROLES.has(role)))) return false;
  // Short controls, and small square tiles (a calendar day), are one bone;
  // anything bigger is a clickable card whose insides are drawn instead.
  return rect.height <= MAX_CONTROL_HEIGHT || (rect.width <= 160 && rect.height <= 160);
}

/**
 * On screen for real: not display:none, not faded to 0, not visibility:hidden
 * (the back face of a flip card, a closed panel). Pictures and empty boxes are
 * hidden by our own stylesheet, so for them the parent is asked instead.
 */
function visible(el: Element): boolean {
  const own = MEDIA.has(el.tagName.toUpperCase()) || el.childNodes.length === 0;
  const target = own && el.parentElement ? el.parentElement : el;
  // A `display: contents` wrapper has no box, so checkVisibility calls it
  // hidden; its children are what show, and they are checked on their own.
  if (getComputedStyle(target).display === "contents") return true;
  const check = (target as HTMLElement).checkVisibility;
  if (typeof check === "function") {
    return check.call(target, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  }
  return getComputedStyle(target).visibility !== "hidden";
}

function filled(style: CSSStyleDeclaration): boolean {
  const fill = style.backgroundColor;
  return fill !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(fill);
}

/** A dot, a swatch, a legend line: an empty element that is only its colour. */
function isSwatch(el: Element, rect: DOMRect): boolean {
  if (el.childNodes.length > 0 || rect.width > 64 || rect.height > 64) return false;
  if (rect.width < 3 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return filled(style) || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderLeftWidth) > 0;
}

function isChart(el: Element, rect: DOMRect): boolean {
  if (rect.width < 160 || rect.height < 80) return false;
  if (el.tagName === "CANVAS") return true;
  if (el.tagName.toUpperCase() === "SVG") return !!el.closest(".recharts-wrapper, [data-chart]");
  // An old hand-drawn placeholder (a big pulsing slab) reads as a chart area.
  return el.classList.contains("animate-pulse");
}

/** Where the element's content is cut off by scrolling or overflow: hidden. */
function clipFor(el: Element, root: Element, cache: Map<Element, Clip>, base: Clip): Clip {
  const hit = cache.get(el);
  if (hit) return hit;
  let clip = base;
  if (el !== root && el.parentElement) {
    clip = clipFor(el.parentElement, root, cache, base);
    const style = getComputedStyle(el);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      const r = el.getBoundingClientRect();
      clip = {
        left: Math.max(clip.left, r.left),
        top: Math.max(clip.top, r.top),
        right: Math.min(clip.right, r.right),
        bottom: Math.min(clip.bottom, r.bottom),
      };
    }
  }
  cache.set(el, clip);
  return clip;
}

/**
 * Fewer, calmer pieces: an icon or dot sitting right beside a line of text
 * becomes part of that line's pill, and leftover specks are dropped.
 */
function tidy(bones: Bone[]): Bone[] {
  const texts = bones.filter((b) => b.k === "t");
  const drop = new Set<Bone>();
  for (const b of bones) {
    if ((b.k !== "i" && b.k !== "s") || b.h > 24) continue;
    const cy = b.y + b.h / 2;
    const line = texts.find((t) => {
      if (Math.abs(t.y + t.h / 2 - cy) > 6) return false;
      const before = t.x - (b.x + b.w);
      const after = b.x - (t.x + t.w);
      return (before >= -1 && before <= 14) || (after >= -1 && after <= 10);
    });
    if (!line) continue;
    const left = Math.min(line.x, b.x);
    const right = Math.max(line.x + line.w, b.x + b.w);
    line.x = left;
    line.w = right - left;
    drop.add(b);
  }
  return bones.filter((b) => !drop.has(b) && !(b.k !== "t" && b.w < MIN_SPECK && b.h < MIN_SPECK));
}

/**
 * The bones for everything inside `root`, relative to `root`'s box.
 * `keep: false` draws kept elements (headers, featured cards) too, for a
 * snapshot of a loaded page (shape-snapshot.tsx) where nothing is real yet.
 * `clip` limits the result to a viewport-sized area.
 */
export function measure(root: HTMLElement, opts: { keep?: boolean; clip?: Clip } = {}): Bone[] {
  const keepKept = opts.keep !== false;
  const box = root.getBoundingClientRect();
  const base: Clip = opts.clip ?? { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  const clips = new Map<Element, Clip>();
  const bones: Bone[] = [];

  const push = (r: { left: number; top: number; right: number; bottom: number }, clip: Clip, radius: string, k: BoneKind) => {
    const left = Math.max(r.left, clip.left);
    const top = Math.max(r.top, clip.top);
    const right = Math.min(r.right, clip.right);
    const bottom = Math.min(r.bottom, clip.bottom);
    if (right - left < MIN_SIZE || bottom - top < MIN_SIZE) return;
    bones.push({ x: left - box.left, y: top - box.top, w: right - left, h: bottom - top, r: radius, k });
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent && /\S/.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
      const el = node as Element;
      if (el.hasAttribute("data-skeleton-ignore") || (keepKept && el.matches(KEEP))) return NodeFilter.FILTER_REJECT;
      if (!visible(el)) return NodeFilter.FILTER_REJECT;
      const rect = el.getBoundingClientRect();
      const clip = () => (el.parentElement ? clipFor(el.parentElement, root, clips, base) : base);
      if (isChart(el, rect)) {
        push(rect, clip(), "12px", "c");
        return NodeFilter.FILTER_REJECT;
      }
      const media = MEDIA.has(el.tagName.toUpperCase());
      const control = isControl(el, rect);
      const block = el.hasAttribute("data-skeleton-block") || media || control || el.classList.contains("animate-pulse");
      const swatch = !block && isSwatch(el, rect);
      if (!block && !swatch) {
        // An initials avatar: a small filled circle with letters in it is one
        // circle, not a circle with a bar inside.
        if (rect.width >= 16 && rect.width <= 56 && Math.abs(rect.width - rect.height) <= 2) {
          const style = getComputedStyle(el);
          // Initials, not fill: our own stylesheet has already cleared the fill.
          const initials = (el.textContent ?? "").trim().length <= 3;
          if (initials && parseFloat(style.borderRadius) >= rect.width / 2 - 1) {
            push(rect, clip(), PILL, "a");
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      }

      const radius = getComputedStyle(el).borderRadius;
      const round = parseFloat(radius) >= Math.min(rect.width, rect.height) / 2 - 1;
      const square = Math.abs(rect.width - rect.height) <= 2;
      if (swatch) {
        // A 2px legend line gets a bone tall enough to cover it and be seen.
        const grow = Math.max(0, (6 - rect.height) / 2);
        push({ left: rect.left, right: rect.right, top: rect.top - grow, bottom: rect.bottom + grow }, clip(), PILL, "s");
      } else if (media && rect.width <= 28 && rect.height <= 28) {
        push(rect, clip(), PILL, "i");
      } else if (square && rect.width <= 56 && (round || /avatar/i.test(`${el.className} ${el.getAttribute("data-slot") ?? ""}`))) {
        push(rect, clip(), PILL, "a");
      } else {
        // Pictures and controls keep their own rounding, never sharper than soft.
        const r = round ? PILL : `${Math.max(parseFloat(radius) || 0, media ? 12 : 8)}px`;
        push(rect, clip(), r, "b");
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  // Text: one pill per rendered line, about the height of the letters (not
  // the line box), with neighbouring pieces on a line joined up.
  const range = document.createRange();
  const sizes = new Map<Element, number>();
  const lines: Array<{ left: number; top: number; right: number; bottom: number; clip: Clip }> = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const clip = clipFor(parent, root, clips, base);
    let fontSize = sizes.get(parent);
    if (fontSize === undefined) {
      fontSize = parseFloat(getComputedStyle(parent).fontSize) || 14;
      sizes.set(parent, fontSize);
    }
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1) continue;
      const h = Math.max(6, Math.min(r.height, Math.round(fontSize * 0.6)));
      const top = r.top + (r.height - h) / 2;
      const last = lines[lines.length - 1];
      if (last && last.clip === clip && Math.abs(last.top - top) < 3 && r.left - last.right < 8 && r.left >= last.left) {
        last.right = Math.max(last.right, r.right);
        continue;
      }
      lines.push({ left: r.left, top, right: r.right, bottom: top + h, clip });
    }
  }
  for (const l of lines) push(l, l.clip, PILL, "t");
  return tidy(bones);
}

/** A chart area: a soft line over a baseline, instead of a grey slab. */
const CHART_LINE = "M0 70 C 10 62, 18 46, 30 50 S 50 72, 62 52 S 82 24, 100 30";

/** Draws one bone; shared by <AutoSkeleton> and the first-load shape. */
export function BoneView({ bone: b }: { bone: Bone }) {
  const style = { left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.r };
  if (b.k === "c") {
    return (
      <span className="auto-skeleton-chart" style={style}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <path d={`${CHART_LINE} L100 100 L0 100 Z`} className="auto-skeleton-chart-area" />
          <path d={CHART_LINE} className="auto-skeleton-chart-line" vectorEffect="non-scaling-stroke" />
          <path d="M0 99.5 H100" className="auto-skeleton-chart-base" vectorEffect="non-scaling-stroke" />
        </svg>
      </span>
    );
  }
  return <span className={b.k === "l" ? "auto-skeleton-bone auto-skeleton-bone-soft" : "auto-skeleton-bone"} style={style} />;
}

export function AutoSkeleton({
  loading,
  children,
  className,
  outerClassName,
}: {
  loading: boolean;
  children: ReactNode;
  /** Layout for the children (e.g. `space-y-6`, `h-full`). */
  className?: string;
  /** Layout for the wrapper itself, e.g. `flex-1 min-h-0` inside a flex column. */
  outerClassName?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [bones, setBones] = useState<Bone[]>([]);
  const [leaving, setLeaving] = useState(false);
  const wasLoading = useRef(loading);
  const [revealed, setRevealed] = useState(false);

  useLayoutEffect(() => {
    if (!loading) return;
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    // React 18 drops an `inert=""` prop, so it is set on the element itself:
    // placeholder rows must not be clickable or focusable.
    (root as HTMLElement & { inert: boolean }).inert = true;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBones(measure(root)));
    };
    setBones(measure(root));
    const resize = new ResizeObserver(run);
    resize.observe(root);
    const mutation = new MutationObserver(run);
    mutation.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    root.addEventListener("scroll", run, true);
    window.addEventListener("resize", run);
    document.fonts?.ready.then(run).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      (root as HTMLElement & { inert: boolean }).inert = false;
      resize.disconnect();
      mutation.disconnect();
      root.removeEventListener("scroll", run, true);
      window.removeEventListener("resize", run);
    };
  }, [loading]);

  // Loaded: fade the bones out and the page in, then drop the bones.
  useEffect(() => {
    if (wasLoading.current && !loading) {
      setLeaving(true);
      setRevealed(true);
      const t = window.setTimeout(() => {
        setBones([]);
        setLeaving(false);
      }, 200);
      // The arrival runs once; later changes (a tab switch) must not replay it.
      const settle = window.setTimeout(() => setRevealed(false), 700);
      wasLoading.current = false;
      return () => {
        window.clearTimeout(t);
        window.clearTimeout(settle);
      };
    }
    if (loading) {
      wasLoading.current = true;
      setLeaving(false);
    }
  }, [loading]);

  return (
    <div className={outerClassName ? `relative ${outerClassName}` : "relative"}>
      <div
        ref={contentRef}
        className={className}
        data-auto-skeleton={loading ? "" : undefined}
        data-auto-skeleton-revealed={!loading && revealed ? "" : undefined}
        aria-busy={loading || undefined}
      >
        {children}
      </div>
      {bones.length > 0 && (
        <div
          aria-hidden
          className="auto-skeleton-bones pointer-events-none absolute inset-0 overflow-hidden"
          data-leaving={leaving ? "" : undefined}
        >
          {bones.map((b, i) => (
            <BoneView key={i} bone={b} />
          ))}
        </div>
      )}
    </div>
  );
}
