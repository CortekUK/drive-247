import type { ReactNode } from "react";

/*
 * One scene per plan on the pricing section, growing with the business: a car on the
 * driveway, a small lot, a depot, a headquarters. Drawn to the same standard as the Trax
 * section's (sections/trax-art.tsx): ink outlines, every tone an indigo, nothing floating.
 * The colours are CSS variables set by .pb (pricing-breakdown.css), so one drawing serves
 * both themes.
 */

const INK = "var(--ta-ink)";
const CARD = "var(--ta-card)";
const ACC = "var(--ta-acc)";
const DEEP = "var(--ta-deep)";
const PALE = "var(--ta-pale)";
const MID = "var(--ta-mid)";
const SOFT = "var(--ta-soft)";

const outline = { stroke: INK, strokeWidth: 1.8, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Art({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 76" fill="none" aria-hidden className="pb-art">
      <path d="M4 70h152" {...outline} />
      {children}
    </svg>
  );
}

function Bar({ x, y, w, fill = SOFT, h = 4 }: { x: number; y: number; w: number; fill?: string; h?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />;
}

/* The coupe in profile, 76 wide and 30 tall at s = 1, standing on y + 30s. */
function Car({ x, y, s = 1, fill = CARD }: { x: number; y: number; s?: number; fill?: string }) {
  const line = { ...outline, strokeWidth: 1.8 / s };
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M2 24v-5q0-4 6-5l10-2 9-8q2-2 6-2h14q4 0 7 3l8 8 8 2q4 1 4 5v4Z" fill={fill} {...line} />
      <path d="M24 12l6-6q1-1 3-1h13q2 0 4 2l5 5Z" fill={DEEP} />
      {[18, 58].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={24} r={6} fill={CARD} {...line} />
          <circle cx={cx} cy={24} r={1.8} fill={INK} />
        </g>
      ))}
    </g>
  );
}

/* A house, its garage, and the first car out front. */
export function DrivewayArt() {
  return (
    <Art>
      <rect x={12} y={36} width={64} height={34} fill={CARD} {...outline} />
      <path d="M6 37 44 12l38 25Z" fill={PALE} {...outline} />
      <rect x={24} y={46} width={40} height={24} rx={2} fill={SOFT} {...outline} />
      <path d="M24 52h40M24 58h40M24 64h40" {...outline} strokeWidth={1.2} />
      <Car x={82} y={40} />
    </Art>
  );
}

/* A car lot: a string of lights between two poles and a row of cars under it. */
export function LotArt() {
  const bulbs: [number, number][] = [
    [36.8, 23.8],
    [58.4, 26.2],
    [80, 27],
    [101.6, 26.2],
    [123.2, 23.8],
  ];
  return (
    <Art>
      <path d="M8 70V14M152 70V14" {...outline} />
      <path d="M8 18Q80 36 152 18" {...outline} strokeWidth={1.3} />
      {bulbs.map(([x, y], i) => (
        <circle key={x} cx={x} cy={y + 3} r={3.2} fill={i % 2 ? PALE : ACC} {...outline} strokeWidth={1.3} />
      ))}
      <Car x={14} y={53.2} s={0.56} />
      <Car x={60} y={53.2} s={0.56} fill={PALE} />
      <Car x={106} y={53.2} s={0.56} />
    </Art>
  );
}

/* A depot: three roller doors under one roof, a sign on top, a car waiting outside. */
export function DepotArt() {
  return (
    <Art>
      <rect x={10} y={24} width={140} height={46} fill={CARD} {...outline} />
      <path d="M6 24h148v-9H6Z" fill={DEEP} {...outline} />
      <rect x={60} y={3} width={40} height={13} rx={3} fill={CARD} {...outline} />
      <Bar x={68} y={7.5} w={24} fill={ACC} />
      {[20, 64, 108].map((x, i) => (
        <g key={x}>
          <rect x={x} y={38} width={32} height={32} rx={2} fill={i === 2 ? DEEP : SOFT} {...outline} />
          {i < 2 && <path d={`M${x} 46h32M${x} 54h32M${x} 62h32`} {...outline} strokeWidth={1.2} />}
        </g>
      ))}
      <Car x={104} y={54} s={0.54} fill={PALE} />
    </Art>
  );
}

/* A headquarters: the tower, its two wings, and a flag on the roof. */
export function HeadquartersArt() {
  const lit = new Set(["0-1", "2-2", "1-0", "1-3"]);
  return (
    <Art>
      <rect x={24} y={42} width={36} height={28} fill={MID} {...outline} />
      <rect x={100} y={32} width={36} height={38} fill={PALE} {...outline} />
      <Bar x={30} y={50} w={24} fill={CARD} />
      <Bar x={30} y={58} w={24} fill={CARD} />
      <Bar x={106} y={40} w={24} fill={CARD} />
      <Bar x={106} y={48} w={24} fill={CARD} />
      <Bar x={106} y={56} w={24} fill={CARD} />
      <rect x={58} y={14} width={44} height={56} rx={2} fill={CARD} {...outline} />
      {[0, 1, 2].flatMap((c) =>
        [0, 1, 2, 3].map((r) => (
          <rect key={`${c}-${r}`} x={64 + c * 12} y={20 + r * 9.5} width={8} height={6} rx={1.5} fill={lit.has(`${c}-${r}`) ? ACC : SOFT} />
        )),
      )}
      <rect x={74} y={59} width={12} height={11} fill={DEEP} {...outline} />
      <path d="M80 14V3" {...outline} />
      <path d="M80 3h11l-3 3.5 3 3.5H80Z" fill={ACC} {...outline} strokeWidth={1.3} />
    </Art>
  );
}
