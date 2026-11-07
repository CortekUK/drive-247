"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { MapOperator } from "@/lib/operator-map";
import { squarify, type Box } from "@/lib/treemap";
import { inkMask } from "./operator-map-ink";
import "./operator-map.css";

/*
 * The operator map: one screen, edge to edge (100% wide, 100vh tall), holding every
 * operator on Drive247. Each tile's area is that operator's share of the bookings, so
 * the tiles fill the screen exactly and a busier company has a bigger logo.
 *
 * It stays live. While the map is on screen it asks the server again every minute: a
 * new booking grows its operator's tile (the tiles re-flow, the grown ones flash once),
 * and a company that has just signed up takes its place without a reload.
 *
 * Logos are uploaded by operators in every style imaginable; operator-map-ink.ts turns
 * each into a single ink mark so the map reads as one set. No usable logo: the name.
 */

/** The heading tile's share of the screen. */
const HEAD_SHARE = 0.13;
/** The layout the server renders before the browser has measured the real screen. */
const NOMINAL: Box = { x: 0, y: 0, w: 1440, h: 900 };
const POLL_MS = 60_000;
const FLASH_MS = 1800;

type Tile = { key: string; weight: number; operator: MapOperator | null };

function layout(operators: readonly MapOperator[], box: Box) {
  const tiles: Tile[] = [
    { key: "__head", weight: HEAD_SHARE, operator: null },
    ...operators.map((operator) => ({ key: operator.slug, weight: operator.share * (1 - HEAD_SHARE), operator })),
  ];
  return squarify(tiles, box);
}

/** A tile's position as percentages of the map, for the CSS to place it. */
function at(rect: Box, box: Box): CSSProperties {
  return {
    "--x": `${(rect.x / box.w) * 100}%`,
    "--y": `${(rect.y / box.h) * 100}%`,
    "--w": `${(rect.w / box.w) * 100}%`,
    "--h": `${(rect.h / box.h) * 100}%`,
  } as CSSProperties;
}

export function OperatorMap({ initial }: { initial: MapOperator[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [operators, setOperators] = useState(initial);
  const [box, setBox] = useState<Box>(NOMINAL);
  const [measured, setMeasured] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [near, setNear] = useState(false);
  const [inView, setInView] = useState(false);
  /** Ink version of each logo, by its URL. Missing while it is made; null if it can't be. */
  const [masks, setMasks] = useState<Record<string, string | null>>({});
  const [flash, setFlash] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef(operators);

  useEffect(() => {
    latest.current = operators;
  }, [operators]);

  // The real size of the screen, and again whenever it changes.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setBox({ x: 0, y: 0, w: width, h: height });
        setMeasured(true);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Tiles move smoothly only after the first real layout, so arriving never animates.
  useEffect(() => {
    if (!measured || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [measured, animate]);

  // Start making logos a little before the map scrolls in; refresh only while it is in.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const soon = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        soon.disconnect();
      },
      { rootMargin: "1000px 0px" },
    );
    const visible = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    soon.observe(el);
    visible.observe(el);
    return () => {
      soon.disconnect();
      visible.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near) return;
    let live = true;
    for (const operator of operators) {
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
  }, [near, operators]);

  // Every minute while on screen: who is here now, and how big.
  useEffect(() => {
    if (!inView) return;
    let stopped = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/operator-map", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { operators?: MapOperator[] };
        const next = body.operators;
        if (stopped || !Array.isArray(next) || next.length === 0) return;
        const before = new Map(latest.current.map((operator) => [operator.slug, operator.share]));
        const grown = next
          .filter((operator) => !before.has(operator.slug) || operator.share > (before.get(operator.slug) ?? 0) + 0.0001)
          .map((operator) => operator.slug);
        setOperators(next);
        if (grown.length) setFlash(new Set(grown));
      } catch {
        // A missed refresh changes nothing; the next one will try again.
      }
    };
    const timer = window.setInterval(refresh, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [inView]);

  useEffect(() => {
    if (!flash.size) return;
    const timer = window.setTimeout(() => setFlash(new Set()), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const tiles = useMemo(() => layout(operators, box), [operators, box]);
  const head = tiles.find((tile) => tile.operator === null);

  return (
    <section id="operators" className="om" aria-labelledby="om-title">
      <div ref={mapRef} className={`om-map${animate ? " is-live" : ""}`}>
        {head && (
          <div className="om-cell om-head" style={at(head.rect, box)}>
            <h2 id="om-title" className="om-title">
              {operators.length} operators run on Drive247
            </h2>
            <p className="om-sub">
              Every logo is a rental company on Drive247, sized by the bookings it takes. A new booking grows its tile,
              and a new company gets one.
            </p>
          </div>
        )}
        <ul className="om-list" aria-label="Operators on Drive247">
          {tiles.map((tile) => {
            const operator = tile.operator;
            if (!operator) return null;
            const mask = operator.logo ? masks[operator.logo] : null;
            return (
              <li
                key={tile.key}
                className={`om-cell${flash.has(operator.slug) ? " is-grown" : ""}`}
                style={at(tile.rect, box)}
                title={operator.name}
              >
                {mask ? (
                  <span className="om-logo" style={{ "--om-mask": `url("${mask}")` } as CSSProperties} aria-hidden />
                ) : mask === null ? (
                  <span className="om-word" aria-hidden>
                    {operator.name}
                  </span>
                ) : null}
                <span className="sr-only">{operator.name}</span>
                <span className="om-name" aria-hidden>
                  {operator.name}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
