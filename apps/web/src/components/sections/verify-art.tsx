"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { useReveal } from "./operations-dashboard";
import "./verify-art.css";

/*
 * ID verification, drawn and real together. Each step pairs a drawing of what the renter
 * does (the Launch section's style: flat fills, firm outlines, the accent from deep to pale,
 * no person and no car) with the real portal screen of what the operator then sees.
 *
 * The screens are captured from the portal's own demo record (/playground/customer-detail-fake,
 * no real customer), light and dark, in public/v2/verify: what the check read, the verdict, and
 * the before-handover list. The licence-database step is cut from the verdict card, as that
 * check is not on general release.
 *
 * Scroll drives `step` (0 front, 1 back, 2 selfie, 3 checks, 4 verified) while the section
 * holds; anywhere else it plays through on its own.
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

const STEPS = 5;
const STEP_MS = [2600, 2600, 2800, 2400, 3600];

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

/* A PDF417-style block, the same every time. */
function Barcode({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const rows = 6;
  const bars: ReactNode[] = [];
  let seed = 7;
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let r = 0; r < rows; r++) {
    let at = x;
    while (at < x + w - 4) {
      const bw = 2 + Math.round(next() * 5);
      if (next() > 0.38) bars.push(<rect key={`${r}-${at}`} x={at} y={y + (r * h) / rows} width={bw} height={h / rows - 2} fill={DEEP} />);
      at += bw + 1.5;
    }
  }
  return <g>{bars}</g>;
}

/* Camera brackets round what is being photographed. */
export function Brackets({ x1, y1, x2, y2, len = 30 }: { x1: number; y1: number; x2: number; y2: number; len?: number }) {
  const s = { stroke: ACC, strokeWidth: 5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g>
      <path d={`M${x1} ${y1 + len}V${y1}H${x1 + len}`} {...s} />
      <path d={`M${x2 - len} ${y1}H${x2}V${y1 + len}`} {...s} />
      <path d={`M${x1} ${y2 - len}V${y2}H${x1 + len}`} {...s} />
      <path d={`M${x2 - len} ${y2}H${x2}V${y2 - len}`} {...s} />
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

function LicenceScene({ back }: { back: boolean }) {
  return (
    <g>
      {/* What the renter does: the licence, photographed in the frame */}
      <g transform="translate(-36 -42) scale(0.72)">
      <Brackets x1={64} y1={64} x2={496} y2={372} />
      <g transform="rotate(-4 280 218)">
        {/* The card's edge, so it reads as a thing you hold */}
        <rect x={114} y={118} width={340} height={214} rx={18} fill={DEEP} {...outline} />
        <g className={`va-face${back ? "" : " is-on"}`}>
          <rect x={110} y={110} width={340} height={214} rx={18} fill={CARD} {...outline} />
          <path d="M110 154v-26a18 18 0 0 1 18-18h304a18 18 0 0 1 18 18v26Z" fill={ACC} {...outline} />
          <text x={132} y={138} fontSize={15} fontWeight={700} letterSpacing="0.08em" fill={ON}>
            DRIVER LICENCE
          </text>
          <circle cx={420} cy={132} r={12} fill={WARM} {...outline} />
          <Sparkle x={420} y={132} r={6} fill={CARD} />
          <Silhouette x={132} y={172} w={92} h={118} id="va-photo-front" />
          <text x={246} y={184} fontSize={9} fontWeight={700} letterSpacing="0.06em" fill={TEXT} opacity={0.7}>NAME</text>
          <rect x={246} y={190} width={150} height={11} rx={5.5} fill={DEEP} />
          <text x={246} y={218} fontSize={9} fontWeight={700} letterSpacing="0.06em" fill={TEXT} opacity={0.7}>DATE OF BIRTH</text>
          <rect x={246} y={224} width={96} height={11} rx={5.5} fill={MID} />
          <text x={246} y={252} fontSize={9} fontWeight={700} letterSpacing="0.06em" fill={TEXT} opacity={0.7}>EXPIRES</text>
          <rect x={246} y={258} width={80} height={11} rx={5.5} fill={ACC} />
          <path d="M248 296c8-14 14-15 17-3s8 8 15-4 12 1 18 3 10 0 16-5" stroke={INK} strokeWidth={2} strokeLinecap="round" />
          <circle cx={414} cy={286} r={20} stroke={WARM} strokeWidth={3} />
          <circle cx={414} cy={286} r={11} stroke={MID} strokeWidth={3} />
        </g>
        <g className={`va-face${back ? " is-on" : ""}`}>
          <rect x={110} y={110} width={340} height={214} rx={18} fill={CARD} {...outline} />
          <rect x={111} y={136} width={338} height={36} fill={DEEP} />
          <Barcode x={136} y={198} w={290} h={78} />
          <text x={428} y={308} textAnchor="end" fontSize={10} fontWeight={700} letterSpacing="0.1em" fill={TEXT} opacity={0.6}>SAMPLE</text>
        </g>
        {/* The scan, sweeping the card */}
        <g className="va-beam">
          <rect x={104} y={110} width={352} height={4} rx={2} fill={ACC} />
          <rect x={104} y={96} width={352} height={14} fill={`url(#${useContext(Uid)}-glow)`} />
        </g>
      </g>

      {/* Which side has been taken */}
      {/* Which side is being taken, and which is done */}
      <g transform="translate(120 392)">
        <rect width={92} height={30} rx={15} fill={back ? ACC : SOFT} {...outline} stroke={back ? INK : ACC} strokeWidth={back ? 2 : 2.6} />
        <text x={back ? 38 : 46} y={20} textAnchor="middle" fontSize={13} fontWeight={700} fill={back ? ON : TEXT}>Front</text>
        {back && <path d="m62 15 4 4 8-8" stroke={ON} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />}
        <rect x={116} width={92} height={30} rx={15} fill={back ? SOFT : CARD} {...outline} stroke={back ? ACC : INK} strokeWidth={back ? 2.6 : 2} />
        <text x={162} y={20} textAnchor="middle" fontSize={13} fontWeight={700} fill={TEXT}>Back</text>
      </g>

      <Sparkle x={500} y={88} r={9} />
      <Sparkle x={518} y={112} r={4.5} fill={WARM} />
      </g>

      {/* What you see: what it read, against the renter's record */}
      <path className="va-link" d="M300 196C356 200 378 226 390 262" stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 9" />
      <Shot name="verify/read" x={194} y={268} w={440} ratio={960 / 626} cssWidth={480} label />
      <Sparkle x={150} y={330} r={7} fill={MID} />
      <Sparkle x={128} y={356} r={3.5} fill={WARM} />
    </g>
  );
}

function SelfieScene() {
  return (
    <g>
      {/* What the renter does: a selfie, held in the ring */}
      <g transform="translate(-32 -30)">
        <rect x={52} y={62} width={176} height={318} rx={32} fill={DEEP} {...outline} />
        <rect x={62} y={72} width={156} height={298} rx={24} fill={CARD} {...outline} />
        <rect x={118} y={82} width={44} height={8} rx={4} fill={DEEP} />
        <g className="va-orbit">
          <circle cx={140} cy={204} r={66} stroke={ACC} strokeWidth={3} strokeDasharray="6 9" strokeLinecap="round" />
        </g>
        <Brackets x1={96} y1={160} x2={184} y2={248} len={20} />
        {/* The face-scan mark */}
        <g stroke={ACC} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M124 188v10M156 188v10" />
          <path d="M140 188v20h-5" />
          <path d="M124 222q16 12 32 0" />
        </g>
        <text x={140} y={306} textAnchor="middle" fontSize={15} fontWeight={700} letterSpacing="-0.02em" fill={TEXT}>Selfie</text>
        <text x={140} y={326} textAnchor="middle" fontSize={11} fill={TEXT} opacity={0.7}>Hold still</text>
        <rect x={110} y={346} width={60} height={8} rx={4} fill={MID} />
      </g>

      {/* The licence photo it is matched to */}
      <g transform="rotate(5 388 92)">
        <rect x={300} y={36} width={176} height={112} rx={14} fill={CARD} {...outline} />
        <path d="M300 60v-10a14 14 0 0 1 14-14h148a14 14 0 0 1 14 14v10Z" fill={ACC} {...outline} />
        <Silhouette x={314} y={72} w={52} h={64} id="va-photo-match" />
        <rect x={378} y={82} width={80} height={8} rx={4} fill={DEEP} />
        <rect x={378} y={100} width={56} height={8} rx={4} fill={MID} />
        <rect x={378} y={118} width={44} height={8} rx={4} fill={ACC} />
      </g>
      <text x={388} y={176} textAnchor="middle" fontSize={12} fontWeight={600} fill={TEXT} opacity={0.8}>Licence photo</text>
      <path className="va-link" d="M196 150C240 150 256 104 296 96" stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 9" />

      {/* What you see: the verdict, and how close the face was */}
      <path className="va-link" d="M196 250C256 252 290 268 310 306" stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 9" />
      <Shot name="verify/verdict" x={214} y={316} w={420} ratio={960 / 496} cssWidth={480} label />

      <Sparkle x={540} y={60} r={8} />
      <Sparkle x={562} y={84} r={4} fill={WARM} />
      <Sparkle x={250} y={212} r={5} fill={MID} />
    </g>
  );
}

function VerdictScene({ stamped }: { stamped: boolean }) {
  const x = 140;
  const y = 120;
  const w = 360;
  const h = w / (800 / 670);
  return (
    <g>
      {/* What you see: the renter's record, every check before handover passed, on a clipboard */}
      <Shot name="verify/handover" x={x} y={y} w={w} ratio={800 / 670} cssWidth={400} label />
      <rect x={x + w / 2 - 34} y={y - 12} width={68} height={22} rx={7} fill={WARM} {...outline} />
      {/* The checks come in one by one, top to bottom. */}
      <rect className="va-reveal" x={x + 8} y={y + h * 0.33} width={w - 16} height={h * 0.62} fill={CARD} />

      {/* Cleared: the stamp lands, and the keys can go */}
      <g className={`va-stamp${stamped ? " is-on" : ""}`}>
        <g transform="rotate(-14 508 418)">
          <circle cx={508} cy={418} r={60} fill={ACC} {...outline} />
          <circle cx={508} cy={418} r={50} stroke={ON} strokeOpacity={0.55} strokeDasharray="3 4" />
          <path d="m490 400 10 10 20-21" stroke={ON} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          <text x={508} y={440} textAnchor="middle" fontSize={14} fontWeight={800} letterSpacing="0.08em" fill={ON}>VERIFIED</text>
        </g>
      </g>
      <g className={`va-keys${stamped ? " is-on" : ""}`} transform="translate(-6 60)">
        <circle cx={92} cy={300} r={14} stroke={INK} strokeWidth={2.4} />
        <g transform="rotate(-24 92 312)">
          <circle cx={92} cy={322} r={13} fill={CARD} {...outline} />
          <circle cx={92} cy={320} r={4} fill={SOFT} {...outline} strokeWidth={1.4} />
          <path d="M88 335v46l4 5 4-5v-5h6v-6h-4v-5h4v-6h-6v-24Z" fill={CARD} {...outline} />
        </g>
        <g transform="rotate(22 92 312)">
          <circle cx={92} cy={322} r={11} fill={MID} {...outline} />
          <path d="M89 333v38l3 4 3-4v-4h5v-5h-3v-4h3v-5h-5v-20Z" fill={MID} {...outline} />
        </g>
        <Sparkle x={54} y={262} r={7} />
      </g>

      <Sparkle x={540} y={140} r={9} />
      <Sparkle x={562} y={166} r={4.5} fill={WARM} />
      <Sparkle x={112} y={170} r={5} fill={MID} />
    </g>
  );
}

export function VerifyArt({ active, step }: { active: boolean; step?: number }) {
  const uid = `va${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { ref, visible } = useReveal();
  const [auto, setAuto] = useState(STEPS - 1);

  // Off the held screen it plays through by itself, while it is in view.
  useEffect(() => {
    if (step !== undefined || !visible || !active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let at = 0;
    let timer = 0;
    const show = () => {
      setAuto(at);
      timer = window.setTimeout(() => {
        at = (at + 1) % STEPS;
        show();
      }, STEP_MS[at]);
    };
    show();
    return () => window.clearTimeout(timer);
  }, [step, visible, active]);

  const now = step ?? auto;
  const scene = now <= 1 ? "licence" : now === 2 ? "selfie" : "verdict";

  return (
    <div ref={ref} className="va" data-scene={scene}>
      <svg viewBox={`0 0 ${W} ${H}`} fill="none" role="img" aria-label="An ID check: the renter photographs their licence and takes a selfie, and the portal shows what it read, the verdict with a 94% face match, and every check passed before handover.">
        <defs>
          <linearGradient id={`${uid}-glow`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--va-acc)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--va-acc)" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <Uid.Provider value={uid}>
        <g className={`va-scene${scene === "licence" ? " is-on" : ""}`}>
          <LicenceScene back={now >= 1} />
        </g>
        <g className={`va-scene${scene === "selfie" ? " is-on" : ""}`}>
          <SelfieScene />
        </g>
        <g key={scene === "verdict" ? "verdict-on" : "verdict-off"} className={`va-scene${scene === "verdict" ? " is-on" : ""}`}>
          <VerdictScene stamped={now >= 4} />
        </g>
        </Uid.Provider>
      </svg>
    </div>
  );
}
