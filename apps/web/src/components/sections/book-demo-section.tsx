"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { Dancing_Script } from "next/font/google";
import { ArrowRight } from "lucide-react";

import { LINE_MEDIA } from "./launch-section";
import "./portal-glass.css";
import "./book-demo-section.css";

/*
 * Book a demo: the page's soft close after pricing, for the visitor who is not sure yet.
 * One purple card with three things in it (Ghulam, 2026-11-10): Bryan's picture, a line in
 * his own hand, and the button, all in white. Bryan Diaz is our customer success manager,
 * the person a new operator actually talks to.
 *
 * THE PAGE LINE WRITES THE QUOTE. This section draws its own part of the line and tells the
 * page line where it comes in and goes out (data-line-in / data-line-out, see
 * components/tour/tour-layout.ts). The line comes down beside the sentence, turns into its
 * first stroke, and from there the sentence IS the line: the line's tip as the pen with the
 * ink appearing behind it, and at the end of each row the line itself looping round under
 * the words to the start of the next. So it is one unbroken line from the top of the page,
 * through every word, and out of the last one. Inside the card the line is white.
 *
 * It is the line's arrival that starts the writing, not the amount scrolled, and it writes
 * quickly at a hand's own pace, so it reads as writing however the page is being moved.
 * Scrolling back above the first word takes the sentence back. Where the visitor asked for
 * less motion, the quote is simply there.
 *
 * PHONES AND SMALL SCREENS (no page line, see LINE_MEDIA): the same pen, on its own. When
 * the card is well up the screen the pen writes the sentence line by line, looping round
 * under each line to the next exactly as on desktop, then lifts: the loops fade and the
 * words stay. It writes once; it only writes again after the card has left by the bottom
 * of the screen (scrolled back up past it), so reading never fights it.
 *
 * (A plain bold version with the picture on the right was tried the same day and reverted:
 * "previous was better".)
 *
 * The button is a plain link to /strategy-call; the site-wide dialog catches it
 * (components/book-demo/book-demo-dialog.tsx).
 */

const script = Dancing_Script({ subsets: ["latin"], weight: ["600"], variable: "--font-dc-script", display: "swap" });

/*
 * PLACEHOLDER, NOT BRYAN (Ghulam, 2026-11-10: "any random person, free to use"). A
 * computer-generated face from thispersondoesnotexist.com: nobody real, so nobody's
 * likeness sits under Bryan's name. Replace it before this goes live: put his photo in
 * apps/web/public/team (square, at least 400px, face centred) and set its path here.
 */
const PHOTO = "/team/bryan.jpg";

const QUOTE = "“Not sure yet? Give me twenty minutes. I’ll walk you through it myself, and there’s no pressure to sign.”";
const WORDS = QUOTE.split(" ");

/** Where the phone page line runs (components/tour/phone-line.tsx PHONE). */
const PHONE_LINE = "(max-width: 767.98px)";

/** The tip sits this far down the screen (components/tour/tour-layout.ts TIP_AT). */
const TIP = 0.7;
const BIG = 100000;
/** How fast the pen writes, in px of text a second. */
const PEN_SPEED = 1900;
/** How long the line takes to run from the end of one written line round to the start of the next. */
const JOIN_MS = 300;
/** How wide the line's turn into the first stroke is. */
const TURN = 26;
/** Phones: a little slower than desktop, so a short line still reads as being written. */
const PEN_SPEED_SOLO = 1150;
/** Phones: the pen starts once the card's top is this far up the screen. */
const SOLO_START = 0.72;

type Row = { left: number; width: number; y: number };
type Art = {
  w: number;
  h: number;
  /** Down from the top of the section to the first word. */
  into: string;
  /** From the last word, down and out of the section. */
  out: string;
  /** The same line carried from the end of each written line round to the start of the next. */
  joins: string[];
  rows: Row[];
  /** No page line on this screen: the pen writes on its own when the card is in view. */
  solo: boolean;
  /** The heights (in the section) where the writing starts and where it is finished. */
  y0: number;
  y1: number;
};

function reveal(path: SVGPathElement | null, length: number) {
  if (!path) return;
  path.style.strokeDasharray = `${BIG} ${BIG}`;
  path.style.strokeDashoffset = String(BIG - Math.max(0, length));
  // A zero-length dash still paints its round cap as a dot: hide the path until it starts.
  path.style.visibility = length > 0 ? "visible" : "hidden";
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

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function BookDemoSection() {
  const root = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLParagraphElement>(null);
  const rowRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const whoRef = useRef<HTMLElement>(null);
  const intoRef = useRef<SVGPathElement>(null);
  const outRef = useRef<SVGPathElement>(null);
  const joinRefs = useRef<(SVGPathElement | null)[]>([]);
  const tipRef = useRef<SVGCircleElement>(null);
  /** The quote as the browser wrapped it, one string per line; null until measured. */
  const [lines, setLines] = useState<string[] | null>(null);
  const [art, setArt] = useState<Art | null>(null);

  // Find where the browser breaks the quote, so each line can be written on its own.
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const measure = () => {
      const next: string[] = [];
      let top = Number.NaN;
      for (const word of Array.from(el.children) as HTMLElement[]) {
        const text = (word.textContent ?? "").trim();
        if (word.offsetTop !== top) {
          top = word.offsetTop;
          next.push(text);
        } else {
          next[next.length - 1] += ` ${text}`;
        }
      }
      setLines((prev) => (prev && prev.join("\n") === next.join("\n") ? prev : next));
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    // The script font arrives after first paint and is narrower than its fallback.
    void document.fonts?.ready.then(measure);
    return () => sizes.disconnect();
  }, []);

  // Where the line runs, measured from the section as it is.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !lines) return;
    const media = matchMedia(LINE_MEDIA);
    // Phones have a page line of their own (components/tour/phone-line.tsx): there too it comes
    // in, writes the quote and leaves from its last word, as on desktop (Ghulam, 2026-11-14).
    const phoneLine = matchMedia(PHONE_LINE);

    const measure = () => {
      const rows = rowRefs.current.slice(0, lines.length);
      const solo = !media.matches && !phoneLine.matches;
      if (solo) {
        delete el.dataset.lineIn;
        delete el.dataset.lineOut;
      }
      if (rows.length === 0 || rows.some((row) => !row)) {
        setArt(null);
        return;
      }
      const box = el.getBoundingClientRect();
      const w = box.width;
      const h = el.offsetHeight;
      const measured: Row[] = rows.map((row) => {
        const r = row!.getBoundingClientRect();
        return { left: r.left - box.left, width: r.width, y: r.top - box.top + r.height * 0.56 };
      });
      const first = measured[0];
      const last = measured[measured.length - 1];
      // Each line's box is padded for the script's long strokes; the words start and stop this far inside it.
      const inset = (parseFloat(getComputedStyle(rows[0]!).paddingLeft) || 0) * 0.8;
      const startX = first.left + inset;
      const endX = last.left + last.width - inset;
      // The line comes down just left of the sentence and turns into its first stroke.
      // Phones: the lane the phone page line comes down (18px in), so it runs on straight into the quote.
      const laneX = phoneLine.matches ? Math.min(startX - 12, 18 - box.left) : startX - TURN;
      let outX = Math.min(w - 32, endX + 28);
      // Where the button is nearly as wide as the card (phones), the line goes down clear of its end.
      const btn = el.querySelector(".dc-btn")?.getBoundingClientRect();
      if (btn && outX > btn.left - box.left - 8 && outX < btn.right - box.left + 7) outX = Math.min(w - 12, btn.right - box.left + 7);
      // The section above says where it let the line go; with none, the line comes straight down beside the first word.
      const before = el.previousElementSibling instanceof HTMLElement ? Number(el.previousElementSibling.dataset.lineOut) : NaN;
      const inX = Number.isFinite(before) && before > 0 ? before - box.left : laneX;
      const swing = Math.min(first.y * 0.5, 180);
      const turn = `V${first.y - TURN}Q${laneX} ${first.y} ${startX} ${first.y}`;
      const into =
        Math.abs(inX - laneX) < 2 ? `M${laneX} 0${turn}` : `M${inX} 0C${inX} ${swing * 0.6} ${laneX} ${swing * 0.4} ${laneX} ${swing}${turn}`;
      /*
       * Between lines the pen does not lift: the line loops off the end of one line, runs
       * back under it and turns into the first stroke of the next, so the whole sentence is
       * one unbroken line.
       */
      const joins = measured.slice(0, -1).map((row, i) => {
        const next = measured[i + 1];
        const x0 = row.left + row.width - inset;
        const x1 = next.left + inset;
        const under = (row.y + next.y) / 2 + 4;
        return `M${x0} ${row.y}C${x0 + 34} ${row.y} ${x0 + 34} ${under} ${x0 - 6} ${under}L${x1 - 2} ${under}C${x1 - 36} ${under} ${x1 - 36} ${next.y} ${x1} ${next.y}`;
      });
      const out = `M${endX} ${last.y}C${endX + 30} ${last.y + 6} ${outX} ${last.y + 36} ${outX} ${last.y + 110}V${h}`;
      const who = whoRef.current?.getBoundingClientRect();
      // The line starts to leave as the tip reaches the foot of his name, with room left for it to go.
      const y1 = Math.min(h - 80, Math.max(last.y + 40, who ? who.bottom - box.top : last.y + 120));
      if (!solo) {
        // Unrounded: the page line picks up at exactly this x, and half a pixel shows as a break.
        el.dataset.lineIn = String(box.left + inX);
        el.dataset.lineOut = String(box.left + outX);
      }
      const next: Art = { w, h, into: solo ? "" : into, out: solo ? "" : out, joins, rows: measured, solo, y0: first.y, y1 };
      // A phone's address bar showing or hiding fires resize with nothing here changed: keep the art, and the pen where it is.
      setArt((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };

    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    const marks = new MutationObserver(measure);
    if (el.previousElementSibling) marks.observe(el.previousElementSibling, { attributes: true, attributeFilter: ["data-line-out"] });
    addEventListener("resize", measure);
    media.addEventListener("change", measure);
    phoneLine.addEventListener("change", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      sizes.disconnect();
      marks.disconnect();
      removeEventListener("resize", measure);
      media.removeEventListener("change", measure);
      phoneLine.removeEventListener("change", measure);
    };
  }, [lines]);

  // The line arrives, and writes.
  useEffect(() => {
    const el = root.current;
    const into = intoRef.current;
    const out = outRef.current;
    if (!el || !art || (!art.solo && (!into || !out))) return;
    const solo = art.solo;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const intoLength = into?.getTotalLength() ?? 0;
    const outLength = out?.getTotalLength() ?? 0;
    const speed = solo ? PEN_SPEED_SOLO : PEN_SPEED;
    const inkTotal = art.rows.reduce((sum, row) => sum + row.width, 0);
    const rows = rowRefs.current.slice(0, art.rows.length);
    const joinPaths = joinRefs.current.slice(0, art.joins.length);
    const joinLengths = joinPaths.map((path) => path?.getTotalLength() ?? 0);
    /** The ink down when each line is finished: where each join belongs. */
    const lineEnds = art.rows.map((_, i) => art.rows.slice(0, i + 1).reduce((sum, row) => sum + row.width, 0));

    let frame = 0;
    /** Where the line's tip is, as a height down the section; it eases after the scroll. */
    let shown = Number.NaN;
    /** How much of the sentence is written, in px of ink along its lines. Time moves this, not the scroll. */
    let ink = 0;
    /** The line is running from the end of one written line to the start of the next. */
    let joining: { index: number; from: number } | null = null;
    let last = 0;

    /** Which line the ink has reached, and how far along it. */
    const where = (amount: number) => {
      let before = 0;
      for (let i = 0; i < art.rows.length; i += 1) {
        const width = art.rows[i].width;
        if (amount < before + width || i === art.rows.length - 1) return { row: i, along: Math.min(width, amount - before) };
        before += width;
      }
      return { row: 0, along: 0 };
    };

    const paint = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;

      const top = el.getBoundingClientRect().top;
      const target = still ? BIG : innerHeight * TIP - top;
      // First paint lands where the scroll already is; after that the tip follows it.
      const first = Number.isNaN(shown);
      shown = first || still ? target : shown + (target - shown) * 0.16;
      if (Math.abs(target - shown) < 0.5) shown = target;
      const y = shown;

      if (into) reveal(into, y <= 0 ? 0 : y >= art.y0 ? intoLength : lengthAtY(into, intoLength, y));

      /*
       * The writing. The moment the line reaches the first word it writes the whole sentence
       * by itself, quickly, however fast or slowly the page is being scrolled; scroll back
       * above the first word and it is taken back. Arriving with the section already passed
       * (a reload, a jump link), the sentence is simply there.
       */
      let writing = y >= art.y0;
      if (solo) {
        // On its own the pen starts when the card is well up the screen, and once it has started
        // it finishes and stays; the sentence is only taken back when the card has gone off the bottom.
        const offBelow = top > innerHeight;
        writing = ink > 0 ? !offBelow : top < innerHeight * SOLO_START && el.getBoundingClientRect().bottom > 0;
        // Arriving with the card already scrolled past (a reload, a jump link): the sentence is simply there.
        if (first && top + art.h < innerHeight * 0.4) {
          ink = inkTotal;
        }
      }
      if (still || (!solo && first && writing)) {
        ink = writing ? inkTotal : 0;
      } else if (writing && ink < inkTotal) {
        if (joining && now - joining.from >= JOIN_MS) joining = null;
        if (!joining) {
          const at = where(ink);
          // A hand is never even: it runs on through a word and slows into the next stroke.
          const pace = speed * (0.78 + 0.3 * Math.sin(at.along / 46));
          const end = lineEnds[at.row];
          const next = Math.min(inkTotal, ink + pace * dt);
          // Finishing a line, the line runs round to the start of the next before it writes on.
          if (at.row < art.rows.length - 1 && ink < end && next >= end) {
            ink = end;
            joining = { index: at.row, from: now };
          } else {
            ink = next;
          }
        }
      } else if (!writing && ink > 0) {
        joining = null;
        // Taken back: at once on its own (it is off screen), quickly under the page line.
        ink = solo ? 0 : Math.max(0, ink - speed * 5 * dt);
      }

      // The joins: drawn as the line runs along them, whole once the next line is under way.
      let onJoin: { x: number; y: number } | null = null;
      joinPaths.forEach((path, i) => {
        if (!path) return;
        if (joining && joining.index === i) {
          const along = clamp((now - joining.from) / JOIN_MS) * joinLengths[i];
          reveal(path, along);
          onJoin = path.getPointAtLength(along);
        } else {
          reveal(path, ink >= lineEnds[i] && (ink > lineEnds[i] || still || ink >= inkTotal) ? joinLengths[i] : 0);
        }
      });

      let before = 0;
      let pen: { x: number; y: number } | null = null;
      art.rows.forEach((row, i) => {
        const node = rows[i];
        const down = clamp(ink - before, 0, row.width);
        before += row.width;
        if (!node) return;
        const done = down >= row.width;
        node.classList.toggle("is-inked", done);
        node.style.visibility = down > 0 ? "visible" : "hidden";
        // The soft edge runs a little past the box at both ends, so the first and last strokes are whole.
        node.style.setProperty("--ink", `${(down / row.width) * (row.width + 24) - 4}px`);
        // The pen follows the letters, up and over each one, not a ruled line.
        if (down > 0 && !done && !pen) {
          pen = { x: row.left + down + Math.sin(down / 5) * 1.5, y: row.y + Math.sin(down / 8.5) * 6 + Math.sin(down / 31) * 3 };
        }
      });
      const written = ink >= inkTotal;
      // On its own the pen lifts when it is done, and the loops between the lines fade.
      if (solo) el.classList.toggle("is-written", written && !still);

      // The line leaves only once the sentence is down.
      const leaving = written ? clamp((y - art.y1) / (art.h - art.y1)) : 0;
      if (out) reveal(out, leaving * outLength);

      const tip = tipRef.current;
      if (tip) {
        let at: { x: number; y: number } | null = null;
        if (solo) {
          if (!still && ink > 0 && !written) at = onJoin ?? pen;
        } else if (!still && into && y > 0 && y < art.h) {
          if (ink <= 0) at = into.getPointAtLength(lengthAtY(into, intoLength, Math.min(y, art.y0)));
          else if (!written) at = onJoin ?? pen;
          else if (out) at = out.getPointAtLength(leaving * outLength);
        }
        if (at) {
          tip.setAttribute("cx", String(at.x));
          tip.setAttribute("cy", String(at.y));
          tip.style.visibility = "visible";
        } else {
          tip.style.visibility = "hidden";
        }
      }

      // Keep going while the tip is still catching the scroll up, or the pen is still moving.
      const moving = (!solo && shown !== target) || joining !== null || (writing ? !written : ink > 0);
      if (moving && !still) frame = requestAnimationFrame(paint);
      else last = 0;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint(performance.now());
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
      el.classList.remove("is-written");
      // Without the line the quote is simply there.
      rows.forEach((node) => {
        if (!node) return;
        node.classList.remove("is-inked");
        node.style.removeProperty("visibility");
        node.style.removeProperty("--ink");
      });
    };
  }, [art]);

  return (
    <section
      ref={root}
      id="book-a-demo"
      className={`dc ${script.variable}${art ? " has-line" : ""}${art?.solo ? " is-solo" : ""}`}
      aria-labelledby="dc-title"
    >
      <h2 id="dc-title" className="sr-only">
        Book a demo with Bryan
      </h2>

      {art && (
        <svg className="dc-art" width={art.w} height={art.h} viewBox={`0 0 ${art.w} ${art.h}`} fill="none" aria-hidden focusable="false">
          {/* The line still to come: the page line's own dotted look. Phones have no page line to come in on. */}
          {!art.solo && <path className="pg-thread-rest" d={art.into} />}
          {!art.solo && <path className="pg-thread-rest" d={art.out} />}
          {!art.solo && <path ref={intoRef} className="dc-live" d={art.into} />}
          {art.joins.map((d, i) => (
            <path
              key={i}
              ref={(node) => {
                joinRefs.current[i] = node;
              }}
              className="dc-live"
              d={d}
            />
          ))}
          {!art.solo && <path ref={outRef} className="dc-live" d={art.out} />}
          <circle ref={tipRef} className="pg-thread-tip" r="5" style={{ visibility: "hidden" }} />
        </svg>
      )}

      <figure className="dc-card">
        <div className="dc-photo">
          <Image src={PHOTO} alt="Bryan Diaz" width={480} height={480} />
        </div>

        <blockquote className="dc-quote">
          {/* Never seen: the quote set word by word, to read off where its lines break. */}
          <p ref={measureRef} className="dc-text dc-measure" aria-hidden>
            {WORDS.map((word, i) => (
              <span key={i}>{word} </span>
            ))}
          </p>
          <p className="dc-text">
            {lines
              ? lines.map((line, i) => (
                  <span
                    key={`${i}-${line}`}
                    ref={(node) => {
                      rowRefs.current[i] = node;
                    }}
                    className="dc-line"
                  >
                    {line}
                  </span>
                ))
              : QUOTE}
          </p>
        </blockquote>

        <figcaption ref={whoRef} className="dc-who">
          <b>Bryan Diaz</b>
          <span>Customer Success Manager</span>
        </figcaption>

        <a href="/strategy-call" className="dc-btn">
          Book a demo
          <ArrowRight strokeWidth={2} aria-hidden />
        </a>
      </figure>
    </section>
  );
}
