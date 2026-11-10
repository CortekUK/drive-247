"use client";

/**
 * The picture for the build screen after payment. The signup card's own
 * screens carry no picture: just the headline and the form.
 *
 * Each one is drawn for the card's STAGE: the tinted band across the top of
 * the signup card (see `ScreenHead` in signup-ui.tsx), 400 × 200, anchored to
 * its bottom edge. The subject is big and sits on the stage's floor; one or
 * two small cards float beside it to say what the screen is for.
 *
 * Style is the portal's illustration language (apps/portal
 * components/illustrations-v2/scene-kit.tsx, ILLUSTRATION_GUIDE.md): ink
 * outlines, white cards, the brand indigo where it means something, faceless
 * people in circles, tick badges and sparkles for "done", the approved coupe.
 *
 * Several are LIVE — the picture mirrors the form: the owner's card carries the
 * name typed on the first screen and the password dots fill as they type; the
 * booking site spells out the business name and web address being chosen; the
 * build scene fills the site in and parks the car as the portal comes
 * together. Live text is rendered by React as <text> children, never
 * interpolated into markup.
 *
 * Light and dark ship together through the `--sa-*` tokens on the <svg>.
 */

import { useEffect, useId, useState, type ReactNode } from "react";

import { carSvg, type CarPaint } from "@/components/landing-v2/car-art";
import { cn } from "@/lib/utils";

const TOKENS =
  "[--sa-ink:#151530] [--sa-card:#ffffff] [--sa-lite:#e4e4ef] [--sa-acc:#4f46e5] [--sa-acc2:#6d63f5] [--sa-soft:#eceafe] [--sa-on:#ffffff] [--sa-mut:#a1a1b5] [--sa-shadow:rgba(30,27,75,0.10)] [--sa-line:#dedeea] [--sa-icon:#4b4b66] " +
  "dark:[--sa-ink:#0b0b1a] dark:[--sa-card:#f4f4fb] dark:[--sa-lite:#d9d9e8] dark:[--sa-acc:#6366f1] dark:[--sa-acc2:#8b8cf0] dark:[--sa-soft:#e4e3fb] dark:[--sa-on:#ffffff] dark:[--sa-mut:#9a9ab0] dark:[--sa-shadow:rgba(0,0,0,0.45)] dark:[--sa-line:#cdcde0] dark:[--sa-icon:#3a3a55]";

const FONT = "var(--font-sans), system-ui, sans-serif";

const PEARL: CarPaint = {
  top: "#ffffff", mid: "#f3f4fb", bot: "#dfe2f1", line: "#1f2040", rim: "#5b5bd6",
  glass: "#1e1b4b", pillar: "#ffffff", chrome: "#5b5bd6", trim: "#5b5bd6", tyre: "#1f2040",
  rimFace: "#e6e8f5", rimEdge: "#5b5bd6", spoke: "#5b5bd6", hub: "#1f2040",
  shadow: "#1e1b4b", shOp: 0.2, sheen: 0.9,
};

const INDIGO: CarPaint = {
  top: "#5b57d6", mid: "#3d39b0", bot: "#24207a", line: "#0b0b1a", rim: "#c7d2fe",
  glass: "#0b0b1a", pillar: "#24207a", chrome: "#a5b4fc", trim: "#a5b4fc", tyre: "#0b0b1a",
  rimFace: "#2b2870", rimEdge: "#8b8cf0", spoke: "#c7d2fe", hub: "#0b0b1a",
  shadow: "#000000", shOp: 0.5, sheen: 0.3,
};

function useArtId(): string {
  return useId().replace(/:/g, "");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------

const S = { stroke: "var(--sa-line)", strokeWidth: 1.25, strokeLinejoin: "round" as const };

function Art({
  children,
  viewBox = "0 0 400 200",
  className = "absolute inset-x-0 bottom-0 mx-auto h-full w-full max-w-[480px]",
}: {
  children: ReactNode;
  viewBox?: string;
  className?: string;
}) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMax meet" aria-hidden className={cn(TOKENS, className)}>
      {children}
    </svg>
  );
}

function Tick({ x, y, color = "var(--sa-on)", w = 2.4 }: { x: number; y: number; color?: string; w?: number }) {
  return <path d={`M${x} ${y} l4 4 l7 -8`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
}

function Badge({ x, y, r = 12 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="var(--sa-acc)" stroke="var(--sa-card)" strokeWidth={3} />
      <Tick x={x - 5.5} y={y + 0.5} w={2.3} />
    </g>
  );
}

function Sparkle({ x, y, r, opacity = 1 }: { x: number; y: number; r: number; opacity?: number }) {
  const d = `M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z`;
  return <path d={d} fill="var(--sa-acc)" opacity={opacity} />;
}

/** The approved coupe — pearl in light mode, indigo in dark. Box ≈ 330 × 140. */
function Car({ transform }: { transform: string }) {
  const id = useArtId();
  return (
    <g transform={transform}>
      {/* Static art from constants only — nothing user-supplied reaches it. */}
      <g className="dark:hidden" dangerouslySetInnerHTML={{ __html: carSvg(PEARL, `${id}p`) }} />
      <g className="hidden dark:inline" dangerouslySetInnerHTML={{ __html: carSvg(INDIGO, `${id}i`) }} />
    </g>
  );
}

/** The brand gradient, for the things that are "yours": the site, the card. */
function BrandFill({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--sa-acc2)" />
        <stop offset="1" stopColor="var(--sa-acc)" />
      </linearGradient>
    </defs>
  );
}

/** The booking site in a browser window, peeking up from the stage floor. */
function Site({ name, address, progress = 1, carX = 0, driveIn = false, loop = false }: { name: string; address: string; progress?: number; carX?: number; driveIn?: boolean; loop?: boolean }) {
  const id = useArtId();
  const shown = (i: number) => progress >= (i + 1) / 6 || progress >= 1;
  const fade = "transition-opacity duration-200 ease-out motion-reduce:transition-none";
  return (
    <g transform="translate(56 50)">
      <BrandFill id={`${id}b`} />
      <clipPath id={`${id}c`}>
        <rect x="10" y="36" width="268" height="104" rx="11" />
      </clipPath>
      <rect x="3" y="6" width="288" height="160" rx="16" fill="var(--sa-shadow)" />
      <rect width="288" height="160" rx="16" fill="var(--sa-card)" {...S} />
      {[14, 23, 32].map((cx) => (
        <circle key={cx} cx={cx} cy={15} r={2.8} fill="var(--sa-lite)" />
      ))}
      <rect x="46" y="7" width="226" height="16" rx="8" fill="var(--sa-soft)" />
      <path d="M55 14 v-1.6 a2.8 2.8 0 0 1 5.6 0 v1.6 M54 14 h7.6 v5 h-7.6 z" fill="none" stroke="var(--sa-acc)" strokeWidth="1.4" strokeLinejoin="round" />
      <text x="67" y="18.6" fontSize="9" fontWeight="600" fill="var(--sa-ink)" fontFamily={FONT}>
        {address}
      </text>
      <rect x="10" y="36" width="268" height="104" rx="11" fill={`url(#${id}b)`} opacity={shown(0) ? 1 : 0.18} className={fade} />
      <g clipPath={`url(#${id}c)`}>
        <circle cx="250" cy="40" r="60" fill="#fff" opacity=".08" />
        <path d="M150 128 H278" stroke="#fff" strokeOpacity=".25" strokeWidth="1.2" />
        <g
          style={{ transform: `translateX(${carX}px)` }}
          className={loop ? "sa-carloop" : driveIn ? "sa-drive" : "transition-transform duration-700 ease-out motion-reduce:transition-none"}
        >
          <Car transform="translate(148 76) scale(.38)" />
        </g>
      </g>
      <text x="26" y="66" fontSize="15" fontWeight="800" fill="#fff" fontFamily={FONT} opacity={shown(1) ? 1 : 0} className={fade}>
        {name}
      </text>
      <rect x="26" y="75" width="78" height="5" rx="2.5" fill="#fff" opacity={shown(2) ? 0.55 : 0} className={fade} />
      <rect x="26" y="85" width="56" height="5" rx="2.5" fill="#fff" opacity={shown(2) ? 0.55 : 0} className={fade} />
      <g opacity={shown(3) ? 1 : 0} className={fade}>
        {loop && <rect x="26" y="101" width="52" height="18" rx="9" fill="none" stroke="#fff" strokeWidth="1.5" className="sa-ring" />}
        <rect x="26" y="101" width="52" height="18" rx="9" fill="#fff" />
        <text x="52" y="113.2" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="var(--sa-acc)" fontFamily={FONT}>
          Book now
        </text>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// 6 · Building — one scene per stretch of the build, swapping as it lands.
// ---------------------------------------------------------------------------

/*
 * Motion, all inside the SVG so it travels with the art. Scenes enter with the
 * app's standard (200ms ease-out, opacity + 12px lift) and leave the other way
 * (ease-in). Inside a scene, things pop in on a stagger and the hero floats.
 * `transform-box: fill-box` makes every transform act on the shape's own box.
 */
const MOTION = `
@keyframes sa-in { from { opacity: 0; transform: translateY(14px) scale(.985) } to { opacity: 1; transform: none } }
@keyframes sa-out { from { opacity: 1; transform: none } to { opacity: 0; transform: translateY(-10px) scale(.99) } }
@keyframes sa-pop { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes sa-float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
@keyframes sa-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes sa-twinkle { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }
@keyframes sa-draw { from { stroke-dashoffset: 180 } to { stroke-dashoffset: 0 } }
@keyframes sa-redraw { 0% { stroke-dashoffset: 180; opacity: 1 } 40% { stroke-dashoffset: 0 } 85% { stroke-dashoffset: 0; opacity: 1 } 96% { opacity: 0 } 100% { stroke-dashoffset: 180; opacity: 0 } }
@keyframes sa-toast { 0%, 12% { opacity: 0; transform: translateY(10px) } 20%, 62% { opacity: 1; transform: none } 72%, 100% { opacity: 0; transform: translateY(-6px) } }
@keyframes sa-breathe { 0%, 100% { transform: scaleX(.55) } 50% { transform: scaleX(1) } }
@keyframes sa-carloop { 0% { transform: translateX(-210px) } 24% { transform: translateX(0) } 68% { transform: translateX(0) } 92%, 100% { transform: translateX(230px) } }
@keyframes sa-ring { 0% { opacity: .7; transform: scale(1) } 70%, 100% { opacity: 0; transform: scale(1.35) } }
@keyframes sa-drive { from { transform: translateX(-170px) } to { transform: translateX(0) } }
[fill="var(--sa-shadow)"] { filter: blur(7px) }
.sa-in { animation: sa-in 560ms cubic-bezier(.22,1,.36,1) both }
.sa-out { animation: sa-out 260ms cubic-bezier(.4,0,1,1) both }
.sa-pop { animation: sa-pop 600ms cubic-bezier(.22,1,.36,1) both; transform-box: fill-box; transform-origin: center }
.sa-float { animation: sa-float 5.5s ease-in-out infinite; transform-box: fill-box }
.sa-grow { animation: sa-grow 800ms cubic-bezier(.22,1,.36,1) both; transform-box: fill-box; transform-origin: left }
.sa-spin { animation: sa-twinkle 3.2s ease-in-out infinite }
.sa-draw { stroke-dasharray: 180; animation: sa-draw 1.4s cubic-bezier(.22,1,.36,1) both }
.sa-redraw { stroke-dasharray: 180; animation: sa-redraw 5.5s cubic-bezier(.22,1,.36,1) 600ms infinite both }
.sa-toast { animation: sa-toast 6.5s cubic-bezier(.22,1,.36,1) 1.2s infinite both; transform-box: fill-box }
.sa-breathe { animation: sa-breathe 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: left }
.sa-carloop { animation: sa-carloop 7s cubic-bezier(.45,0,.25,1) infinite both }
.sa-ring { animation: sa-ring 2.2s ease-out infinite; transform-box: fill-box; transform-origin: center }
.sa-drive { animation: sa-drive 1.6s cubic-bezier(.22,1,.36,1) 250ms both }
@keyframes sa-scan { 0%, 8% { transform: translateY(0) } 26%, 38% { transform: translateY(42px) } 56%, 70% { transform: translateY(84px) } 90%, 100% { transform: translateY(0) } }
@keyframes sa-drop { from { opacity: 0; transform: translateY(-56px) } to { opacity: 1; transform: none } }
@keyframes sa-shackle { from { transform: translateY(-6px) } to { transform: none } }
@keyframes sa-dab { 0%, 100% { transform: rotate(0) } 50% { transform: rotate(-12deg) } }
@keyframes sa-swing { 0%, 100% { transform: rotate(-8deg) } 50% { transform: rotate(8deg) } }
@keyframes sa-stamp { 0%, 8% { transform: translateY(-74px) } 30%, 44% { transform: translateY(0) } 70%, 100% { transform: translateY(-74px) } }
@keyframes sa-knob { from { transform: translateX(0) } to { transform: translateX(64px) } }
@keyframes sa-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes sa-orbit { to { transform: rotate(360deg) } }
@keyframes sa-slide { from { opacity: 0; transform: translateX(-10px) } to { opacity: 1; transform: none } }
.sa-scan { animation: sa-scan 4.2s cubic-bezier(.45,0,.25,1) 300ms infinite both }
.sa-drop { animation: sa-drop 900ms cubic-bezier(.22,1,.36,1) 200ms both }
.sa-shackle { animation: sa-shackle 300ms cubic-bezier(.4,0,.2,1) 1100ms both }
.sa-dab { animation: sa-dab 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.sa-swing { animation: sa-swing 2.8s ease-in-out infinite; transform-box: view-box }
.sa-stamp { animation: sa-stamp 3s cubic-bezier(.5,0,.3,1) infinite both }
.sa-knob { animation: sa-knob 450ms cubic-bezier(.34,1.56,.64,1) 900ms both }
.sa-on { animation: sa-fade 300ms ease-out 950ms both }
.sa-orbit { animation: sa-orbit 6s linear infinite; transform-box: view-box }
.sa-slide { animation: sa-slide 500ms cubic-bezier(.22,1,.36,1) both }
@keyframes sa-flow { to { stroke-dashoffset: -16 } }
.sa-flow { animation: sa-flow 900ms linear infinite }
@media (prefers-reduced-motion: reduce) {
  .sa-in, .sa-out, .sa-pop, .sa-float, .sa-grow, .sa-spin, .sa-drive, .sa-draw, .sa-redraw, .sa-toast, .sa-breathe, .sa-carloop, .sa-ring,
  .sa-scan, .sa-drop, .sa-shackle, .sa-dab, .sa-swing, .sa-stamp, .sa-knob, .sa-on, .sa-orbit, .sa-slide, .sa-flow { animation: none }
  .sa-knob { transform: translateX(64px) }
}
`;

const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

/** The soft shadow every scene stands on, now that there is no stage floor. */
function Ground({ rx = 130 }: { rx?: number }) {
  return <ellipse cx="200" cy="207" rx={rx} ry="5" fill="var(--sa-shadow)" />;
}

/**
 * A small floating card beside the hero, saying what the scene is for. It
 * pops in late and bobs out of step with the hero, so the picture never sits
 * still as one block.
 */
function Chip({
  x,
  y,
  w,
  label,
  tick = true,
  wait = 500,
  bob = "6.2s",
  strike = false,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  tick?: boolean;
  wait?: number;
  bob?: string;
  /** Crossed out, for the thing that was ruled out. */
  strike?: boolean;
}) {
  return (
    <g className="sa-pop" style={delay(wait)}>
      <g className="sa-float" style={{ animationDuration: bob, animationDelay: `${wait + 300}ms` }}>
        <rect x={x + 2} y={y + 3} width={w} height="26" rx="9" fill="var(--sa-shadow)" />
        <rect x={x} y={y} width={w} height="26" rx="9" fill="var(--sa-card)" {...S} />
        {tick ? (
          <>
            <circle cx={x + 14} cy={y + 13} r="7" fill="var(--sa-acc)" />
            <path d={`M${x + 10.5} ${y + 13.2} l2.5 2.5 l4.5 -5`} fill="none" stroke="var(--sa-on)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <circle cx={x + 14} cy={y + 13} r="4" fill="var(--sa-acc)" />
        )}
        <text x={x + 27} y={y + 17} fontSize="10" fontWeight="700" fill="var(--sa-ink)" fontFamily={FONT}>
          {label}
        </text>
        {strike && (
          <path
            d={`M${x + 25} ${y + 13.5} h${label.length * 6.2 + 4}`}
            stroke="var(--sa-acc)"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="sa-grow"
            style={delay(wait + 450)}
          />
        )}
      </g>
    </g>
  );
}

/**
 * 1 · Reading your details. The form they filled in, with THEIR answers on it,
 * and a magnifying glass going over it row by row; each row ticks as the glass
 * passes.
 */
function SceneDetails({ name, address }: { name: string; address: string }) {
  const rows = [
    { label: "BUSINESS NAME", value: name, tick: 500 },
    { label: "WEB ADDRESS", value: address, tick: 1500, small: true },
    { label: "TERMS", value: "Accepted", tick: 2750 },
  ];
  return (
    <g>
      <Ground rx={110} />
      <Chip x={10} y={72} w={84} label="No typos" wait={1600} />
      <Chip x={300} y={158} w={96} label="Address free" wait={2900} bob="7s" />
      <g className="sa-float">
        <rect x="113" y="38" width="180" height="170" rx="16" fill="var(--sa-shadow)" />
        <rect x="110" y="34" width="180" height="170" rx="16" fill="var(--sa-card)" {...S} />
        <text x="126" y="56" fontSize="11" fontWeight="800" fill="var(--sa-ink)" fontFamily={FONT}>
          Your details
        </text>
        <rect x="230" y="45" width="46" height="15" rx="7.5" fill="var(--sa-soft)" />
        <text x="253" y="55.4" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="var(--sa-acc)" fontFamily={FONT}>
          Checking
        </text>
        {rows.map((r, i) => {
          const y = 68 + i * 42;
          return (
            <g key={r.label}>
              <rect x="124" y={y} width="152" height="34" rx="9" fill="var(--sa-card)" stroke="var(--sa-lite)" strokeWidth="1.5" />
              <text x="134" y={y + 13} fontSize="6.5" fontWeight="700" letterSpacing=".6" fill="var(--sa-mut)" fontFamily={FONT}>
                {r.label}
              </text>
              <text x="134" y={y + 26} fontSize={r.small ? 8.5 : 10} fontWeight="700" fill="var(--sa-ink)" fontFamily={FONT}>
                {r.value}
              </text>
              <g className="sa-pop" style={delay(r.tick)}>
                <circle cx="263" cy={y + 17} r="8" fill="var(--sa-acc)" />
                <path d={`M259 ${y + 17.2} l2.6 2.6 l4.6 -5.2`} fill="none" stroke="var(--sa-on)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            </g>
          );
        })}
      </g>
      {/* The glass sweeps down the three rows and back up, on a loop. */}
      <g className="sa-scan">
        <path d="M314 98 L330 114" stroke="var(--sa-icon)" strokeWidth="4.5" strokeLinecap="round" />
        <circle cx="301" cy="85" r="19" fill="var(--sa-soft)" fillOpacity=".6" stroke="var(--sa-icon)" strokeWidth="2" />
        <path d="M290 80 a12 12 0 0 1 9 -7" fill="none" stroke="var(--sa-on)" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <Sparkle x={92} y={150} r={5} opacity={0.6} />
      <g className="sa-spin">
        <Sparkle x={322} y={40} r={6} />
      </g>
    </g>
  );
}

/**
 * 2 · The card. A free trial saves the card and charges nothing, so the
 * picture is the card dropping into a wallet and the lock clicking shut.
 */
function SceneCard() {
  const id = useArtId();
  return (
    <g>
      <Ground rx={104} />
      <Chip x={14} y={138} w={80} label="$0 today" tick={false} wait={1400} />
      <Chip x={302} y={88} w={88} label="Card saved" wait={1650} bob="7s" />
      <BrandFill id={`${id}g`} />
      <g className="sa-float">
        <rect x="118" y="82" width="170" height="124" rx="18" fill="var(--sa-shadow)" />
        <rect x="115" y="78" width="170" height="124" rx="18" fill="var(--sa-soft)" {...S} />
        <g className="sa-drop">
          <rect x="133" y="50" width="134" height="88" rx="12" fill={`url(#${id}g)`} {...S} />
          <rect x="147" y="66" width="22" height="16" rx="4" fill="#fff" opacity=".85" />
          <path d="M147 74 h22 M158 66 v16" stroke="var(--sa-acc)" strokeWidth="1" opacity=".6" />
          <circle cx="249" cy="74" r="8" fill="#fff" opacity=".35" />
          <circle cx="240" cy="74" r="8" fill="#fff" opacity=".6" />
          <text x="147" y="108" fontSize="11" fontWeight="700" fill="#fff" fontFamily={FONT} letterSpacing="2">
            •••• 4242
          </text>
        </g>
        <path d="M115 120 h170 v64 a18 18 0 0 1 -18 18 h-134 a18 18 0 0 1 -18 -18 z" fill="var(--sa-card)" {...S} />
        <path d="M128 132 h144" stroke="var(--sa-lite)" strokeWidth="1.6" strokeDasharray="4 4" />
        <g className="sa-shackle">
          <path d="M191 158 v-8 a9 9 0 0 1 18 0 v8" fill="none" stroke="var(--sa-icon)" strokeWidth="2" />
        </g>
        <rect x="185" y="156" width="30" height="24" rx="6" fill="var(--sa-acc)" {...S} />
        <circle cx="200" cy="166" r="2.8" fill="#fff" />
        <rect x="199" y="167" width="2" height="6" rx="1" fill="#fff" />
      </g>
      <g className="sa-pop" style={delay(1250)}>
        <Badge x={286} y={58} r={14} />
      </g>
      <Sparkle x={98} y={80} r={5} />
    </g>
  );
}

/**
 * 3 · The colours. A palette, a brush still moving, and their logo: the first
 * letter of the business, painted in the brand gradient. Beige is crossed off.
 */
function SceneBrand({ initial }: { initial: string }) {
  const id = useArtId();
  const blobs = [
    { cx: 78, cy: 132, fill: "var(--sa-acc2)" },
    { cx: 98, cy: 114, fill: "var(--sa-acc)" },
    { cx: 124, cy: 116, fill: "#a5b4fc" },
    { cx: 88, cy: 156, fill: "#c7d2fe" },
  ];
  return (
    <g>
      <Ground rx={120} />
      <BrandFill id={`${id}g`} />
      <g className="sa-pop">
        <ellipse cx="104" cy="140" rx="60" ry="42" transform="rotate(-12 104 140)" fill="var(--sa-card)" {...S} />
        <circle cx="126" cy="160" r="8" fill="var(--sa-soft)" {...S} />
        {blobs.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r="9" fill={b.fill} className="sa-pop" style={delay(150 + i * 150)} />
        ))}
      </g>
      <g className="sa-float">
        <circle cx="223" cy="108" r="52" fill="var(--sa-shadow)" transform="translate(3 4)" />
        <circle cx="223" cy="108" r="52" fill={`url(#${id}g)`} {...S} />
        <text x="223" y="125" textAnchor="middle" fontSize="48" fontWeight="800" fill="#fff" fontFamily={FONT} className="sa-pop" style={delay(900)}>
          {initial}
        </text>
      </g>
      <circle cx="223" cy="108" r="52" fill="none" stroke="var(--sa-acc)" strokeWidth="2" className="sa-ring" style={delay(1100)} />
      <g transform="translate(296 34) rotate(38)">
        <g className="sa-dab">
          <rect x="-5" y="0" width="10" height="58" rx="5" fill="var(--sa-icon)" />
          <rect x="-6.5" y="54" width="13" height="12" rx="2" fill="var(--sa-mut)" {...S} />
          <path d="M-6.5 66 h13 l-2 15 q-4.5 7 -9 0 z" fill="var(--sa-acc)" {...S} />
        </g>
      </g>
      {["var(--sa-acc2)", "var(--sa-acc)", "var(--sa-soft)"].map((fill, i) => (
        <rect key={i} x={300 + i * 26} y="150" width="20" height="40" rx="6" fill={fill} {...S} className="sa-pop" style={delay(1300 + i * 140)} />
      ))}
      <Chip x={296} y={108} w={64} label="Beige" tick={false} wait={1800} strike />
      <Sparkle x={160} y={44} r={5} opacity={0.7} />
    </g>
  );
}

/**
 * 4 · The workspace. Their portal assembling: the business name at the top of
 * the sidebar, the tabs sliding in, the tiles and the chart arriving.
 */
function SceneWorkspace({ name }: { name: string }) {
  const nav = ["Dashboard", "Vehicles", "Rentals", "Customers"];
  return (
    <g>
      <Ground rx={140} />
      <g className="sa-float">
        <rect x="65" y="38" width="276" height="172" rx="16" fill="var(--sa-shadow)" />
        <rect x="62" y="34" width="276" height="172" rx="16" fill="var(--sa-card)" {...S} />
        {[76, 85, 94].map((cx) => (
          <circle key={cx} cx={cx} cy={46} r={2.8} fill="var(--sa-lite)" />
        ))}
        <path d="M62 58 h276" stroke="var(--sa-lite)" strokeWidth="1.5" />
        <rect x="72" y="66" width="76" height="132" rx="10" fill="var(--sa-soft)" />
        <text x="82" y="84" fontSize="8.5" fontWeight="800" fill="var(--sa-acc)" fontFamily={FONT}>
          {name}
        </text>
        {nav.map((label, i) => (
          <g key={label} className="sa-slide" style={delay(250 + i * 180)}>
            <rect x="82" y={96 + i * 20} width="8" height="8" rx="2" fill={i === 0 ? "var(--sa-acc)" : "var(--sa-mut)"} />
            <text x="95" y={103 + i * 20} fontSize="7.5" fontWeight="600" fill={i === 0 ? "var(--sa-acc)" : "var(--sa-ink)"} fontFamily={FONT}>
              {label}
            </text>
          </g>
        ))}
        {[0, 1, 2].map((i) => (
          <g key={i} className="sa-pop" style={delay(1000 + i * 200)}>
            <rect x={158 + i * 58} y="68" width="50" height="38" rx="8" fill="var(--sa-card)" stroke="var(--sa-lite)" strokeWidth="1.5" />
            <rect x={165 + i * 58} y="76" width="20" height="5" rx="2.5" fill="var(--sa-lite)" />
            <rect x={165 + i * 58} y="88" width="28" height="9" rx="3" fill={i === 1 ? "var(--sa-acc)" : "var(--sa-mut)"} opacity={i === 1 ? 1 : 0.5} />
          </g>
        ))}
        <rect x="158" y="116" width="166" height="80" rx="8" fill="var(--sa-soft)" />
        <path d="M168 182 L192 166 L214 172 L240 150 L264 158 L312 132" fill="none" stroke="var(--sa-acc)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="sa-draw" style={delay(1500)} />
      </g>
      <Chip x={4} y={180} w={88} label="Workspace" wait={1500} />
      <Sparkle x={352} y={70} r={6} />
      <Sparkle x={44} y={96} r={4} opacity={0.6} />
    </g>
  );
}

/** One key for the owner's key ring. Drawn hanging from (0, 0). */
function Key({ fill, rotate }: { fill: string; rotate: number }) {
  return (
    <g transform={`translate(318 80) rotate(${rotate})`}>
      <circle cx="0" cy="10" r="8" fill={fill} {...S} />
      <circle cx="0" cy="10" r="2.5" fill="var(--sa-card)" />
      <rect x="-2.2" y="17" width="4.4" height="30" rx="1.5" fill={fill} {...S} />
      <rect x="2" y="36" width="6" height="4" rx="1" fill={fill} {...S} />
      <rect x="2" y="43" width="4" height="3.5" rx="1" fill={fill} {...S} />
    </g>
  );
}

/**
 * 5 · Making you the boss. Their staff badge on a lanyard, with their own first
 * name and "Owner" on it, and a ring of keys swinging beside it.
 */
function SceneOwner({ owner }: { owner: string }) {
  const id = useArtId();
  return (
    <g>
      <Ground rx={110} />
      <BrandFill id={`${id}g`} />
      <Chip x={18} y={120} w={86} label="Full access" wait={1300} />
      <g className="sa-float">
        <path d="M180 0 L194 44 M220 0 L206 44" stroke="var(--sa-acc)" strokeWidth="5" strokeLinecap="round" />
        <rect x="191" y="38" width="18" height="13" rx="3" fill="var(--sa-mut)" {...S} />
        <rect x="143" y="52" width="120" height="156" rx="16" fill="var(--sa-shadow)" />
        <rect x="140" y="48" width="120" height="156" rx="16" fill="var(--sa-card)" />
        <path d="M140 64 a16 16 0 0 1 16 -16 h88 a16 16 0 0 1 16 16 v18 h-120 z" fill={`url(#${id}g)`} />
        <rect x="140" y="48" width="120" height="156" rx="16" fill="none" {...S} />
        <rect x="188" y="57" width="24" height="6" rx="3" fill="var(--sa-card)" />
        <circle cx="200" cy="106" r="24" fill="var(--sa-soft)" {...S} />
        <circle cx="200" cy="100" r="8" fill="var(--sa-acc)" />
        <path d="M186 122 a14 12 0 0 1 28 0 z" fill="var(--sa-acc)" />
        <text x="200" y="148" textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--sa-ink)" fontFamily={FONT}>
          {owner}
        </text>
        <g className="sa-pop" style={delay(650)}>
          <rect x="172" y="156" width="56" height="18" rx="9" fill="var(--sa-acc)" />
          <text x="200" y="168.4" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily={FONT}>
            Owner
          </text>
        </g>
        <rect x="166" y="184" width="68" height="6" rx="3" fill="var(--sa-lite)" className="sa-grow" style={delay(900)} />
      </g>
      <g transform="translate(318 66) scale(1.35) translate(-318 -66)">
      <g className="sa-swing" style={{ transformOrigin: "318px 66px" }}>
        <circle cx="318" cy="72" r="13" fill="none" stroke="var(--sa-icon)" strokeWidth="2.2" />
        <Key fill="var(--sa-acc)" rotate={-28} />
        <Key fill="var(--sa-card)" rotate={0} />
        <Key fill="var(--sa-acc2)" rotate={28} />
      </g>
      </g>
      <Sparkle x={356} y={52} r={5} />
      <Sparkle x={112} y={70} r={4} opacity={0.6} />
    </g>
  );
}

/**
 * 6 · The paperwork. A stack of invoices, and a rubber stamp coming down on
 * the top one: SORTED.
 */
function ScenePaperwork() {
  return (
    <g>
      <Ground rx={110} />
      <Chip x={296} y={82} w={80} label="Invoices" wait={1400} />
      <Chip x={302} y={130} w={82} label="Receipts" wait={1700} bob="7s" />
      <g>
        <path d="M34 134 h30 l8 8 h44 a6 6 0 0 1 6 6 v48 a6 6 0 0 1 -6 6 h-82 a6 6 0 0 1 -6 -6 v-56 a6 6 0 0 1 6 -6 z" fill="var(--sa-soft)" {...S} />
        <rect x="44" y="124" width="58" height="34" rx="4" fill="var(--sa-card)" {...S} className="sa-pop" style={delay(300)} />
        <path d="M28 158 h94 v38 a6 6 0 0 1 -6 6 h-82 a6 6 0 0 1 -6 -6 z" fill="var(--sa-card)" {...S} />
      </g>
      <g className="sa-float">
        <rect x="150" y="56" width="120" height="150" rx="10" fill="var(--sa-card)" {...S} transform="rotate(-8 210 131)" />
        <rect x="150" y="56" width="120" height="150" rx="10" fill="var(--sa-card)" {...S} transform="rotate(5 210 131)" />
        <rect x="143" y="50" width="120" height="154" rx="10" fill="var(--sa-shadow)" />
        <rect x="140" y="46" width="120" height="154" rx="10" fill="var(--sa-card)" {...S} />
        <text x="154" y="68" fontSize="8" fontWeight="800" letterSpacing="1.2" fill="var(--sa-acc)" fontFamily={FONT}>
          INVOICE
        </text>
        <rect x="216" y="61" width="30" height="7" rx="3.5" fill="var(--sa-lite)" />
        {[84, 98, 112, 126].map((y, i) => (
          <rect key={y} x="154" y={y} width={[92, 70, 84, 58][i]} height="6" rx="3" fill="var(--sa-lite)" className="sa-grow" style={delay(150 + i * 150)} />
        ))}
        <g className="sa-pop" style={delay(1250)}>
          <g transform="rotate(-7 200 170)">
            <rect x="162" y="156" width="76" height="28" rx="6" fill="var(--sa-soft)" fillOpacity=".5" stroke="var(--sa-acc)" strokeWidth="2.4" />
            <text x="200" y="174.5" textAnchor="middle" fontSize="11" fontWeight="900" letterSpacing="1.6" fill="var(--sa-acc)" fontFamily={FONT}>
              SORTED
            </text>
          </g>
        </g>
      </g>
      <g className="sa-stamp">
        <circle cx="200" cy="96" r="10" fill="var(--sa-acc)" {...S} />
        <rect x="195" y="104" width="10" height="22" rx="2" fill="var(--sa-icon)" />
        <rect x="172" y="126" width="56" height="18" rx="4" fill="var(--sa-card)" {...S} />
        <rect x="176" y="144" width="48" height="7" rx="2" fill="var(--sa-acc)" />
      </g>
      <Sparkle x={290} y={50} r={5} />
    </g>
  );
}

/**
 * 7 · The big switch. One large toggle that slides to ON, lights up, and
 * throws a few sparks. The plan is now live.
 */
function SceneSwitch() {
  return (
    <g>
      <Ground rx={110} />
      <Chip x={24} y={86} w={66} label="Click." tick={false} wait={1100} />
      <Chip x={300} y={150} w={90} label="Plan active" wait={1500} bob="7s" />
      <g className="sa-float">
        <rect x="113" y="54" width="180" height="128" rx="24" fill="var(--sa-shadow)" />
        <rect x="110" y="50" width="180" height="128" rx="24" fill="var(--sa-card)" {...S} />
        <rect x="140" y="84" width="120" height="56" rx="28" fill="var(--sa-soft)" {...S} />
        <rect x="140" y="84" width="120" height="56" rx="28" fill="var(--sa-acc)" {...S} className="sa-on" />
        <text x="174" y="117" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily={FONT} className="sa-on">
          ON
        </text>
        <g className="sa-knob">
          <circle cx="170" cy="114" r="23" fill="var(--sa-shadow)" transform="translate(1 3)" />
          <circle cx="168" cy="112" r="23" fill="var(--sa-card)" {...S} />
          <path d="M162 104 v16 M168 104 v16 M174 104 v16" stroke="var(--sa-lite)" strokeWidth="2" strokeLinecap="round" />
        </g>
        <text x="200" y="164" textAnchor="middle" fontSize="8.5" fontWeight="700" letterSpacing=".6" fill="var(--sa-mut)" fontFamily={FONT}>
          YOUR PLAN
        </text>
      </g>
      <g className="sa-pop" style={delay(1250)}>
        <path d="M296 46 l9 -9 M304 62 h12 M286 36 l3 -12 M104 46 l-9 -9 M96 62 h-12 M114 36 l-3 -12" stroke="var(--sa-acc)" strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <g className="sa-spin">
        <Sparkle x={330} y={92} r={6} />
      </g>
    </g>
  );
}


/** A tiny copy of their booking site, for the phone and the laptop. */
function MiniSite({ x, y, w, h, name, id }: { x: number; y: number; w: number; h: number; name: string; id: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="5" fill={`url(#${id})`} />
      <text x={x + 6} y={y + 13} fontSize="7" fontWeight="800" fill="#fff" fontFamily={FONT}>
        {name}
      </text>
      <rect x={x + 6} y={y + 18} width={w * 0.5} height="3" rx="1.5" fill="#fff" opacity=".55" />
      <rect x={x + 6} y={y + h - 11} width="24" height="7" rx="3.5" fill="#fff" />
    </g>
  );
}

/**
 * 8 · On the internet. Their web address going up, a globe with pins landing
 * on it as people find them, and the site itself on a phone and a laptop,
 * linked to the globe by lines with traffic running along them.
 */
function SceneInternet({ name, address }: { name: string; address: string }) {
  const id = useArtId();
  const pins = [
    { x: 178, y: 98, wait: 700 },
    { x: 226, y: 108, wait: 1000 },
    { x: 192, y: 146, wait: 1300 },
    { x: 238, y: 142, wait: 1600 },
    { x: 162, y: 128, wait: 1900 },
  ];
  return (
    <g>
      <Ground rx={150} />
      <BrandFill id={`${id}g`} />
      <clipPath id={`${id}c`}>
        <circle cx="200" cy="122" r="58" />
      </clipPath>

      {/* Traffic: the site travelling out to each device. */}
      <path d="M100 132 C 120 132, 128 124, 142 122" fill="none" stroke="var(--sa-acc)" strokeWidth="1.6" strokeDasharray="3 5" className="sa-flow" />
      <path d="M258 116 C 272 112, 280 104, 296 104" fill="none" stroke="var(--sa-acc)" strokeWidth="1.6" strokeDasharray="3 5" className="sa-flow" />

      {/* The orbit and its satellite. */}
      <circle cx="200" cy="122" r="74" fill="none" stroke="var(--sa-lite)" strokeWidth="1.2" strokeDasharray="2 5" />
      <g className="sa-orbit" style={{ transformOrigin: "200px 122px" }}>
        <circle cx="200" cy="48" r="4.5" fill="var(--sa-acc)" stroke="var(--sa-card)" strokeWidth="2" />
      </g>

      {/* The globe. */}
      <g className="sa-float">
        <circle cx="200" cy="122" r="58" fill="var(--sa-shadow)" transform="translate(2 5)" />
        <circle cx="200" cy="122" r="58" fill="var(--sa-card)" {...S} />
        <g clipPath={`url(#${id}c)`}>
          <path d="M152 92 q14 -14 34 -8 q10 10 -4 20 q-16 6 -30 -2 z" fill="var(--sa-soft)" />
          <path d="M206 96 q22 -8 40 6 q6 16 -10 22 q-18 2 -26 -10 z" fill="var(--sa-soft)" />
          <path d="M170 134 q18 -6 30 6 q4 18 -12 24 q-16 -4 -18 -30 z" fill="var(--sa-soft)" />
          <path d="M224 138 q14 -4 24 6 q-2 12 -14 14 q-10 -6 -10 -20 z" fill="var(--sa-soft)" />
          <ellipse cx="200" cy="122" rx="24" ry="58" fill="none" stroke="var(--sa-lite)" strokeWidth="1" />
          <ellipse cx="200" cy="122" rx="46" ry="58" fill="none" stroke="var(--sa-lite)" strokeWidth="1" />
          <path d="M140 100 h120 M140 122 h120 M140 144 h120" stroke="var(--sa-lite)" strokeWidth="1" />
        </g>
        {pins.map((pin, i) => (
          <g key={i}>
            <circle cx={pin.x} cy={pin.y} r="5" fill="none" stroke="var(--sa-acc)" strokeWidth="1.4" className="sa-ring" style={delay(pin.wait + 300)} />
            <g className="sa-pop" style={delay(pin.wait)}>
              <path d={`M${pin.x} ${pin.y} c-5 -6 -7 -9 -7 -12 a7 7 0 0 1 14 0 c0 3 -2 6 -7 12 z`} fill="var(--sa-acc)" stroke="var(--sa-card)" strokeWidth="1.5" />
              <circle cx={pin.x} cy={pin.y - 12} r="2.4" fill="#fff" />
            </g>
          </g>
        ))}
      </g>

      {/* The address, going up first. */}
      <g className="sa-pop" style={delay(200)}>
        <rect x="116" y="12" width="168" height="26" rx="13" fill="var(--sa-shadow)" transform="translate(1 3)" />
        <rect x="116" y="12" width="168" height="26" rx="13" fill="var(--sa-card)" {...S} />
        <path d="M131 24 v-2 a3.4 3.4 0 0 1 6.8 0 v2 M130 24 h8.8 v6 h-8.8 z" fill="none" stroke="var(--sa-acc)" strokeWidth="1.4" strokeLinejoin="round" />
        <text x="145" y="28.6" fontSize="9.5" fontWeight="700" fill="var(--sa-ink)" fontFamily={FONT}>
          {address}
        </text>
      </g>

      {/* A phone on the left. */}
      <g className="sa-pop" style={delay(500)}>
        <g className="sa-float" style={{ animationDuration: "6.4s" }}>
          <rect x="38" y="80" width="62" height="112" rx="12" fill="var(--sa-shadow)" transform="translate(2 4)" />
          <rect x="38" y="80" width="62" height="112" rx="12" fill="var(--sa-card)" {...S} />
          <rect x="58" y="86" width="22" height="4" rx="2" fill="var(--sa-lite)" />
          <MiniSite x={44} y={96} w={50} h={56} name={clip(name, 7)} id={`${id}g`} />
          <rect x="44" y="160" width="50" height="6" rx="3" fill="var(--sa-lite)" />
          <rect x="44" y="171" width="34" height="6" rx="3" fill="var(--sa-lite)" />
        </g>
      </g>

      {/* A laptop on the right. */}
      <g className="sa-pop" style={delay(800)}>
        <g className="sa-float" style={{ animationDuration: "7s" }}>
          <rect x="296" y="78" width="96" height="66" rx="8" fill="var(--sa-shadow)" transform="translate(2 4)" />
          <rect x="296" y="78" width="96" height="66" rx="8" fill="var(--sa-card)" {...S} />
          <MiniSite x={302} y={84} w={84} h={46} name={name} id={`${id}g`} />
          <rect x="302" y="134" width="40" height="4" rx="2" fill="var(--sa-lite)" />
          <path d="M288 146 h112 l-6 8 h-100 z" fill="var(--sa-card)" {...S} />
        </g>
      </g>

      <Chip x={142} y={184} w={116} label="Live everywhere" wait={2100} />
      <g className="sa-spin">
        <Sparkle x={292} y={40} r={5} />
      </g>
      <Sparkle x={108} y={60} r={4} opacity={0.6} />
    </g>
  );
}

/** Which scene each stretch of the build shows. Index = milestones done. */
const SCENE_FOR_DONE = ["details", "card", "brand", "workspace", "owner", "paperwork", "switch", "site", "done"] as const;
type SceneId = (typeof SCENE_FOR_DONE)[number];

function Scene({ id, company, slug, owner }: { id: SceneId; company: string; slug: string; owner: string }) {
  const name = clip(company.trim() || "Your business", 16);
  const address = `${clip(slug.trim() || "your-business", 22)}.drive-247.com`;
  switch (id) {
    case "details":
      return (
        <SceneDetails
          name={clip(company.trim() || "Your business", 18)}
          address={`${clip(slug.trim() || "your-business", 10)}.drive-247.com`}
        />
      );
    case "card":
      return <SceneCard />;
    case "brand":
      return <SceneBrand initial={(company.trim()[0] ?? "D").toUpperCase()} />;
    case "workspace":
      return <SceneWorkspace name={clip(company.trim() || "Your business", 12)} />;
    case "owner":
      return <SceneOwner owner={clip(owner.trim().split(/\s+/)[0] || "You", 12)} />;
    case "paperwork":
      return <ScenePaperwork />;
    case "switch":
      return <SceneSwitch />;
    case "site":
      return (
        <SceneInternet
          name={clip(company.trim() || "Your business", 10)}
          address={`${clip(slug.trim() || "your-business", 12)}.drive-247.com`}
        />
      );
    case "done":
      return (
        <>
          <Ground rx={150} />
          <Site name={name} address={address} progress={1} carX={0} />
          <Chip x={16} y={192} w={58} label="Live" wait={480} />
          <g className="sa-pop" style={delay(192)}>
            <Badge x={340} y={52} r={14} />
          </g>
          <g className="sa-pop" style={delay(416)}>
            <Sparkle x={366} y={84} r={5} />
          </g>
          <g className="sa-pop" style={delay(576)}>
            <Sparkle x={36} y={92} r={4} opacity={0.6} />
          </g>
        </>
      );
  }
}

/**
 * `done` is how many of the eight milestones have landed (0–8); `progress` is
 * kept for callers that only know a fraction. Each stretch of the build has
 * its own scene, and a change of scene crossfades: the old one lifts away
 * while the new one rises in, both inside 200ms.
 */
export function BuildArt({
  progress,
  done,
  company,
  slug,
  owner = "",
}: {
  progress: number;
  done?: number;
  company: string;
  slug: string;
  /** The owner's full name, for their staff badge. */
  owner?: string;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const count = Math.max(0, Math.min(SCENE_FOR_DONE.length - 1, done ?? Math.round(p * 8)));
  const scene = p >= 1 ? "done" : SCENE_FOR_DONE[count];

  // The same element carries a scene from entering to leaving, so leaving only
  // swaps its class: nothing inside remounts and replays on the way out.
  const [scenes, setScenes] = useState<{ id: SceneId; key: number; leaving: boolean }[]>([
    { id: scene, key: 0, leaving: false },
  ]);
  useEffect(() => {
    let cleared: number | undefined;
    setScenes((list) => {
      const current = list.find((x) => !x.leaving);
      if (current?.id === scene) return list;
      const nextKey = Math.max(...list.map((x) => x.key)) + 1;
      return [...list.map((x) => ({ ...x, leaving: true })), { id: scene, key: nextKey, leaving: false }];
    });
    cleared = window.setTimeout(() => setScenes((list) => list.filter((x) => !x.leaving)), 280);
    return () => window.clearTimeout(cleared);
  }, [scene]);

  return (
    <Art viewBox="0 0 400 222" className="absolute inset-0 h-full w-full">
      <style>{MOTION}</style>
      {scenes.map((x) => (
        <g key={x.key} className={x.leaving ? "sa-out" : "sa-in"}>
          <Scene id={x.id} company={company} slug={slug} owner={owner} />
        </g>
      ))}
    </Art>
  );
}

// ---------------------------------------------------------------------------
// 7 · You're live — one picture per card: the portal, and the booking site.
// ---------------------------------------------------------------------------
