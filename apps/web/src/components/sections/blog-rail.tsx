"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import "./blog-rail.css";

/*
 * The blog's three posters. On a tablet or desktop this is the plain grid it always was
 * (`.ct-grid`, untouched). On a phone, three full-width posters stacked one under the other
 * were three screens of scrolling for one idea, so there they become a rail you swipe:
 *
 *   - one poster fills most of the screen and the next one peeks in from the right, so it
 *     is obvious there is more and which way it is;
 *   - each snaps into place, the one in the middle is full size and the others sit back a
 *     little, so the rail reads as a row of things to flip through;
 *   - the posters slide in from the right, one after the other, as the section comes up the
 *     screen: the vertical scroll turns into a sideways movement, the same idea the page
 *     uses elsewhere, without ever taking the scroll away from the thumb;
 *   - dots under it say where you are and take you to a poster with a tap.
 *
 * All of that is CSS behind `max-width: 639.98px` plus a little measuring here; above it the
 * markup is the same grid as before.
 */
export function BlogRail({ children, label }: { children: ReactNode; label: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = Children.count(children);

  // Which poster is in the middle, and how far each one is from it (for the sit-back).
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // From layout, not from the screen, so the posters' own sit-back and slide-in never feed back into it.
      const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
      const max = el.scrollWidth - el.clientWidth;
      let best = 0;
      let bestD = Infinity;
      Array.from(el.children).forEach((child, i) => {
        const card = child as HTMLElement;
        // Where the rail would sit with this poster snapped into place, against where it is.
        const home = Math.min(max, Math.max(0, card.offsetLeft - pad));
        const d = (home - el.scrollLeft) / Math.max(1, card.offsetWidth);
        card.style.setProperty("--off", String(Math.round(Math.max(-1, Math.min(1, d)) * 1000) / 1000));
        if (Math.abs(d) < bestD) {
          bestD = Math.abs(d);
          best = i;
        }
      });
      // At the very end of the rail the last poster cannot reach the middle: count it as reached.
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) best = count - 1;
      setActive(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, [count]);

  // The posters slide in as the rail comes up the screen, once.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    // Classes set here, not through state, so React's render never undoes them.
    const reached = () => {
      const box = el.getBoundingClientRect();
      // Up to 82% of the way down the screen, or already scrolled past.
      return box.top < innerHeight * 0.82;
    };
    // Already there (a reload part-way down): show them, no entrance.
    if (reached()) {
      el.classList.add("is-in");
      return;
    }
    el.classList.add("is-armed");
    let frame = 0;
    const check = () => {
      frame = 0;
      if (!reached()) return;
      el.classList.add("is-in");
      stop();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return stop;
  }, []);

  const go = (i: number) => {
    const el = rail.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: card.offsetLeft - parseFloat(getComputedStyle(el).scrollPaddingLeft || "0"), behavior: still ? "auto" : "smooth" });
  };

  return (
    <>
      <div ref={rail} className="ct-grid br-rail" aria-label={label} role="group">
        {children}
      </div>
      {count > 1 && (
        <div className="br-dots" aria-label="Choose a post">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              className={i === active ? "is-on" : undefined}
              aria-label={`Post ${i + 1} of ${count}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </>
  );
}
