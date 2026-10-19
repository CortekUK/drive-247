"use client";

/**
 * The pictures for the full-screen signup — one per screen.
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

import { useId, type ReactNode } from "react";

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
const POP =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-200 motion-safe:ease-out";

function Art({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
      className={cn(TOKENS, "absolute inset-x-0 bottom-0 mx-auto h-full w-full max-w-[480px]")}
    >
      {children}
    </svg>
  );
}

/** A floating card, popping in a beat after the stage. */
function Float({ x, y, w, h, delay = 0, children }: { x: number; y: number; w: number; h: number; delay?: number; children?: ReactNode }) {
  return (
    <g className={POP} style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}>
      <g transform={`translate(${x} ${y})`}>
        <rect x={2} y={5} width={w} height={h} rx={14} fill="var(--sa-shadow)" />
        <rect width={w} height={h} rx={14} fill="var(--sa-card)" {...S} />
        {children}
      </g>
    </g>
  );
}

function Tick({ x, y, color = "var(--sa-on)", w = 2.4 }: { x: number; y: number; color?: string; w?: number }) {
  return <path d={`M${x} ${y} l4 4 l7 -8`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
}

function Badge({ x, y, r = 12 }: { x: number; y: number; r?: number }) {
  return (
    <g className="motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
      <circle cx={x} cy={y} r={r} fill="var(--sa-acc)" stroke="var(--sa-card)" strokeWidth={3} />
      <Tick x={x - 5.5} y={y + 0.5} w={2.3} />
    </g>
  );
}

function Sparkle({ x, y, r, opacity = 1 }: { x: number; y: number; r: number; opacity?: number }) {
  const d = `M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z`;
  return <path d={d} fill="var(--sa-acc)" opacity={opacity} />;
}

function Avatar({ x, y, r, skin = "#d9a88a", hair = "#1f2040" }: { x: number; y: number; r: number; skin?: string; hair?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="var(--sa-soft)" />
      <circle cy={-r * 0.18} r={r * 0.38} fill={skin} />
      <path d={`M${-r * 0.65} ${r * 0.72} Q0 ${r * 0.05} ${r * 0.65} ${r * 0.72}`} fill="var(--sa-acc)" />
      <path
        d={`M${-r * 0.38} ${-r * 0.3} Q${-r * 0.36} ${-r * 0.66} 0 ${-r * 0.66} Q${r * 0.36} ${-r * 0.66} ${r * 0.38} ${-r * 0.3} Q${r * 0.18} ${-r * 0.48} 0 ${-r * 0.48} Q${-r * 0.18} ${-r * 0.48} ${-r * 0.38} ${-r * 0.3}Z`}
        fill={hair}
      />
    </g>
  );
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
function Site({ name, address, progress = 1, carX = 0 }: { name: string; address: string; progress?: number; carX?: number }) {
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
        <g style={{ transform: `translateX(${carX}px)` }} className="transition-transform duration-700 ease-out motion-reduce:transition-none">
          <Car transform="translate(148 76) scale(.38)" />
        </g>
      </g>
      <text x="26" y="66" fontSize="15" fontWeight="800" fill="#fff" fontFamily={FONT} opacity={shown(1) ? 1 : 0} className={fade}>
        {name}
      </text>
      <rect x="26" y="75" width="78" height="5" rx="2.5" fill="#fff" opacity={shown(2) ? 0.55 : 0} className={fade} />
      <rect x="26" y="85" width="56" height="5" rx="2.5" fill="#fff" opacity={shown(2) ? 0.55 : 0} className={fade} />
      <g opacity={shown(3) ? 1 : 0} className={fade}>
        <rect x="26" y="101" width="52" height="18" rx="9" fill="#fff" />
        <text x="52" y="113.2" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="var(--sa-acc)" fontFamily={FONT}>
          Book now
        </text>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// 1 · Welcome — the car, a booking landing on one side, money on the other.
// ---------------------------------------------------------------------------

export function WelcomeArt() {
  return (
    <Art>
      <Car transform="translate(70 70) scale(.8)" />
      <Float x={20} y={56} w={118} h={52} delay={80}>
        <Avatar x={24} y={26} r={14} />
        <rect x="44" y="17" width="50" height="5.5" rx="2.75" fill="var(--sa-ink)" />
        <rect x="44" y="29" width="36" height="4.5" rx="2.25" fill="var(--sa-lite)" />
      </Float>
      <Badge x={134} y={58} r={11} />
      <Float x={264} y={46} w={116} h={60} delay={160}>
        <rect x="12" y="12" width="34" height="4.5" rx="2.25" fill="var(--sa-mut)" />
        <rect x="12" y="22" width="54" height="7" rx="3.5" fill="var(--sa-ink)" />
        {[6, 10, 8, 13, 17].map((h, i) => (
          <rect key={i} x={12 + i * 11} y={52 - h} width={7} height={h} rx={2} fill={i === 4 ? "var(--sa-acc)" : "var(--sa-soft)"} />
        ))}
        <path d="M74 50 L84 43 L92 46 L104 34" fill="none" stroke="var(--sa-acc)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </Float>
      <Sparkle x={210} y={58} r={6} />
      <Sparkle x={248} y={40} r={3.5} opacity={0.6} />
    </Art>
  );
}

// ---------------------------------------------------------------------------
// 2 · Password — the owner's card, the shield, the dots filling as they type.
// ---------------------------------------------------------------------------

export function PasswordArt({ length, ready, name }: { length: number; ready: boolean; name: string }) {
  const slots = 8;
  const filled = Math.min(length, slots);
  const first = clip(name.trim().split(/\s+/)[0] || "You", 11);
  const id = useArtId();
  return (
    <Art>
      <BrandFill id={`${id}b`} />
      {/* shield */}
      <g transform="translate(158 54)">
        <path d="M44 4 L84 18 L84 58 Q84 104 44 124 Q4 104 4 58 L4 18 Z" fill="var(--sa-shadow)" transform="translate(2 5)" />
        <path d="M42 0 L82 14 L82 54 Q82 100 42 120 Q2 100 2 54 L2 14 Z" fill={`url(#${id}b)`} {...S} />
        <path d="M42 14 L70 24 L70 54 Q70 88 42 104 Q14 88 14 54 L14 24 Z" fill="#fff" opacity=".14" />
        {ready ? (
          <path d="M28 60 l10 10 l18 -20" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className={POP} />
        ) : (
          <g>
            <path d="M33 56 v-7 a9 9 0 0 1 18 0 v7" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
            <rect x="28" y="55" width="28" height="22" rx="5" fill="#fff" />
            <circle cx="42" cy="64" r="3" fill="var(--sa-acc)" />
            <rect x="40.8" y="65" width="2.4" height="6" rx="1.2" fill="var(--sa-acc)" />
          </g>
        )}
      </g>
      <Float x={18} y={78} w={128} h={56} delay={80}>
        <Avatar x={26} y={28} r={15} />
        <text x="48" y="25" fontSize="12.5" fontWeight="700" fill="var(--sa-ink)" fontFamily={FONT}>
          {first}
        </text>
        <rect x="48" y="33" width="52" height="4.5" rx="2.25" fill="var(--sa-lite)" />
      </Float>
      <Float x={258} y={92} w={126} h={34} delay={160}>
        {Array.from({ length: slots }, (_, i) => (
          <circle
            key={i}
            cx={18 + i * 13}
            cy={17}
            r={3.6}
            fill={i < filled ? "var(--sa-ink)" : "var(--sa-lite)"}
            className="transition-[fill] duration-100"
          />
        ))}
      </Float>
      {ready && (
        <>
          <Sparkle x={262} y={66} r={6} />
          <Sparkle x={142} y={58} r={4} opacity={0.6} />
        </>
      )}
    </Art>
  );
}

// ---------------------------------------------------------------------------
// 3 · Business — their booking site, spelled with what they are typing.
// ---------------------------------------------------------------------------

export function SiteArt({ company, slug }: { company: string; slug: string }) {
  const name = clip(company.trim() || "Your business", 16);
  const address = `${clip(slug.trim() || "your-business", 22)}.drive-247.com`;
  return (
    <Art>
      <Site name={name} address={address} />
      {company.trim() && (
        <>
          <Sparkle x={362} y={64} r={6} />
          <Sparkle x={36} y={92} r={4} opacity={0.6} />
        </>
      )}
    </Art>
  );
}

// ---------------------------------------------------------------------------
// 4 · Code — the letter rising out of the envelope with the six boxes on it.
// ---------------------------------------------------------------------------

export function MailArt() {
  const id = useArtId();
  return (
    <Art>
      <BrandFill id={`${id}b`} />
      <g transform="translate(122 64)">
        <rect x="3" y="6" width="156" height="110" rx="14" fill="var(--sa-shadow)" />
        <rect width="156" height="110" rx="14" fill={`url(#${id}b)`} {...S} />
        <g className={POP} style={{ animationDelay: "80ms", animationFillMode: "both" }}>
          <rect x="18" y="-26" width="120" height="84" rx="10" fill="var(--sa-card)" {...S} />
          <rect x="32" y="-12" width="46" height="5.5" rx="2.75" fill="var(--sa-ink)" />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={32 + i * 16} y={4} width={12} height={16} rx={3.5} fill={i < 4 ? "var(--sa-acc)" : "var(--sa-soft)"} />
          ))}
          <rect x="32" y="30" width="64" height="4.5" rx="2.25" fill="var(--sa-lite)" />
        </g>
        <path d="M0 40 L78 82 L156 40 L156 96 Q156 110 142 110 L14 110 Q0 110 0 96 Z" fill={`url(#${id}b)`} {...S} />
        <path d="M0 106 L60 70 M156 106 L96 70" stroke="#fff" strokeOpacity=".35" strokeWidth="1.6" />
      </g>
      <Badge x={282} y={58} r={13} />
      <Sparkle x={104} y={70} r={5} />
      <Sparkle x={306} y={92} r={3.5} opacity={0.6} />
    </Art>
  );
}

// ---------------------------------------------------------------------------
// 5 · Payment — the card up front, the receipt beside it.
// ---------------------------------------------------------------------------

export function CardArt({ price }: { price?: string }) {
  const id = useArtId();
  return (
    <Art>
      <BrandFill id={`${id}b`} />
      <g transform="translate(78 66) rotate(-6 100 62)">
        <rect x="3" y="6" width="196" height="122" rx="16" fill="var(--sa-shadow)" />
        <rect width="196" height="122" rx="16" fill={`url(#${id}b)`} {...S} />
        <circle cx="170" cy="18" r="70" fill="#fff" opacity=".08" />
        <rect x="20" y="30" width="32" height="24" rx="5" fill="#f5e7c6" stroke="#151530" strokeWidth="1.4" />
        <path d="M20 42 H52 M36 30 V54" stroke="#151530" strokeWidth="1" strokeOpacity=".35" />
        <path d="M160 34 q7 10 0 20 M168 29 q11 15 0 30" fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="2" strokeLinecap="round" />
        {[0, 1, 2, 3].map((g) =>
          [0, 1, 2, 3].map((d) => (
            <circle key={`${g}${d}`} cx={22 + g * 40 + d * 7} cy={80} r={2.4} fill="#fff" opacity={g === 3 ? 1 : 0.55} />
          )),
        )}
        <rect x="20" y="96" width="62" height="6" rx="3" fill="#fff" opacity=".55" />
      </g>
      <Float x={280} y={60} w={100} h={96} delay={120}>
        <rect x="14" y="14" width="44" height="5.5" rx="2.75" fill="var(--sa-ink)" />
        <rect x="14" y="30" width="40" height="4.5" rx="2.25" fill="var(--sa-lite)" />
        <rect x="14" y="41" width="30" height="4.5" rx="2.25" fill="var(--sa-lite)" />
        <path d="M14 56 H86" stroke="var(--sa-lite)" strokeWidth="1.5" strokeDasharray="3 3" />
        <rect x="14" y="70" width="26" height="5" rx="2.5" fill="var(--sa-mut)" />
        <text x="86" y="76" textAnchor="end" fontSize="13" fontWeight="800" fill="var(--sa-ink)" fontFamily={FONT}>
          {price ?? ""}
        </text>
      </Float>
      <g>
        <circle cx="64" cy="76" r="17" fill="var(--sa-card)" {...S} />
        <path d="M58 75 v-3.6 a6 6 0 0 1 12 0 v3.6" fill="none" stroke="var(--sa-ink)" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="55.5" y="75" width="17" height="12" rx="3" fill="var(--sa-acc)" stroke="var(--sa-ink)" strokeWidth="1.6" />
      </g>
      <Sparkle x={262} y={50} r={5} />
    </Art>
  );
}

// ---------------------------------------------------------------------------
// 6 · Building — the site fills in, the car drives in and parks.
// ---------------------------------------------------------------------------

/**
 * `progress` is 0–1. The site's pieces appear in order and the car rolls into
 * its hero as the portal comes together; at 1 a tick and sparkles land. The
 * roll is slower than the 200ms standard on purpose: this is a loader, one of
 * the exceptions in V2_PLAN §12, and it is the only thing that moves.
 */
export function BuildArt({ progress, company, slug }: { progress: number; company: string; slug: string }) {
  const p = Math.max(0, Math.min(1, progress));
  const name = clip(company.trim() || "Your business", 16);
  const address = `${clip(slug.trim() || "your-business", 22)}.drive-247.com`;
  return (
    <Art>
      <Site name={name} address={address} progress={p} carX={-160 + p * 160} />
      {p >= 1 && (
        <>
          <Badge x={340} y={52} r={14} />
          <Sparkle x={366} y={84} r={5} />
          <Sparkle x={36} y={92} r={4} opacity={0.6} />
        </>
      )}
    </Art>
  );
}

// ---------------------------------------------------------------------------
// The screens that are not a step: signing back in, leaving for now.
// ---------------------------------------------------------------------------

/** Returning operator: their card and the key fob. */
export function KeyArt() {
  const id = useArtId();
  return (
    <Art>
      <BrandFill id={`${id}b`} />
      <g transform="translate(212 48) rotate(12 26 70)">
        <circle cx="26" cy="10" r="11" fill="none" stroke="var(--sa-ink)" strokeWidth="3" />
        <rect x="4" y="22" width="44" height="104" rx="20" fill="var(--sa-shadow)" transform="translate(2 5)" />
        <rect x="4" y="22" width="44" height="104" rx="20" fill={`url(#${id}b)`} {...S} />
        <circle cx="26" cy="56" r="8" fill="#fff" opacity=".9" />
        <rect x="16" y="82" width="20" height="5" rx="2.5" fill="#fff" opacity=".6" />
      </g>
      <Float x={70} y={74} w={128} h={58} delay={80}>
        <Avatar x={26} y={29} r={15} />
        <rect x="48" y="21" width="56" height="6" rx="3" fill="var(--sa-ink)" />
        <rect x="48" y="33" width="40" height="4.5" rx="2.25" fill="var(--sa-lite)" />
      </Float>
      <Sparkle x={286} y={66} r={5} />
    </Art>
  );
}

/** Leaving for now: the saved progress, ticked, waiting for them. */
export function PauseArt() {
  return (
    <Art>
      <Car transform="translate(150 96) scale(.62)" />
      <Float x={40} y={60} w={150} h={70} delay={80}>
        <Avatar x={28} y={28} r={15} />
        <rect x="52" y="20" width="62" height="6" rx="3" fill="var(--sa-ink)" />
        <rect x="52" y="32" width="40" height="4.5" rx="2.25" fill="var(--sa-lite)" />
        <rect x="14" y="50" width="122" height="9" rx="4.5" fill="var(--sa-soft)" />
        <rect x="14" y="50" width="70" height="9" rx="4.5" fill="var(--sa-acc)" />
      </Float>
      <Badge x={186} y={62} r={12} />
    </Art>
  );
}
