"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { MapOperator } from "@/lib/operator-map";
import { LINE_MEDIA } from "./launch-section";
import { inkMask } from "./operator-map-ink";
import "./operator-map.css";

/*
 * The operator wall: every rental company that has run on Drive247, as logos on
 * vertical marquees filling the whole section. Seven columns (fewer on smaller screens)
 * drift past each other, the odd ones up and the even ones down, each at its own pace.
 * The count itself lives in the numbers section (content/proof.ts).
 *
 * Logos are uploaded by operators in every style imaginable; operator-map-ink.ts turns
 * each into a single ink mark, so the wall reads as one black-and-white set. No usable
 * logo: the company's name, set as a wordmark.
 */

/** Columns by screen width: the first query that matches wins. */
const BREAKPOINTS: readonly [string, number][] = [
  ["(max-width: 560px)", 3],
  ["(max-width: 900px)", 4],
  ["(max-width: 1280px)", 6],
];
const COLUMNS = 7;
/** Seconds for one full loop of a column, by column. Uneven so they never line up. */
const PACE = [64, 78, 58, 84, 70, 90, 62];

/** Deal the operators round-robin, so the busiest companies spread across columns. */
function deal(operators: readonly MapOperator[], count: number): MapOperator[][] {
  const columns: MapOperator[][] = Array.from({ length: count }, () => []);
  operators.forEach((operator, index) => columns[index % count].push(operator));
  return columns;
}

export function OperatorMap({ initial }: { initial: MapOperator[] }) {
  const sectionRef = useRef<HTMLElement>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [count, setCount] = useState(COLUMNS);
  /** Ink version of each logo, by its URL. Missing while it is made; null if it can't be. */
  const [masks, setMasks] = useState<Record<string, string | null>>({});

  // Start making logos a little before the wall scrolls in.
  useEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const soon = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        soon.disconnect();
      },
      { rootMargin: "1000px 0px" },
    );
    soon.observe(el);
    return () => soon.disconnect();
  }, []);

  // Fewer, wider columns on smaller screens, still holding every operator.
  useEffect(() => {
    const queries = BREAKPOINTS.map(([media, columns]) => [window.matchMedia(media), columns] as const);
    const apply = () => setCount(queries.find(([query]) => query.matches)?.[1] ?? COLUMNS);
    apply();
    queries.forEach(([query]) => query.addEventListener("change", apply));
    return () => queries.forEach(([query]) => query.removeEventListener("change", apply));
  }, []);

  useEffect(() => {
    if (!near) return;
    let live = true;
    for (const operator of initial) {
      const logo = operator.logo;
      if (!logo) continue;
      void inkMask(logo).then((mask) => {
        if (!live) return;
        setMasks((current) => (current[logo] === mask ? current : { ...current, [logo]: mask }));
      });
    }
    return () => {
      live = false;
    };
  }, [near, initial]);

  const columns = useMemo(() => deal(initial, count), [initial, count]);

  // The page line runs down the gap nearest the middle (data-line-steps, one step, page px;
  // see components/tour/tour-layout.ts). Behind the tip, the logos either side of it turn the
  // line's colour: a glow that follows the tip down, blended so only the dark ink takes it.
  useEffect(() => {
    const section = sectionRef.current;
    const wall = wallRef.current;
    const glow = glowRef.current;
    if (!section || !wall || !glow) return;
    const media = matchMedia(LINE_MEDIA);
    let lane: number | null = null;
    let frame = 0;

    const paint = () => {
      frame = 0;
      if (lane === null || !media.matches) {
        glow.style.display = "none";
        return;
      }
      const box = section.getBoundingClientRect();
      const tip = innerHeight * 0.7;
      glow.style.display = "block";
      glow.style.left = `${lane - scrollX - box.left}px`;
      glow.style.height = `${Math.max(0, Math.min(box.height, tip - box.top))}px`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const measure = () => {
      const cols = wall.querySelectorAll<HTMLElement>(".om-col");
      if (cols.length < 2) {
        lane = null;
        delete section.dataset.lineSteps;
      } else {
        const right = Math.ceil(cols.length / 2);
        const a = cols[right - 1].getBoundingClientRect();
        const b = cols[right].getBoundingClientRect();
        lane = Math.round((a.right + b.left) / 2 + scrollX);
        const box = section.getBoundingClientRect();
        section.dataset.lineSteps = JSON.stringify([{ x: lane, y0: box.top + scrollY, y1: box.bottom + scrollY }]);
      }
      paint();
    };

    measure();
    const size = new ResizeObserver(measure);
    size.observe(wall);
    addEventListener("scroll", onScroll, { passive: true });
    media.addEventListener("change", measure);
    return () => {
      size.disconnect();
      removeEventListener("scroll", onScroll);
      media.removeEventListener("change", measure);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  return (
    <section ref={sectionRef} id="operators" className="om" aria-labelledby="om-title">
      <h2 id="om-title" className="sr-only">
        Rental companies on Drive247
      </h2>

      <div ref={wallRef} className="om-wall">
        <ul className="sr-only" aria-label="Operators on Drive247">
          {initial.map((operator) => (
            <li key={operator.slug}>{operator.name}</li>
          ))}
        </ul>
        {columns.map((column, index) => (
          <div
            key={index}
            className={`om-col${index % 2 ? " is-down" : ""}`}
            style={{ "--om-pace": `${PACE[index % PACE.length]}s` } as CSSProperties}
            aria-hidden
          >
            {/* Two copies back to back: the track moves by one copy and loops seamlessly. */}
            <div className="om-track">
              {[0, 1].map((copy) =>
                column.map((operator) => {
                  const mask = operator.logo ? masks[operator.logo] : null;
                  return (
                    <div key={`${copy}-${operator.slug}`} className="om-tile" title={operator.name}>
                      {mask ? (
                        <span className="om-logo" style={{ "--om-mask": `url("${mask}")` } as CSSProperties} />
                      ) : mask === null ? (
                        <span className="om-word">{operator.name}</span>
                      ) : null}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        ))}
      </div>
      <div ref={glowRef} className="om-glow" aria-hidden />
    </section>
  );
}
