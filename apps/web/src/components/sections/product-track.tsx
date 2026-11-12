"use client";

import { Children, cloneElement, isValidElement, useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Accent } from "./section-heading";
import { LINE_MEDIA } from "./launch-section";
import "./product-track.css";

/*
 * The track's first screen: big words, one short line, and a big arrow at the end of them.
 *
 * The page line comes down from the top of the screen and turns, in one smooth curve that
 * widens as it goes, into the arrow's shaft. The scroll draws it: the line falls, fills the
 * arrow from tail to head, the arrow moves forward a little, and then the next screen slides
 * in (Ghulam, 2026-11-10). ProductTrack drives the drawing; this only lays it out.
 *
 * The drawing (.pt-intro-art) is an outline of the whole path, faint, with the filled path
 * on top shown through a mask that grows along the path's centre line. Where the track is not
 * pinned (phones, short screens, reduced motion), a plain arrow stands in the slot instead.
 */
/*
 * The same screen goes before each product on the track (Ghulam, 2026-11-10: a text screen
 * before the multi-chat and the insights too, "just like the calendar"). Only the first, the
 * lead, takes the page line into its arrow; the others show their arrow as it is.
 */
const CALENDAR_TITLE = (
  <>
    Every car, every booking, every return. <Accent>One&nbsp;calendar.</Accent>
  </>
);
const CALENDAR_SUB = "Your whole fleet on one timeline. See what goes out, what comes back and which days are still free, and never double-book a car.";

/*
 * The heading types itself out, quickly, each time its screen arrives (Ghulam, 2026-11-10:
 * "the text should come with a quick typing animation"). Every character is its own span with
 * its place in the order (--i); CSS shows them one after another, so the line never reflows
 * while it types. Words stay whole (no break inside one). Screen readers get the plain text.
 */
function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return "";
}
function typed(node: ReactNode, counter: { n: number }): ReactNode {
  if (typeof node === "string") {
    return node.split(/(\s+)/).map((part, w) =>
      /^\s+$/.test(part) || part === "" ? (
        part
      ) : (
        <span key={w} className="pt-word">
          {Array.from(part).map((ch, c) => (
            <span key={c} className="pt-ch" style={{ "--i": counter.n++ } as CSSProperties}>
              {ch}
            </span>
          ))}
        </span>
      ),
    );
  }
  if (Array.isArray(node)) return node.map((child, i) => <span key={i} style={{ display: "contents" }}>{typed(child, counter)}</span>);
  if (isValidElement<{ children?: ReactNode }>(node)) return cloneElement(node as ReactElement<{ children?: ReactNode }>, undefined, typed(node.props.children, counter));
  return node;
}
function Typed({ children }: { children: ReactNode }) {
  const counter = { n: 0 };
  const out = typed(children, counter);
  return (
    <>
      <span className="sr-only">{plainText(children)}</span>
      <span aria-hidden>
        {out}
        <span className="pt-caret" />
      </span>
    </>
  );
}

export function TrackIntro({ title = CALENDAR_TITLE, sub = CALENDAR_SUB, lead = true }: { title?: ReactNode; sub?: ReactNode; lead?: boolean }) {
  return (
    <div className={`pt-intro${lead ? " is-lead" : ""}`} style={{ "--pt-chars": plainText(title).replace(/\s/g, "").length } as CSSProperties}>
      {lead && (
      <svg className="pt-intro-art" aria-hidden focusable="false">
        <defs>
          <mask id="pt-intro-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <path className="pt-m pt-m-main" />
            <path className="pt-m pt-m-arm" />
            <path className="pt-m pt-m-arm" />
          </mask>
        </defs>
        <g className="pt-art-ghost">
          {/* The line still to come: the page line's own dotted look (portal-glass.css). */}
          <path className="pt-a-drop pg-thread-rest" />
          <path className="pt-a-bend" />
          <path className="pt-a-shaft" />
          <path className="pt-a-head" />
        </g>
        <g className="pt-art-live" mask="url(#pt-intro-mask)">
          <path className="pt-a-drop" />
          <path className="pt-a-bend" />
          <path className="pt-a-shaft" />
          <path className="pt-a-head" />
        </g>
        {/* The tip, as on the rest of the page line, until the line reaches the arrow. */}
        <circle className="pt-a-tip pg-thread-tip" r="5" />
      </svg>
      )}

      <div className="pt-intro-body">
        <div className="pt-intro-words">
          <h2 className="pt-intro-title">
            <Typed>{title}</Typed>
          </h2>
          <p className="pt-intro-sub">{sub}</p>
        </div>
        <div className="pt-intro-slot" aria-hidden>
          {lead ? (
            <ArrowRight className="pt-intro-arrow" strokeWidth={1.5} absoluteStrokeWidth />
          ) : (
            // The later screens: a long, wide arrow (Ghulam, 2026-11-10: "a more widthy arrow").
            // Its head is as tall as the first screen's arrowhead (Ghulam, 2026-11-10): the box is
            // 274:100, so at 24vw wide it is 8.75vw tall, the lead arrow's 14/24 of 15vw.
            <svg className="pt-intro-arrow is-long" viewBox="0 0 274 100" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
              <path className="pt-long-shaft" d="M2 50H272" />
              <path className="pt-long-head" d="M223 1 272 50 223 99" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

/*
 * Calendar → Multi-chat → Insights as one pinned, sideways track (Ghulam, 2026-11-10).
 *
 * The page scrolls down; the track holds still and the screens slide left with the scroll,
 * continuously: there is no snapping and nothing takes the wheel. Each screen fills the view
 * edge to edge with only the product in it: no heading, no sub-line, no feature points
 * (product-track.css hides them inside the track only, so the sections themselves are
 * untouched).
 *
 * Each screen rests edge to edge for a short stretch of scrolling (HOLD) before the next one
 * moves in. Before the first slide there is an extra stretch for the intro's arrow to be drawn.
 *
 * Wide screens only. Below it, or with reduced motion asked for, the screens simply stack.
 */

const MEDIA = "(min-width: 1100px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)";
/** Share of each step's scrolling spent holding still, split before and after the move. */
const HOLD = 0.22; // a short rest edge to edge; most of the scrolling moves the screens
/** The page line's tip sits this far down the screen (components/tour/tour-layout.ts TIP_AT). */
const TIP = 0.7;
/** Scrolling (px) for the arrow's move forward, and the still moment after it. */
const NUDGE_PX = 220;
const REST_PX = 160;

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** The slide between two screens: nearly the scroll itself, softened only where it leaves and lands. */
const glide = (u: number) => u * u * (3 - 2 * u) * 0.5 + u * 0.5;

/* The intro arrow, in the intro screen's own pixels. Proportions are lucide's ArrowRight. */
type Art = {
  x0: number; // the line's x, and the tail of the arrow
  cy: number; // the shaft's height
  u: number; // one unit of the 24-unit icon
  w: number; // the arrow's stroke width
  r: number; // the bend's radius
};

/** How long the line takes to swell to the arrow's width, in icon units, above the bend. */
const SWELL = 6;
/** The arrow is drawn at the page line's own width (Ghulam, 2026-11-10: same thickness as the line from the top). */
const LINE_W = 1.5;

function artPaths(a: Art, dx: number) {
  const { x0, cy, u, w, r } = a;
  const head = x0 + 14 * u + dx;
  const arm = 7 * u;

  /*
   * The swell: on the straight, just above the bend, the line widens evenly on both sides
   * from its 1.5px to the arrow's stroke. The bend and the shaft are then one stroke of even
   * width. (Widening inside the bend itself made a lopsided horn.)
   */
  const top = cy - r - SWELL * u;
  const end = cy - r + 0.5; // a hair into the bend, so no seam shows where they meet
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const y = top + (end - top) * t;
    const half = (1.5 + (w - 1.5) * (t * t * (3 - 2 * t))) / 2;
    left.push(`${(x0 - half).toFixed(2)} ${y.toFixed(2)}`);
    right.unshift(`${(x0 + half).toFixed(2)} ${y.toFixed(2)}`);
  }

  return {
    // At the line's own width there is nothing to swell: one plain line, no seam.
    drop: w <= 1.5 ? `M${x0} 0V${cy - r}` : `M${x0} 0V${top + 0.5}`,
    bend: w <= 1.5 ? "" : `M${left.join("L")}L${right.join("L")}Z`,
    shaft: `M${x0} ${cy - r}A${r} ${r} 0 0 0 ${x0 + r} ${cy}H${head}`,
    head: `M${head - arm} ${cy - arm}L${head} ${cy}L${head - arm} ${cy + arm}`,
    // The mask's centre lines: down, round the bend and along the shaft, then out each arm.
    main: `M${x0} 0V${cy - r}A${r} ${r} 0 0 0 ${x0 + r} ${cy}H${head}`,
    arms: [`M${head} ${cy}L${head - arm} ${cy - arm}`, `M${head} ${cy}L${head - arm} ${cy + arm}`],
    mainLength: cy - r + (Math.PI * r) / 2 + (head - x0 - r),
    armLength: arm * Math.SQRT2,
  };
}

const BIG = 100000;
/** Shows the first `length` px of a mask path. */
function reveal(path: SVGPathElement | undefined, length: number) {
  if (!path) return;
  path.style.strokeDasharray = `${BIG} ${BIG}`;
  path.style.strokeDashoffset = String(BIG - Math.max(0, length));
  // A zero-length dash still paints its round cap as a dot: hide the path until it starts.
  path.style.visibility = length > 0 ? "visible" : "hidden";
}

/*
 * Phones and tablets (Ghulam's brief, 2026-11-10: "the horizontal scroll needs a clever
 * solution for mobile, users scroll vertically"). Pinning six full screens sideways does not
 * fit a phone: each product is taller than the screen. So the page scrolls down as usual and
 * the sideways motion is carried three ways, all driven by the vertical scroll:
 *
 *  - a small rail pinned at the top (Calendar · Messages · Insights) whose thumb slides
 *    sideways from stop to stop as each product arrives, so the visitor always knows where
 *    they are on the track and can tap to jump;
 *  - every screen slides in from the right as it comes up (the track still "moves left"), and
 *    the text screens slide on out to the left as they leave;
 *  - the calendar's own board, wider than the phone, pans sideways with the scroll, the
 *    desktop slide in miniature. A touch on the board hands it to the thumb.
 *
 * The headings type themselves as on desktop. Reduced motion: none of it, just the stack.
 */
const FLOW_MEDIA = "((max-width: 1099.98px) or (max-height: 639.98px)) and (prefers-reduced-motion: no-preference)";
const STOPS = ["Calendar", "Messages", "Insights"];

export function ProductTrack({ children, stops = STOPS }: { children: ReactNode; stops?: string[] }) {
  const outer = useRef<HTMLDivElement>(null);
  const panels = Children.toArray(children);
  const steps = panels.length - 1;

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const media = matchMedia(FLOW_MEDIA);
    let frame = 0;
    let io: IntersectionObserver | null = null;
    let gone: IntersectionObserver | null = null;
    let calendarTaken = false;
    const panelEls = Array.from(el.querySelectorAll<HTMLElement>(".pt-panel"));
    const rail = el.querySelector<HTMLElement>(".pt-rail");
    const thumb = el.querySelector<HTMLElement>(".pt-rail-thumb");
    const railItems = Array.from(el.querySelectorAll<HTMLElement>(".pt-rail-item"));
    const board = el.querySelector<HTMLElement>("#calendar .cs-board");
    const calendarPanel = board?.closest<HTMLElement>(".pt-panel") ?? null;
    // Where each stop starts: the text screen before each product.
    const starts = panelEls.filter((p) => p.querySelector(".pt-intro"));
    const isIntro = (p: HTMLElement) => starts.includes(p);

    const smooth = (u: number) => u * u * (3 - 2 * u);
    const update = () => {
      frame = 0;
      const vh = innerHeight;
      const vw = innerWidth;
      for (const panel of panelEls) {
        const r = panel.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) continue;
        const enter = smooth(clamp((vh * 0.98 - r.top) / (vh * 0.5)));
        let dx = (1 - enter) * (isIntro(panel) ? 0.34 : 0.18) * vw;
        let fade = 0.15 + 0.85 * enter;
        if (isIntro(panel)) {
          const leave = smooth(clamp((vh * 0.3 - r.bottom) / (vh * 0.35)));
          dx -= leave * 0.26 * vw;
          fade *= 1 - leave * 0.75;
        }
        panel.style.transform = dx ? `translate3d(${dx.toFixed(1)}px,0,0)` : "";
        panel.style.opacity = fade < 0.999 ? fade.toFixed(3) : "";
      }

      // The calendar pans sideways as it rises through the screen.
      if (board && calendarPanel && !calendarTaken) {
        const r = calendarPanel.getBoundingClientRect();
        const room = board.scrollWidth - board.clientWidth;
        if (room > 0) board.scrollLeft = smooth(clamp((vh * 0.75 - r.top) / (vh * 0.75))) * room;
      }

      // The rail: on while the track is on screen, its thumb sliding from stop to stop.
      if (rail && thumb && starts.length) {
        const mid = vh * 0.5;
        const tops = starts.map((p) => p.getBoundingClientRect().top);
        const end = el.getBoundingClientRect().bottom;
        const on = tops[0] < vh * 0.4 && end > vh * 0.45;
        rail.classList.toggle("is-on", on);
        let f = 0;
        for (let k = 0; k < tops.length - 1; k += 1) {
          // Moves over the last stretch before the next stop's screen reaches mid-screen.
          f += smooth(clamp((mid + vh * 0.55 - tops[k + 1]) / (vh * 0.55)));
        }
        thumb.style.transform = `translate3d(${(f * 100).toFixed(2)}%,0,0)`;
        const at = Math.round(f);
        railItems.forEach((item, i) => item.classList.toggle("is-on", i === at));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const take = () => {
      calendarTaken = true;
    };

    const start = () => {
      el.classList.add("is-flow");
      // Each screen's words play in once it is well in view, and reset only once it has left
      // the screen entirely, so they never vanish while still being read; they play again
      // when it comes back.
      io = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("is-here")),
        { rootMargin: "-25% 0px -25% 0px" },
      );
      gone = new IntersectionObserver((entries) => entries.forEach((e) => !e.isIntersecting && e.target.classList.remove("is-here")));
      panelEls.forEach((p) => {
        io!.observe(p);
        gone!.observe(p);
      });
      addEventListener("scroll", onScroll, { passive: true });
      addEventListener("resize", onScroll);
      board?.addEventListener("pointerdown", take);
      board?.addEventListener("touchstart", take, { passive: true });
      update();
    };
    const stop = () => {
      el.classList.remove("is-flow");
      io?.disconnect();
      gone?.disconnect();
      io = gone = null;
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      board?.removeEventListener("pointerdown", take);
      board?.removeEventListener("touchstart", take);
      cancelAnimationFrame(frame);
      frame = 0;
      rail?.classList.remove("is-on");
      panelEls.forEach((p) => {
        p.style.removeProperty("transform");
        p.style.removeProperty("opacity");
        p.classList.remove("is-here");
      });
    };
    const sync = () => (media.matches ? start() : stop());
    sync();
    const onChange = () => {
      stop();
      sync();
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
      stop();
    };
  }, []);

  const jump = (i: number) => {
    const intros = Array.from(outer.current?.querySelectorAll<HTMLElement>(".pt-panel") ?? []).filter((p) => p.querySelector(".pt-intro"));
    const to = intros[i];
    if (!to) return;
    // The product itself, just under the rail: skip past its text screen.
    const product = to.nextElementSibling as HTMLElement | null;
    const y = (product ?? to).getBoundingClientRect().top + scrollY - 64;
    scrollTo({ top: y, behavior: "smooth" });
  };

  useEffect(() => {
    const el = outer.current;
    if (!el || steps < 1) return;
    const pinned = matchMedia(MEDIA);
    const lineMedia = matchMedia(LINE_MEDIA);
    let frame = 0;
    let art: Art | null = null;
    /** Pinned scrolling (px) spent on the intro's arrow before the first slide. */
    let introPx = 0;

    const set = (selector: string, d: string) =>
      el.querySelectorAll<SVGPathElement>(selector).forEach((path) => path.setAttribute("d", d));

    const draw = (fill: number) => {
      if (!art) return;
      const base = artPaths(art, 0);
      const nudge = ease(clamp((fill - base.mainLength - base.armLength) / NUDGE_PX));
      const p = artPaths(art, nudge * 4 * art.u);
      set(".pt-a-drop", p.drop);
      set(".pt-a-bend", p.bend);
      set(".pt-a-shaft", p.shaft);
      set(".pt-a-head", p.head);
      const main = el.querySelector<SVGPathElement>(".pt-m-main") ?? undefined;
      const arms = el.querySelectorAll<SVGPathElement>(".pt-m-arm");
      main?.setAttribute("d", p.main);
      arms.forEach((arm, i) => arm.setAttribute("d", p.arms[i]));
      // Once the shaft is full it stays full while the head moves on.
      reveal(main, nudge > 0 ? BIG : fill);
      // The tip rides the line down, and goes once the line has turned into the arrow.
      const tip = el.querySelector<SVGCircleElement>(".pt-a-tip");
      if (tip && main) {
        const along = art.cy - art.r - SWELL * art.u;
        if (fill > 0 && fill < along) {
          tip.setAttribute("cx", String(art.x0));
          tip.setAttribute("cy", String(fill));
          tip.style.visibility = "visible";
        } else {
          tip.style.visibility = "hidden";
        }
      }
      arms.forEach((arm) => reveal(arm, fill - base.mainLength));
    };

    /* Sizes: where the arrow sits, and so how much scrolling the intro needs. On resize. */
    const measure = () => {
      const intro = el.querySelector(".pt-intro.is-lead")?.getBoundingClientRect();
      const slot = el.querySelector(".pt-intro.is-lead .pt-intro-slot")?.getBoundingClientRect();
      const track = el.querySelector(".pt-track")?.getBoundingClientRect();
      if (!pinned.matches || !lineMedia.matches || !intro || !slot || !track || slot.width === 0) {
        art = null;
        introPx = 0;
        el.classList.remove("has-line");
        el.style.removeProperty("--pt-intro");
        delete el.dataset.lineIn;
        delete el.dataset.lineOut;
        return;
      }
      const u = slot.width / 24;
      art = { x0: slot.left - intro.left + 5 * u, cy: slot.top - intro.top + 12 * u, u, w: LINE_W, r: 3.5 * u };
      const base = artPaths(art, 0);
      introPx = Math.max(0, base.mainLength + base.armLength - TIP * innerHeight) + NUDGE_PX + REST_PX;
      el.style.setProperty("--pt-intro", `${Math.round(introPx)}px`);
      el.style.setProperty("--pt-w", `${art.w.toFixed(2)}px`);
      el.classList.add("has-line");
      // Hand the page line over at the arrow's tail, in page pixels (the track's slide does
      // not matter: measured against the track, the intro is its first screen).
      const x = String(Math.round(el.getBoundingClientRect().left + intro.left - track.left + art.x0));
      if (el.dataset.lineIn !== x) el.dataset.lineIn = x;
      if (el.dataset.lineOut !== x) el.dataset.lineOut = x;
    };

    /*
     * Smooth motion (Ghulam, 2026-11-10: "absolutely smooth, good transitions"). The scroll
     * position only sets where the track should be (target); what is drawn follows it on a
     * critically damped spring, so every move starts gently, never overshoots, and a new target
     * mid-move carries the speed on instead of jolting. Each frame writes one transform in px
     * straight onto the track (no CSS variable on the outer, which made the whole track
     * restyle every frame), and moves the text screens' words a little slower than the track
     * for depth, fading them as they go.
     */
    const track = el.querySelector<HTMLElement>(".pt-track");
    const panelEls = Array.from(el.querySelectorAll<HTMLElement>(".pt-panel"));
    const intros = panelEls
      .map((panel, i) => ({ i, node: panel.querySelector<HTMLElement>(".pt-intro") }))
      .filter((p): p is { i: number; node: HTMLElement } => !!p.node);
    const OMEGA = 16; // spring speed: close behind the scroll, with the wheel's steps smoothed out
    let x = 0;
    let v = 0;
    let target = 0;
    let width = 0;
    let loop = 0;
    let last = 0;
    /*
     * The screen in view gets .is-here, a little before it settles; its words (and the
     * calendar's labels) play in then, and play again each time it comes back (Ghulam,
     * 2026-11-10: "on every screen the text should come with the animation").
     */
    let here = -1;
    const mark = () => {
      const near = Math.round(target);
      const rect = el.getBoundingClientRect();
      // The first screen counts as here once the track is most of the way up the page.
      const inView = rect.top < innerHeight * 0.35 && rect.bottom > innerHeight * 0.5;
      const next = inView && Math.abs(x - near) < 0.45 ? near : -1;
      if (next === here) return;
      here = next;
      panelEls.forEach((panel, i) => panel.classList.toggle("is-here", i === here));
    };
    const render = () => {
      if (!track) return;
      mark();
      track.style.transform = `translate3d(${(-x * width).toFixed(2)}px, 0, 0)`;
      for (const { i, node } of intros) {
        const d = i - x;
        if (Math.abs(d) > 1.05) continue;
        node.style.transform = `translate3d(${(d * width * 0.28).toFixed(2)}px, 0, 0)`;
        node.style.opacity = String(1 - Math.min(1, Math.abs(d)) * 0.85);
      }
    };
    const tick = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000 || 0.016);
      last = now;
      const a = -OMEGA * OMEGA * (x - target) - 2 * OMEGA * v;
      v += a * dt;
      x += v * dt;
      if (Math.abs(x - target) < 0.0004 && Math.abs(v) < 0.002) {
        x = target;
        v = 0;
        loop = 0;
        render();
        return;
      }
      render();
      loop = requestAnimationFrame(tick);
    };
    const follow = (to: number, jump = false) => {
      target = to;
      if (jump) {
        x = to;
        v = 0;
        render();
        return;
      }
      if (!loop && x !== target) {
        last = performance.now();
        loop = requestAnimationFrame(tick);
      }
    };
    const unpin = () => {
      cancelAnimationFrame(loop);
      loop = 0;
      x = v = target = 0;
      track?.style.removeProperty("transform");
      // Clears .is-here only if the pin set it. Below the pin the phone flow (FLOW_MEDIA)
      // owns .is-here, and this runs on every scroll there, so clearing it unconditionally
      // wiped every heading the moment it typed in.
      if (here !== -1) panelEls.forEach((panel) => panel.classList.remove("is-here"));
      here = -1;
      for (const { node } of intros) {
        node.style.removeProperty("transform");
        node.style.removeProperty("opacity");
      }
    };

    const update = () => {
      frame = 0;
      if (!pinned.matches) {
        unpin();
        return;
      }
      const rect = el.getBoundingClientRect();
      // The line's tip is TIP down the screen; the drawing is filled down to it, so the line
      // carries straight on from the page into the arrow at the speed of the scroll.
      draw(TIP * innerHeight - rect.top);

      const scrolled = -rect.top - introPx;
      const room = rect.height - innerHeight - introPx;
      const p = room > 0 ? clamp(scrolled / room) : 0;
      const t = p * steps;
      const k = Math.min(steps - 1, Math.floor(t));
      const u = t - k;
      const move = clamp((u - HOLD / 2) / (1 - HOLD));
      // Far from the track (just loaded mid-page, or a jump link): no spring, just be there.
      follow(k + glide(move), Math.abs(rect.top) > rect.height);
      mark(); // the first screen comes into view by the page scrolling, not by the track moving
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onResize = () => {
      measure();
      width = el.querySelector<HTMLElement>(".pt-pin")?.clientWidth ?? innerWidth;
      render();
      onScroll();
    };

    /*
     * No wheel or key handling here, on purpose (Ghulam, 2026-11-10: "I have to wait for a
     * screen to finish… it should be very smooth, like the other parts"). This track used to
     * take the wheel and move one whole screen per gesture, swallowing every other scroll
     * until that move was done, which is exactly the waiting. Now the page scrolls as it does
     * everywhere else and the screens simply follow it.
     */
    measure();
    width = el.querySelector<HTMLElement>(".pt-pin")?.clientWidth ?? innerWidth;
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    pinned.addEventListener("change", onResize);
    lineMedia.addEventListener("change", onResize);
    document.fonts?.ready.then(onResize);
    return () => {
      cancelAnimationFrame(loop);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      pinned.removeEventListener("change", onResize);
      lineMedia.removeEventListener("change", onResize);
      cancelAnimationFrame(frame);
    };
  }, [steps]);

  return (
    <div ref={outer} className="pt-outer" style={{ "--pt-n": panels.length } as CSSProperties}>
      {/* Phones only (product-track.css): where you are on the track, pinned at the top. */}
      <div className="pt-rail" style={{ "--pt-stops": stops.length } as CSSProperties}>
        <nav className="pt-rail-pill" aria-label="On this part of the page">
          <span className="pt-rail-thumb" aria-hidden />
          {stops.map((stop, i) => (
            <button key={stop} type="button" className="pt-rail-item" onClick={() => jump(i)}>
              {stop}
            </button>
          ))}
        </nav>
      </div>
      <div className="pt-pin">
        <div className="pt-track">
          {panels.map((panel, i) => (
            <div key={i} className="pt-panel">
              {panel}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
