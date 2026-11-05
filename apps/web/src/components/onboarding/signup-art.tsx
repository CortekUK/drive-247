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
  "[--sa-ink:#151530] [--sa-card:#ffffff] [--sa-lite:#e4e4ef] [--sa-acc:#4f46e5] [--sa-acc2:#6d63f5] [--sa-soft:#eceafe] [--sa-on:#ffffff] [--sa-mut:#a1a1b5] [--sa-shadow:rgba(30,27,75,0.12)] " +
  "dark:[--sa-ink:#0b0b1a] dark:[--sa-card:#f4f4fb] dark:[--sa-lite:#d9d9e8] dark:[--sa-acc:#6366f1] dark:[--sa-acc2:#8b8cf0] dark:[--sa-soft:#e4e3fb] dark:[--sa-on:#ffffff] dark:[--sa-mut:#9a9ab0] dark:[--sa-shadow:rgba(0,0,0,0.45)]";

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

const S = { stroke: "var(--sa-ink)", strokeWidth: 2, strokeLinejoin: "round" as const };

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
@media (prefers-reduced-motion: reduce) {
  .sa-in, .sa-out, .sa-pop, .sa-float, .sa-grow, .sa-spin, .sa-drive, .sa-draw, .sa-redraw, .sa-toast, .sa-breathe, .sa-carloop, .sa-ring { animation: none }
}
`;

const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

/** The soft shadow every scene stands on, now that there is no stage floor. */
function Ground({ rx = 130 }: { rx?: number }) {
  return <ellipse cx="200" cy="214" rx={rx} ry="6" fill="var(--sa-shadow)" />;
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
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  tick?: boolean;
  wait?: number;
  bob?: string;
}) {
  return (
    <g className="sa-pop" style={delay(wait)}>
      <g className="sa-float" style={{ animationDuration: bob, animationDelay: `${wait + 300}ms` }}>
        <rect x={x + 2} y={y + 3} width={w} height="26" rx="9" fill="var(--sa-shadow)" />
        <rect x={x} y={y} width={w} height="26" rx="9" fill="var(--sa-card)" {...S} strokeWidth={1.6} />
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
      </g>
    </g>
  );
}

/** Checking the details: a clipboard whose rows tick off one by one. */
function SceneCheck() {
  return (
    <g>
      <Ground rx={90} />
      <Chip x={22} y={84} w={104} label="Business name" wait={800} />
      <Chip x={286} y={128} w={94} label="Web address" wait={1216} bob="7s" />
      <g className="sa-float">
        <rect x="133" y="44" width="140" height="160" rx="16" fill="var(--sa-shadow)" />
        <rect x="130" y="40" width="140" height="160" rx="16" fill="var(--sa-card)" {...S} />
        <rect x="172" y="30" width="56" height="20" rx="7" fill="var(--sa-acc)" {...S} />
        {[78, 110, 142].map((y, i) => (
          <g key={y}>
            <g className="sa-pop" style={delay(240 + i * 352)}>
              <circle cx="156" cy={y} r="10" fill="var(--sa-acc)" />
              <Tick x={150.5} y={y + 0.5} />
            </g>
            <rect x="174" y={y - 4} width={[72, 58, 66][i]} height="8" rx="4" fill="var(--sa-lite)" className="sa-grow" style={delay(352 + i * 352)} />
          </g>
        ))}
      </g>
      <Sparkle x={300} y={70} r={6} />
      <Sparkle x={100} y={110} r={4} opacity={0.5} />
    </g>
  );
}

/** Confirming the payment: the card, a lock, and a tick landing on it. */
function SceneCard() {
  const id = useArtId();
  return (
    <g>
      <Ground rx={100} />
      <Chip x={18} y={132} w={92} label="Secured" tick={false} wait={672} />
      <Chip x={300} y={140} w={82} label="$1 paid" wait={1120} bob="7s" />
      <BrandFill id={`${id}g`} />
      <g className="sa-float">
        <rect x="113" y="66" width="180" height="114" rx="16" fill="var(--sa-shadow)" />
        <rect x="110" y="62" width="180" height="114" rx="16" fill={`url(#${id}g)`} {...S} />
        <rect x="130" y="90" width="30" height="22" rx="5" fill="#fff" opacity=".85" />
        <path d="M130 101 h30 M145 90 v22" stroke="var(--sa-acc)" strokeWidth="1.2" opacity=".6" />
        <text x="130" y="146" fontSize="14" fontWeight="700" fill="#fff" fontFamily={FONT} letterSpacing="2">
          •••• 4242
        </text>
        <circle cx="262" cy="96" r="10" fill="#fff" opacity=".35" />
        <circle cx="250" cy="96" r="10" fill="#fff" opacity=".55" />
      </g>
      <g className="sa-pop" style={delay(560)}>
        <Badge x={292} y={64} r={15} />
      </g>
      <Sparkle x={96} y={74} r={5} />
    </g>
  );
}

/** Making the brand: colour swatches fanning out. */
function ScenePalette() {
  const swatches = [
    { r: -16, fill: "var(--sa-acc2)" },
    { r: 0, fill: "var(--sa-acc)" },
    { r: 16, fill: "var(--sa-soft)" },
  ];
  return (
    <g>
      <Ground rx={80} />
      <Chip x={24} y={120} w={100} label="Your colours" tick={false} wait={992} />
      {swatches.map((sw, i) => (
        <g key={i} transform={`rotate(${sw.r} 200 210)`}>
          <g className="sa-pop" style={delay(i * 256)}>
            <rect x="166" y="52" width="68" height="132" rx="12" fill="var(--sa-card)" {...S} />
            <rect x="174" y="60" width="52" height="78" rx="8" fill={sw.fill} />
            <rect x="174" y="148" width="36" height="6" rx="3" fill="var(--sa-lite)" />
            <rect x="174" y="160" width="24" height="6" rx="3" fill="var(--sa-lite)" />
          </g>
        </g>
      ))}
      <g className="sa-pop" style={delay(896)}>
        <circle cx="300" cy="70" r="20" fill="var(--sa-card)" {...S} />
        <text x="300" y="76" textAnchor="middle" fontSize="16" fontWeight="800" fill="var(--sa-acc)" fontFamily={FONT}>
          Aa
        </text>
      </g>
      <Sparkle x={104} y={66} r={6} />
      <Sparkle x={318} y={128} r={4} opacity={0.6} />
    </g>
  );
}

/** The workspace and the owner: a portal window and a person joining it. */
function ScenePortal({ chips = true, live = false }: { chips?: boolean; live?: boolean }) {
  return (
    <g>
      <Ground rx={130} />
      {chips && (
        <>
          <Chip x={6} y={150} w={88} label="Workspace" wait={1120} />
          <Chip x={326} y={112} w={68} label="Owner" wait={1376} bob="7s" />
        </>
      )}
      <g className="sa-float">
        <rect x="73" y="54" width="240" height="160" rx="16" fill="var(--sa-shadow)" />
        <rect x="70" y="50" width="240" height="160" rx="16" fill="var(--sa-card)" {...S} />
        <rect x="80" y="60" width="52" height="140" rx="9" fill="var(--sa-soft)" />
        {[74, 92, 110].map((y, i) => (
          <rect key={y} x="90" y={y} width={i === 0 ? 32 : 26} height="7" rx="3.5" fill={i === 0 ? "var(--sa-acc)" : "var(--sa-lite)"} />
        ))}
        {[0, 1, 2].map((i) => (
          <g key={i} className="sa-pop" style={delay(192 + i * 224)}>
            <rect x={144 + i * 54} y="64" width="46" height="38" rx="8" fill="var(--sa-card)" stroke="var(--sa-lite)" strokeWidth="1.5" />
            <rect x={151 + i * 54} y="72" width="18" height="5" rx="2.5" fill="var(--sa-lite)" />
            <rect
              x={151 + i * 54}
              y="84"
              width="26"
              height="9"
              rx="3"
              fill={i === 1 ? "var(--sa-acc)" : "var(--sa-mut)"}
              opacity={i === 1 ? 1 : 0.5}
              className={live ? "sa-breathe" : undefined}
              style={live ? { animationDelay: `${i * 600}ms` } : undefined}
            />
          </g>
        ))}
        <rect x="144" y="114" width="154" height="60" rx="8" fill="var(--sa-soft)" />
        <path d="M152 162 L178 146 L200 154 L226 132 L250 140 L290 120" fill="none" stroke="var(--sa-acc)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={live ? "sa-redraw" : "sa-draw"} style={live ? undefined : delay(700)} />
      </g>
      <g className="sa-pop" style={delay(832)}>
        <circle cx="318" cy="66" r="24" fill="var(--sa-acc)" stroke="var(--sa-card)" strokeWidth="4" />
        <circle cx="318" cy="60" r="7" fill="#fff" />
        <path d="M305 79 a13 11 0 0 1 26 0" fill="#fff" />
      </g>
      <Sparkle x={350} y={104} r={5} />
      {live && (
        // A booking landing now and then, so the portal looks open for business.
        <g className="sa-toast">
          <rect x="182" y="178" width="132" height="30" rx="10" fill="var(--sa-shadow)" transform="translate(2 3)" />
          <rect x="182" y="178" width="132" height="30" rx="10" fill="var(--sa-card)" {...S} strokeWidth={1.6} />
          <circle cx="198" cy="193" r="8" fill="var(--sa-acc)" />
          <path d="M194 193.2 l3 3 l5 -5.6" fill="none" stroke="var(--sa-on)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <text x="212" y="197" fontSize="10" fontWeight="700" fill="var(--sa-ink)" fontFamily={FONT}>
            New booking · $240
          </text>
        </g>
      )}
    </g>
  );
}

/** Billing and the subscription: a receipt with the plan marked active. */
function SceneReceipt() {
  return (
    <g>
      <Ground rx={80} />
      <Chip x={26} y={140} w={102} label="Card on file" wait={896} />
      <Chip x={280} y={120} w={114} label="Renews monthly" tick={false} wait={1216} bob="7s" />
      <g className="sa-float">
        <path d="M143 44 h120 v150 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 z" fill="var(--sa-shadow)" transform="translate(3 4)" />
        <path d="M143 44 h120 v150 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 l-10 -6 l-10 6 z" fill="var(--sa-card)" {...S} />
        <rect x="160" y="62" width="50" height="7" rx="3.5" fill="var(--sa-lite)" />
        <text x="160" y="104" fontSize="28" fontWeight="800" fill="var(--sa-ink)" fontFamily={FONT}>
          $1
        </text>
        <text x="196" y="104" fontSize="10" fontWeight="600" fill="var(--sa-mut)" fontFamily={FONT}>
          /month
        </text>
        {[122, 136].map((y, i) => (
          <rect key={y} x="160" y={y} width={i ? 60 : 86} height="6" rx="3" fill="var(--sa-lite)" className="sa-grow" style={delay(224 + i * 224)} />
        ))}
        <g className="sa-pop" style={delay(672)}>
          <rect x="160" y="152" width="66" height="22" rx="11" fill="var(--sa-acc)" />
          <Tick x={168} y={163} />
          <text x="184" y="167" fontSize="10" fontWeight="700" fill="#fff" fontFamily={FONT}>
            Active
          </text>
        </g>
      </g>
      <g className="sa-spin">
        <Sparkle x={300} y={80} r={7} />
      </g>
      <Sparkle x={100} y={96} r={4} opacity={0.6} />
    </g>
  );
}

/** Which scene each stretch of the build shows. Index = milestones done. */
const SCENE_FOR_DONE = ["check", "card", "palette", "portal", "portal", "receipt", "receipt", "site", "done"] as const;
type SceneId = (typeof SCENE_FOR_DONE)[number];

function Scene({ id, company, slug }: { id: SceneId; company: string; slug: string }) {
  const name = clip(company.trim() || "Your business", 16);
  const address = `${clip(slug.trim() || "your-business", 22)}.drive-247.com`;
  switch (id) {
    case "check":
      return <SceneCheck />;
    case "card":
      return <SceneCard />;
    case "palette":
      return <ScenePalette />;
    case "portal":
      return <ScenePortal />;
    case "receipt":
      return <SceneReceipt />;
    case "site":
      // The booking site going up: the car drives into its hero (a loader,
      // so slower than 200ms on purpose; V2_PLAN §12).
      return (
        <>
          <Ground rx={150} />
          <Site name={name} address={address} progress={1} carX={0} driveIn />
          <Chip x={4} y={150} w={92} label="Publishing" tick={false} wait={800} />
        </>
      );
    case "done":
      return (
        <>
          <Ground rx={150} />
          <Site name={name} address={address} progress={1} carX={0} />
          <Chip x={4} y={150} w={58} label="Live" wait={480} />
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
}: {
  progress: number;
  done?: number;
  company: string;
  slug: string;
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
          <Scene id={x.id} company={company} slug={slug} />
        </g>
      ))}
    </Art>
  );
}

// ---------------------------------------------------------------------------
// 7 · You're live — one picture per card: the portal, and the booking site.
// ---------------------------------------------------------------------------
