"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { LINE_MEDIA } from "./launch-section";
import { Accent } from "./section-heading";
import "./portal-glass.css";
import "./demo-intro.css";

/*
 * The screen before the demo (Ghulam, 2026-11-10): big words that say the next screen is
 * yours to play with, and the page line turning into an arrow one more time, this time
 * pointing down at the demo (the first arrow, on the product track, points right).
 *
 * This section draws its own part of the line and tells the page line where it comes in and
 * goes out (data-line-in / data-line-out, see components/tour/tour-layout.ts). It comes in
 * wherever the section above left it, swings over to the arrow's lane beside the words, and
 * runs straight down into the arrowhead. The scroll draws it, with the tip at 70% of the
 * screen as everywhere else. Where the page has no line (phones, short screens), a plain
 * arrow stands under the words instead.
 */

/** The tip sits this far down the screen (components/tour/tour-layout.ts TIP_AT). */
const TIP = 0.7;

/** The arrow's lane, in page px: your-site.tsx starts its own part of the line from here. */
export const demoArrowX = () => Math.round(document.documentElement.clientWidth * 0.74);

type Art = { w: number; h: number; main: string; arms: [string, string]; mainLength: number; armLength: number };

const BIG = 100000;
function reveal(path: SVGPathElement | null, length: number) {
  if (!path) return;
  path.style.strokeDasharray = `${BIG} ${BIG}`;
  path.style.strokeDashoffset = String(BIG - Math.max(0, length));
  // A zero-length dash still paints its round cap as a dot: hide the path until it starts.
  path.style.visibility = length > 0 ? "visible" : "hidden";
}

/**
 * Big words on the left, and the page line turning into an arrow that points down at what
 * comes next. Used before the demo and before the numbers (Ghulam, 2026-11-10).
 */
export function ArrowIntro({ id, headingId, title, sub }: { id: string; headingId: string; title: ReactNode; sub: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const mainRef = useRef<SVGPathElement>(null);
  const armRefs = useRef<(SVGPathElement | null)[]>([]);
  const tipRef = useRef<SVGCircleElement>(null);
  const [art, setArt] = useState<Art | null>(null);

  // Where the line runs, measured from the section as it is.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const media = matchMedia(LINE_MEDIA);

    const measure = () => {
      if (!media.matches) {
        setArt(null);
        delete el.dataset.lineIn;
        delete el.dataset.lineOut;
        return;
      }
      const box = el.getBoundingClientRect();
      const w = box.width;
      const h = el.offsetHeight;
      const x = demoArrowX() - box.left;
      // The section above says where it let the line go; with none, the line comes in on the arrow's lane.
      const before = el.previousElementSibling instanceof HTMLElement ? Number(el.previousElementSibling.dataset.lineOut) : NaN;
      const inX = Number.isFinite(before) && before > 0 ? before - box.left : x;
      // Proportions are lucide's ArrowDown, as the first arrow's are ArrowRight's: 15vw for 24 units.
      const u = Math.min(w * 0.15, h * 0.3) / 24;
      const arm = 7 * u;
      const headY = h - Math.max(56, h * 0.09);
      // Over to the arrow's lane in the open space above the words, then straight down.
      const swing = Math.min(h * 0.22, 220);
      const main = Math.abs(inX - x) < 2 ? `M${x} 0V${headY}` : `M${inX} 0C${inX} ${swing * 0.6} ${x} ${swing * 0.4} ${x} ${swing}V${headY}`;
      el.dataset.lineIn = String(Math.round(box.left + inX));
      el.dataset.lineOut = String(Math.round(box.left + x));
      setArt({
        w,
        h,
        main,
        arms: [`M${x} ${headY}L${x - arm} ${headY - arm}`, `M${x} ${headY}L${x + arm} ${headY - arm}`],
        mainLength: 0, // read from the path once it is drawn
        armLength: arm * Math.SQRT2,
      });
    };

    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    // The section above sets its end of the line after it has measured itself.
    const marks = new MutationObserver(measure);
    if (el.previousElementSibling) marks.observe(el.previousElementSibling, { attributes: true, attributeFilter: ["data-line-out"] });
    addEventListener("resize", measure);
    media.addEventListener("change", measure);
    return () => {
      sizes.disconnect();
      marks.disconnect();
      removeEventListener("resize", measure);
      media.removeEventListener("change", measure);
    };
  }, []);

  // The scroll draws it: down the line, then out along both arms of the head.
  useEffect(() => {
    const el = root.current;
    const main = mainRef.current;
    if (!el || !main || !art) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = main.getTotalLength();

    let frame = 0;
    const paint = () => {
      frame = 0;
      const tip = tipRef.current;
      // How far down the section the tip is; the line is a little longer than that where it swings.
      const y = still ? BIG : innerHeight * TIP - el.getBoundingClientRect().top;
      const headY = art.h - Math.max(56, art.h * 0.09);
      const drawn = y <= 0 ? 0 : y >= headY ? total : lengthAtY(main, total, y);
      reveal(main, drawn);
      armRefs.current.forEach((arm) => reveal(arm, y - headY));
      if (!tip) return;
      if (still || y <= 0 || y >= headY) {
        tip.style.visibility = "hidden";
      } else {
        const at = main.getPointAtLength(drawn);
        tip.setAttribute("cx", String(at.x));
        tip.setAttribute("cy", String(at.y));
        tip.style.visibility = "visible";
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
  }, [art]);

  return (
    <section ref={root} id={id} aria-labelledby={headingId} className={`di${art ? " has-line" : ""}`}>
      {art && (
        <svg className="di-art" width={art.w} height={art.h} viewBox={`0 0 ${art.w} ${art.h}`} fill="none" aria-hidden focusable="false">
          {/* The line still to come: the page line's own dotted look. */}
          <path className="pg-thread-rest" d={art.main} />
          <path className="pg-thread-rest" d={art.arms[0]} />
          <path className="pg-thread-rest" d={art.arms[1]} />
          <path ref={mainRef} className="di-live" d={art.main} />
          {art.arms.map((d, i) => (
            <path
              key={i}
              ref={(node) => {
                armRefs.current[i] = node;
              }}
              className="di-live"
              d={d}
            />
          ))}
          <circle ref={tipRef} className="pg-thread-tip" r="5" style={{ visibility: "hidden" }} />
        </svg>
      )}

      <div className="di-words">
        <h2 id={headingId} className="di-title">
          {title}
        </h2>
        <p className="di-sub">{sub}</p>
        <ArrowDown className="di-arrow" strokeWidth={1.5} aria-hidden />
      </div>
    </section>
  );
}

export function DemoIntro() {
  return (
    <ArrowIntro
      id="demo-intro"
      headingId="demo-intro-heading"
      title={
        <>
          Now try it yourself. <Accent>It&apos;s&nbsp;your&nbsp;site.</Accent>
        </>
      }
      sub={
        <>
          <span className="di-sub-long">
            The next screen is a working demo. Type your company&apos;s name, pick a colour and a template, then book a car the way your renter would and watch it land
            in your portal.
          </span>
          {/* Phones: the same promise in two lines (user, 2026-11-12). */}
          <span className="di-sub-short">Brand a working demo, then book a car and watch it land in your portal.</span>
        </>
      }
    />
  );
}

/** The length along the path at which it reaches this height (the path only ever runs downwards). */
function lengthAtY(path: SVGPathElement, total: number, y: number): number {
  let lo = 0;
  let hi = total;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (path.getPointAtLength(mid).y < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
