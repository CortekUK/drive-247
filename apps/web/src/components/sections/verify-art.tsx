"use client";

import { createContext, useContext } from "react";
import "./verify-art.css";

/*
 * The feature drawings' shared kit: the Launch section's palette (flat fills, firm outlines,
 * the accent from deep to pale) and the pieces Insurance, Agreements and Payments draw with
 * (feature-art.tsx) and ID verification draws around its real screens (verify-story.tsx).
 */

export const W = 640;
export const H = 560;
export const INK = "var(--va-ink)";
export const CARD = "var(--va-card)";
export const ACC = "var(--va-acc)";
export const DEEP = "var(--va-deep)";
export const MID = "var(--va-mid)";
export const SOFT = "var(--va-soft)";
export const ON = "var(--va-on)";
export const WARM = "var(--va-warm)";
export const TEXT = "var(--va-text)";
export const outline = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

/* The page draws this twice (held and inline), so every id inside is made unique per copy. */
export const Uid = createContext("va");

export function Tick({ x, y, r = 12, className }: { x: number; y: number; r?: number; className?: string }) {
  return (
    <g className={className}>
      <circle cx={x} cy={y} r={r} fill={ACC} {...outline} />
      <path d={`m${x - r * 0.42} ${y} ${r * 0.32} ${r * 0.32} ${r * 0.58} ${-r * 0.62}`} stroke={ON} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function Sparkle({ x, y, r, fill = ACC }: { x: number; y: number; r: number; fill?: string }) {
  const k = r * 0.2;
  return <path d={`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`} fill={fill} />;
}

/* The ID-photo stand-in: a head and shoulders, cut off by the photo's frame. */
export function Silhouette({ x, y, w, h, id: name }: { x: number; y: number; w: number; h: number; id: string }) {
  const id = `${useContext(Uid)}-${name}`;
  const cx = x + w / 2;
  return (
    <g>
      <clipPath id={id}>
        <rect x={x} y={y} width={w} height={h} rx={8} />
      </clipPath>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={SOFT} />
      <g clipPath={`url(#${id})`}>
        <circle cx={cx} cy={y + h * 0.4} r={w * 0.21} fill={MID} {...outline} strokeWidth={1.6} />
        <path d={`M${x + w * 0.12} ${y + h + 4}c0-${h * 0.26} ${w * 0.16}-${h * 0.36} ${w * 0.38}-${h * 0.36}s${w * 0.38} ${h * 0.1} ${w * 0.38} ${h * 0.36}Z`} fill={MID} {...outline} strokeWidth={1.6} />
      </g>
      <rect x={x} y={y} width={w} height={h} rx={8} {...outline} />
    </g>
  );
}

/*
 * A real portal screen, set into the drawing: clipped to its own rounded corners, with the
 * drawings' thick edge behind it and a firm outline, so the two read as one picture.
 */
export function Shot({ name, x, y, w, ratio, cssWidth, label, round }: { name: string; x: number; y: number; w: number; ratio: number; cssWidth: number; label?: boolean; round?: number }) {
  const h = w / ratio;
  const rx = round ?? (32 * w) / cssWidth;
  const clip = `${useContext(Uid)}-clip-${name.replace(/\W/g, "-")}`;
  return (
    <g className="va-shot">
      <rect x={x + 6} y={y + 8} width={w} height={h} rx={rx} fill={DEEP} {...outline} />
      <clipPath id={clip}>
        <rect x={x} y={y} width={w} height={h} rx={rx} />
      </clipPath>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={CARD} />
      <image className="va-light" href={`/v2/${name}.webp`} x={x} y={y} width={w} height={h} clipPath={`url(#${clip})`} />
      <image className="va-dark" href={`/v2/${name}-dark.webp`} x={x} y={y} width={w} height={h} clipPath={`url(#${clip})`} />
      <rect x={x} y={y} width={w} height={h} rx={rx} {...outline} />
      {label && (
        <g>
          <rect x={x + w - 118} y={y - 34} width={118} height={24} rx={12} fill={SOFT} {...outline} strokeWidth={1.6} />
          <circle cx={x + w - 102} cy={y - 22} r={4} fill={ACC} />
          <text x={x + w - 92} y={y - 18} fontSize={11.5} fontWeight={700} letterSpacing="-0.01em" fill={TEXT}>
            In your portal
          </text>
        </g>
      )}
    </g>
  );
}
