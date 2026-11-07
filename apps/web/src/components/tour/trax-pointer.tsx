"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { TraxMark } from "@/components/shared/trax-mark";
import { TOUR, type TourPoint } from "./tour-script";
import "./trax-pointer.css";

/*
 * Trax inside the page, guiding (Ghulam, 2026-11-07): below the hero the corner belongs to
 * "Start free trial", and Trax comes up in the section you've landed on instead. It rises out
 * of the page line's dot for that part, flies to the screen, opens a note pointing at the
 * exact spot it's talking about (a ring marks it), and when you move on it glides to the next
 * part. Past the section it bows out. Only stops with a `point` (tour-script.ts) do this.
 *
 * Everything sits in a layer in page pixels, so it scrolls with the page natively and never
 * lags it; only the moves between parts are animated. Positions come from layout (offsets),
 * not from what's on screen, because the rows build in with a slide and Trax must point at
 * where things will rest. With reduced motion Trax doesn't travel or type; it appears.
 */

type Box = { left: number; top: number; width: number; height: number };
type Side = TourPoint["side"];
type Place = {
  id: string;
  text: string;
  row: Box;
  target: Box;
  ring: "text" | "area";
  /** The card's top-left, and where its pointer meets its edge. */
  card: { x: number; y: number; caret: number; side: Side };
  /** The line's dot for this part: where Trax comes up from. */
  from: { x: number; y: number } | null;
  /** For a word under a browser tab: where the line can drop between the tab and the "+". */
  lane?: number;
};

/* Leaving the hero: the same point at which the corner turns into "Start free trial". */
export const HERO_EXIT = 80;
const CARD_W = 300;
/* Where the orb sits inside the card (padding + half the 48px mark). */
const ORB = 36;
const GAP = 16;
/* How far the ring stands off what it marks. */
const RING_PAD = 5;

function layoutBox(el: HTMLElement): Box {
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight };
}

function measure(): Place[] {
  const width = document.documentElement.clientWidth;
  const cardW = Math.min(CARD_W, width - 32);
  const places: Place[] = [];
  for (const stop of TOUR) {
    const point = stop.point;
    const rowEl = point ? document.querySelector<HTMLElement>(stop.target) : null;
    if (!point || !rowEl || rowEl.offsetHeight === 0) continue;

    let target: Box;
    let ring: Place["ring"];
    if ("selector" in point.at) {
      const el = rowEl.querySelector<HTMLElement>(point.at.selector);
      if (!el) continue;
      target = layoutBox(el);
      ring = "text";
    } else {
      const screen = rowEl.querySelector<HTMLElement>(point.at.screen);
      if (!screen) continue;
      const box = layoutBox(screen);
      const { x, y, w, h } = point.at;
      target = { left: box.left + box.width * x, top: box.top + box.height * y, width: box.width * w, height: box.height * h };
      ring = "area";
    }

    const cx = target.left + target.width / 2;
    const cy = target.top + target.height / 2;
    const fitX = (x: number) => Math.min(Math.max(x, 16), width - 16 - cardW);
    const deviceEl = rowEl.querySelector<HTMLElement>(".pg-device");
    if (point.side === "above" && deviceEl) {
      // A label outside the picture: its bottom sits just above the device, over the target.
      const device = layoutBox(deviceEl);
      const x = fitX(cx - 64);
      const rows = rowEl.parentElement ? [...rowEl.parentElement.children] : [];
      const dot = rowEl.closest("section")?.querySelectorAll(".pg-thread circle.pg-thread-stop")[rows.indexOf(rowEl)];
      const dotBox = dot?.getBoundingClientRect();
      const from = dotBox && dotBox.width ? { x: dotBox.left + dotBox.width / 2, y: dotBox.top + scrollY + dotBox.height / 2 } : null;
      places.push({
        id: stop.id,
        text: point.text,
        row: layoutBox(rowEl),
        target,
        ring,
        card: { x, y: device.top - 28, caret: Math.min(Math.max(cx - x, 22), cardW - 22), side: "above" },
        from,
        lane: (() => {
          const tab = rowEl.querySelector<HTMLElement>(".pg-tab");
          const plus = rowEl.querySelector<HTMLElement>(".pg-newtab");
          if (!tab || !plus || ring !== "text") return undefined;
          const a = layoutBox(tab);
          const b = plus.getBoundingClientRect();
          return (a.left + a.width + (b.left + scrollX - (tab.getBoundingClientRect().left + scrollX - a.left))) / 2;
        })(),
      });
      continue;
    }
    // The side asked for, unless the screen's edge leaves no room for it.
    let side: Side = point.side;
    if (side === "right" && target.left + target.width + GAP + cardW > width - 16) side = "below";
    if (side === "left" && target.left - GAP - cardW < 16) side = "below";
    let card: Place["card"];
    if (side === "below") {
      const x = fitX(cx - 44);
      card = { x, y: target.top + target.height + GAP, caret: Math.min(Math.max(cx - x, 22), cardW - 22), side };
    } else if (side === "right") {
      card = { x: target.left + target.width + GAP, y: cy - ORB, caret: ORB, side };
    } else {
      card = { x: target.left - GAP - cardW, y: cy - ORB, caret: ORB, side };
    }

    // The row's dot on the features thread, drawn in row order.
    const rows = rowEl.parentElement ? [...rowEl.parentElement.children] : [];
    const dot = rowEl.closest("section")?.querySelectorAll(".pg-thread circle.pg-thread-stop")[rows.indexOf(rowEl)];
    const dotBox = dot?.getBoundingClientRect();
    const from = dotBox && dotBox.width ? { x: dotBox.left + dotBox.width / 2, y: dotBox.top + scrollY + dotBox.height / 2 } : null;

    places.push({ id: stop.id, text: point.text, row: layoutBox(rowEl), target, ring, card, from });
  }
  return places;
}

/* The part on screen: the last one whose middle is above 60% of the screen, until the section is behind you. */
function onScreen(places: Place[]): string | null {
  if (scrollY < HERO_EXIT || !places.length) return null;
  const line = scrollY + innerHeight * 0.6;
  let id: string | null = null;
  for (const place of places) if (place.row.top + place.row.height / 2 <= line) id = place.id;
  const last = places[places.length - 1];
  if (id === last.id && line > last.row.top + last.row.height + innerHeight * 0.25) return null;
  return id;
}

export function TraxPointer({ muted, onStop }: { muted: boolean; onStop: () => void }) {
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [cardW, setCardW] = useState(CARD_W);
  const [active, setActive] = useState<string | null>(null);
  const [here, setHere] = useState(false);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [said, setSaid] = useState<Place | null>(null);
  const [reduced, setReduced] = useState(false);
  const told = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const shownAt = useRef<string | null>(null);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clearLater = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  // Where everything goes, measured again whenever the page changes size.
  useEffect(() => {
    setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches);
    let timer = 0;
    const run = () => {
      const box = layer.current?.getBoundingClientRect();
      if (box) setOrigin({ x: box.left, y: box.top + scrollY });
      setCardW(Math.min(CARD_W, document.documentElement.clientWidth - 32));
      setPlaces(measure());
    };
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 160);
    };
    soon();
    document.fonts?.ready.then(soon);
    addEventListener("resize", soon);
    addEventListener("load", soon);
    const sizes = new ResizeObserver(soon);
    const main = document.getElementById("main");
    if (main) sizes.observe(main);
    document.querySelectorAll("#features .pg-row").forEach((row) => sizes.observe(row));
    return () => {
      window.clearTimeout(timer);
      removeEventListener("resize", soon);
      removeEventListener("load", soon);
      sizes.disconnect();
    };
  }, []);

  // Which part is on screen.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      setActive(muted ? null : onScreen(places));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [places, muted]);

  // Go there: come up out of the line, or glide over from the last part, then speak.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    clearLater();
    const place = places.find((p) => p.id === active) ?? null;
    if (!place) {
      shownAt.current = null;
      setOpen(false);
      setTyping(false);
      later(() => setHere(false), 0);
      return;
    }
    const to = { x: place.card.x - origin.x, y: place.card.y - origin.y };
    const moving = shownAt.current !== null && shownAt.current !== place.id;
    const arriving = shownAt.current === null;
    const same = shownAt.current === place.id;
    shownAt.current = place.id;

    if (same) {
      // A re-measure of the same part: just follow it.
      el.style.transform = `translate(${to.x}px, ${to.y}px)`;
      setSaid(place);
      return;
    }

    setOpen(false);
    setTyping(false);
    const start = (travel: number) => {
      el.style.setProperty("--tp-move", `${travel}ms`);
      el.style.transform = `translate(${to.x}px, ${to.y}px)`;
      later(() => {
        setSaid(place);
        setOpen(true);
        if (reduced || told.current.has(place.id)) {
          told.current.add(place.id);
          return;
        }
        setTyping(true);
        later(() => {
          setTyping(false);
          told.current.add(place.id);
        }, 600);
      }, travel);
    };

    if (reduced) {
      el.style.setProperty("--tp-move", "0ms");
      el.style.transform = `translate(${to.x}px, ${to.y}px)`;
      setHere(true);
      start(0);
      return;
    }
    if (arriving) {
      // Out of the line's dot, small, then up to the screen.
      const from = place.from ?? { x: place.card.x + ORB, y: place.card.y + ORB + 24 };
      el.style.setProperty("--tp-move", "0ms");
      el.style.transform = `translate(${from.x - ORB - origin.x}px, ${from.y - ORB - origin.y}px) scale(0.45)`;
      el.getBoundingClientRect();
      setHere(true);
      later(() => start(620), 30);
      return;
    }
    if (moving) {
      // Close the note, then glide; longer trips take a little longer.
      const prev = el.getBoundingClientRect();
      const distance = Math.hypot(to.x - (prev.left + scrollX - origin.x), to.y - (prev.top + scrollY - origin.y));
      later(() => start(Math.round(Math.min(900, 480 + distance * 0.25))), 160);
    }
  }, [active, places, origin, reduced, later, clearLater]);

  useEffect(() => clearLater, [clearLater]);

  const side = said?.card.side ?? "below";
  return (
    <div ref={layer} className="tp-layer" data-tour-layer>
      {said && said.card.side === "above" && (() => {
        // Down from the label, then, for a word, along the empty bar to it, so the line never
        // crosses the tab above it; for a part of a screen, straight down to its ring.
        const t = said.target;
        const word = said.ring === "text";
        const x = word ? said.lane ?? t.left + t.width + 48 : t.left + t.width * 0.85;
        const end = word ? t.top + t.height / 2 : t.top - RING_PAD;
        return (
          <>
            <span
              className={`tp-lead${open ? " is-on" : ""}`}
              style={{ left: x - origin.x - 1, top: said.card.y - origin.y, height: Math.max(0, end - said.card.y) }}
              aria-hidden
            />
            {word && (
              <span
                className={`tp-lead is-across${open ? " is-on" : ""}`}
                style={{ left: t.left + t.width + RING_PAD - origin.x, top: end - origin.y - 1, width: x - (t.left + t.width + RING_PAD) + 1 }}
                aria-hidden
              />
            )}
          </>
        );
      })()}
      {said && (
        <span
          className={`tp-ring is-${said.ring}${open ? " is-on" : ""}`}
          style={{
            left: said.target.left - origin.x - RING_PAD,
            top: said.target.top - origin.y - RING_PAD,
            width: said.target.width + RING_PAD * 2,
            height: said.target.height + RING_PAD * 2,
          }}
          aria-hidden
        />
      )}
      <div
        ref={card}
        className={`tp-card is-${side}${here ? " is-here" : ""}${open ? " is-open" : ""}`}
        style={{ ["--tp-caret" as string]: `${said?.card.caret ?? ORB}px`, ["--tp-w" as string]: `${cardW}px` }}
        role="note"
        aria-hidden={!open || undefined}
      >
        <div className="tp-box">
        <i className="tp-caret" aria-hidden />
        <span className="tp-orb">
          <TraxMark size="md" animated={!reduced} />
        </span>
        <span className="tp-body">
          <b className="tp-name">Trax</b>
          {typing ? (
            <span className="tp-typing" aria-label="Trax is typing">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span key={said?.id} className="tp-text">
              {reduced || !said
                ? said?.text
                : said.text.split(" ").map((word, i) => (
                    <span key={i} className="tp-word" style={{ animationDelay: `${i * 26}ms` }}>
                      {word}{" "}
                    </span>
                  ))}
            </span>
          )}
        </span>
        <button type="button" className="tp-close" aria-label="Stop the tour" tabIndex={open ? 0 : -1} onClick={onStop}>
          <X strokeWidth={2} aria-hidden />
        </button>
        </div>
      </div>
    </div>
  );
}
