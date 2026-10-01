'use client';

/**
 * Empty-state illustrations for the v2 list pages — Customers, Vehicles and
 * Rentals — in the Drive247 "quiet confidence" style: a low, wide car with
 * tinted glass worn like shades, faceless people who stand still and sure, one
 * soft glow per picture, no cartoon faces.
 *
 * Each scene draws itself twice — pearl paint for light mode, indigo for dark
 * — and lets the theme pick (`dark:hidden` / `hidden dark:block`), so nothing
 * here reads the theme in JS and nothing flashes on load.
 *
 * Decorative only: `aria-hidden`, the empty state's own headline says what the
 * picture means.
 */
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { carSvg, MONO_PAINT } from './car-art';
import { pal as kitPal } from './scene-kit';

type Paint = {
  top: string;
  bot: string;
  line: string;
  rim: string;
  glass: string;
  lamp: string;
  trim: string;
  tyre: string;
  tyreRim: string;
  shadow: string;
  shadowOpacity: number;
};

const PEARL: Paint = {
  top: '#ffffff',
  bot: '#e6e8f5',
  line: '#1f2040',
  rim: '#5b5bd6',
  glass: '#1e1b4b',
  lamp: '#e0e7ff',
  trim: '#5b5bd6',
  tyre: '#1f2040',
  tyreRim: '#5b5bd6',
  shadow: '#1e1b4b',
  shadowOpacity: 0.14,
};

const INDIGO: Paint = {
  top: '#3a36a8',
  bot: '#25217a',
  line: '#0b0b1a',
  rim: '#a5b4fc',
  glass: '#0b0b1a',
  lamp: '#eef2ff',
  trim: '#8b8cf0',
  tyre: '#0b0b1a',
  tyreRim: 'rgba(165,180,252,.55)',
  shadow: '#000000',
  shadowOpacity: 0.45,
};

const TAIL = '#f43f5e';

function BodyGradient({ id, p }: { id: string; p: Paint }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={p.top} />
      <stop offset="1" stopColor={p.bot} />
    </linearGradient>
  );
}

function Wheel({ cx, cy, r, p }: { cx: number; cy: number; r: number; p: Paint }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={p.tyre} stroke={p.tyreRim} strokeWidth={1.6} />
      <circle cx={cx} cy={cy} r={r * 0.48} fill={p.trim} />
      <circle cx={cx} cy={cy} r={3} fill={p.tyre} />
    </>
  );
}

/* ── The car, three angles. Same geometry as the approved library. ─────────── */

/** Three-quarter, front-left. Box 300 × 132. */
function CarThreeQuarter({ p }: { p: Paint }) {
  const g = useId().replace(/:/g, '');
  return (
    <g>
      <defs>
        <BodyGradient id={g} p={p} />
      </defs>
      <ellipse cx="156" cy="124" rx="146" ry="9" fill={p.shadow} opacity={p.shadowOpacity} />
      <rect x="22" y="96" width="22" height="26" rx="7" fill={p.tyre} stroke={p.tyreRim} strokeWidth={1.4} />
      <path
        d="M70 70 Q112 36 166 28 L204 28 Q242 32 266 58 L284 64 Q296 68 296 84 L296 98 Q296 106 286 106 L70 116 Z"
        fill={`url(#${g})`}
        stroke={p.line}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        d="M10 84 Q12 70 30 67 L70 70 L70 116 L24 113 Q10 111 10 100 Z"
        fill={`url(#${g})`}
        stroke={p.line}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M30 67 Q50 58 82 56" fill="none" stroke={p.line} strokeWidth={2} strokeLinecap="round" />
      <path d="M60 64 Q86 44 126 36 L142 36 Q128 48 122 62 Z" fill={p.glass} />
      <path d="M130 62 Q144 42 172 36 L204 36 Q232 40 250 60 Z" fill={p.glass} />
      <path d="M126 36 L122 62" stroke={p.top} strokeWidth={5} />
      <path d="M84 58 L104 44 L112 44 L92 59 Z" fill="#fff" opacity={0.6} />
      <path d="M176 58 L194 40 L200 40 L182 58 Z" fill="#fff" opacity={0.35} />
      <path d="M70 70 Q112 36 166 28 L204 28 Q242 32 266 58" fill="none" stroke={p.rim} strokeWidth={2.2} />
      <path d="M16 80 L46 76 L44 86 L18 89 Z" fill={p.lamp} stroke={p.line} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M72 76 L92 74 L92 82 L72 84 Z" fill={p.lamp} stroke={p.line} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M22 96 L64 98 L62 108 L26 106 Z" fill={p.line} />
      <path d="M34 101 Q46 104 58 100" fill="none" stroke={p.rim} strokeWidth={2} strokeLinecap="round" />
      <path d="M74 92 L292 84" stroke={p.trim} strokeWidth={2} opacity={0.75} />
      <path d="M288 70 L296 72 L296 80 L288 78 Z" fill={TAIL} />
      <Wheel cx={104} cy={108} r={20} p={p} />
      <Wheel cx={246} cy={108} r={20} p={p} />
    </g>
  );
}

/** Side profile, facing right. Box 300 × 124. */
function CarSide({ p }: { p: Paint }) {
  const g = useId().replace(/:/g, '');
  return (
    <g>
      <defs>
        <BodyGradient id={g} p={p} />
      </defs>
      <ellipse cx="152" cy="116" rx="140" ry="7" fill={p.shadow} opacity={p.shadowOpacity} />
      <path
        d="M8 86 Q8 72 24 68 L90 58 Q122 28 166 24 L200 24 Q236 28 262 56 L284 62 Q298 66 298 82 L298 94 Q298 102 288 102 L18 102 Q8 102 8 94 Z"
        fill={`url(#${g})`}
        stroke={p.line}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M90 58 Q122 28 166 24 L200 24 Q236 28 262 56" fill="none" stroke={p.rim} strokeWidth={2.2} />
      <path d="M104 58 Q128 36 166 32 L196 32 Q226 36 246 58 Z" fill={p.glass} />
      <path d="M150 54 L170 34 L178 34 L158 54 Z" fill="#fff" opacity={0.4} />
      <path d="M278 68 L297 72 L295 78 L280 76 Z" fill={p.lamp} stroke={p.line} strokeWidth={1.5} />
      <path d="M8 74 L22 72 L20 82 L8 82 Z" fill={TAIL} />
      <path d="M282 88 Q290 90 296 84" fill="none" stroke={p.rim} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M30 80 L270 76" stroke={p.trim} strokeWidth={2.2} opacity={0.75} />
      <Wheel cx={74} cy={102} r={21} p={p} />
      <Wheel cx={232} cy={102} r={21} p={p} />
    </g>
  );
}

/** Rear, driving away. Box 240 × 126. */
function CarRear({ p }: { p: Paint }) {
  const g = useId().replace(/:/g, '');
  return (
    <g>
      <defs>
        <BodyGradient id={g} p={p} />
      </defs>
      <ellipse cx="120" cy="118" rx="112" ry="8" fill={p.shadow} opacity={p.shadowOpacity} />
      <rect x="16" y="88" width="34" height="30" rx="8" fill={p.tyre} stroke={p.tyreRim} strokeWidth={1.6} />
      <rect x="190" y="88" width="34" height="30" rx="8" fill={p.tyre} stroke={p.tyreRim} strokeWidth={1.6} />
      <path
        d="M12 86 Q14 66 40 62 L74 57 Q92 34 120 32 Q148 34 166 57 L200 62 Q226 66 228 86 L228 100 Q228 110 216 110 L24 110 Q12 110 12 100 Z"
        fill={`url(#${g})`}
        stroke={p.line}
        strokeWidth={2}
      />
      <path d="M74 57 Q92 34 120 32 Q148 34 166 57" fill="none" stroke={p.rim} strokeWidth={2} />
      <path d="M82 58 Q98 42 120 40 Q142 42 158 58 Q120 63 82 58 Z" fill={p.glass} />
      <path d="M128 56 L140 44 L146 44 L134 57 Z" fill="#fff" opacity={0.45} />
      <rect x="22" y="72" width="196" height="8" rx="4" fill={TAIL} stroke={p.line} strokeWidth={1.4} />
      <rect x="96" y="86" width="48" height="14" rx="3" fill="#fff" stroke={p.line} strokeWidth={1.4} />
      <rect x="54" y="100" width="16" height="7" rx="3.5" fill={p.line} />
      <rect x="170" y="100" width="16" height="7" rx="3.5" fill={p.line} />
    </g>
  );
}

/** Top-down, nose up. Box 110 × 200. The approved top view (illustration guide §5.1). */
function CarTop({ p }: { p: Paint }) {
  const g = `top${useId().replace(/:/g, '')}`;
  return (
    <>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.top} />
          <stop offset="1" stopColor={p.bot} />
        </linearGradient>
      </defs>
      <rect x="2" y="30" width="14" height="34" rx="5" fill={p.tyre} />
      <rect x="94" y="30" width="14" height="34" rx="5" fill={p.tyre} />
      <rect x="0" y="136" width="16" height="38" rx="5" fill={p.tyre} />
      <rect x="94" y="136" width="16" height="38" rx="5" fill={p.tyre} />
      <path
        d="M30 6 Q55 0 80 6 Q98 14 98 44 L100 170 Q100 194 80 198 L30 198 Q10 194 10 170 L12 44 Q12 14 30 6 Z"
        fill={`url(#${g})`}
        stroke={p.line}
        strokeWidth={1.8}
      />
      <path d="M22 62 Q55 48 88 62 L82 88 Q55 80 28 88 Z" fill={p.glass} />
      <path d="M34 72 L50 58 L56 58 L40 74 Z" fill="#fff" opacity={0.45} />
      <path d="M28 92 L82 92 L84 140 L26 140 Z" fill={p.glass} opacity={0.9} />
      <path d="M28 144 Q55 138 82 144 L84 164 Q55 160 26 164 Z" fill={p.glass} />
      <path d="M16 16 Q30 8 42 10 M94 16 Q80 8 68 10" fill="none" stroke={p.rim} strokeWidth={4} strokeLinecap="round" />
      <path d="M16 190 L94 190" stroke={TAIL} strokeWidth={4} strokeLinecap="round" />
      <path d="M8 76 L14 74 L14 84 L8 84 Z M102 76 L96 74 L96 84 L102 84 Z" fill={p.bot} stroke={p.line} strokeWidth={1.2} />
      <path d="M55 12 L55 58 M55 168 L55 186" stroke={p.trim} strokeWidth={3} />
    </>
  );
}

/* ── People: faceless, upright, composed. Box 80 × 180, feet on y = 176. ───── */

type Dress = { jacket: string; accent: string; trousers: string; skin: string; hair: string; line: string; floor: number };

function Legs({ d }: { d: Dress }) {
  return (
    <>
      <ellipse cx="40" cy="176" rx="26" ry="4" fill="#000" opacity={d.floor} stroke="none" />
      <path d="M28 108 L26 170 L38 170 L40 124 L42 170 L54 170 L52 108 Z" fill={d.trousers} />
      <path d="M24 172 L38 172 L38 176 L22 176 Z" fill={d.line} />
      <path d="M42 172 L56 172 L58 176 L42 176 Z" fill={d.line} />
      <path d="M34 42 L46 42 L46 52 L34 52 Z" fill={d.skin} />
    </>
  );
}

/** The operator: short hair, indigo blazer, phone in hand. */
function Operator({ dark }: { dark: boolean }) {
  const d: Dress = {
    jacket: dark ? '#4f4ccc' : '#2e2a8f',
    accent: '#ffffff',
    trousers: dark ? '#1b1a3f' : '#1f2040',
    skin: '#d9a88a',
    hair: '#1f2040',
    line: dark ? '#0b0b1a' : '#1f2040',
    floor: dark ? 0.4 : 0.1,
  };
  return (
    <g stroke={d.line} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      <Legs d={d} />
      <path d="M20 58 Q22 48 34 48 L46 48 Q58 48 60 58 L62 112 L18 112 Z" fill={d.jacket} />
      <path d="M34 48 L40 66 L46 48" fill={d.accent} />
      <path d="M40 66 L40 110" strokeOpacity={0.35} />
      <path d="M20 60 Q14 86 18 108" fill="none" stroke={d.jacket} strokeWidth={9} />
      <path d="M20 60 Q14 86 18 108" fill="none" />
      <path d="M60 60 Q66 76 56 86 L48 84" fill="none" stroke={d.jacket} strokeWidth={9} />
      <path d="M60 60 Q66 76 56 86 L48 84" fill="none" />
      <rect x="40" y="74" width="10" height="17" rx="2.5" fill={d.line} transform="rotate(-12 45 82)" />
      <circle cx="47" cy="85" r="3.8" fill={d.skin} />
      <circle cx="18" cy="110" r="3.8" fill={d.skin} />
      <circle cx="40" cy="30" r="13" fill={d.skin} />
      <path d="M27 30 Q26 15 40 15 Q54 15 53 28 Q48 22 40 22 Q32 22 27 30 Z" fill={d.hair} />
    </g>
  );
}

/** The customer: tied-back hair, light jacket, a bag, one hand out for the key. */
function Customer({ dark }: { dark: boolean }) {
  const d: Dress = {
    jacket: dark ? '#c7d2fe' : '#e7dccb',
    accent: dark ? '#8b8cf0' : '#5b5bd6',
    trousers: dark ? '#2e2a8f' : '#3a36a8',
    skin: '#b77e5f',
    hair: '#2a1d1a',
    line: dark ? '#0b0b1a' : '#1f2040',
    floor: dark ? 0.4 : 0.1,
  };
  return (
    <g stroke={d.line} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      <Legs d={d} />
      <path d="M22 58 Q24 48 34 48 L46 48 Q56 48 58 58 L60 112 L20 112 Z" fill={d.jacket} />
      <path d="M34 48 L40 60 L46 48 Z" fill={d.accent} />
      <path d="M58 58 Q62 84 58 104" fill="none" stroke={d.jacket} strokeWidth={9} />
      <path d="M58 58 Q62 84 58 104" fill="none" />
      <rect x="54" y="94" width="18" height="22" rx="4" fill={d.accent} />
      <path d="M58 94 Q63 84 68 94" fill="none" />
      <path d="M22 60 Q10 70 2 70" fill="none" stroke={d.jacket} strokeWidth={9} />
      <path d="M22 60 Q10 70 2 70" fill="none" />
      <circle cx="0" cy="70" r="3.8" fill={d.skin} />
      <circle cx="40" cy="30" r="13" fill={d.skin} />
      <path d="M27 32 Q24 14 40 15 Q56 14 53 32 Q50 20 40 21 Q30 20 27 32 Z" fill={d.hair} />
      <circle cx="55" cy="22" r="5" fill={d.hair} />
    </g>
  );
}

function KeyFob({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke="#1f2040" strokeWidth={1.6} strokeLinejoin="round">
      <rect x="-7" y="-10" width="14" height="20" rx="5" fill={color} />
      <circle cx="0" cy="-3" r="2" fill="#fff" stroke="none" />
      <circle cx="0" cy="-14" r="4" fill="none" />
    </g>
  );
}

/* ── Scenes. 360 × 210, one soft glow each. ───────────────────────────────── */

const W = 360;
const H = 210;

function Stage({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className={cn('h-auto w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
    >
      <ellipse cx="180" cy="190" rx="170" ry="26" fill="#6366f1" opacity={dark ? 0.3 : 0.08} />
      {children}
    </svg>
  );
}

function Place({ x, y, s, children }: { x: number; y: number; s: number; children: React.ReactNode }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>{children}</g>;
}

function VehiclesScene({ dark }: { dark: boolean }) {
  const id = useId().replace(/:/g, '');
  const acc = dark ? 'hsl(var(--v2-link, var(--primary)))' : 'hsl(var(--primary))';
  const floor = dark ? '#3a3a3a' : '#e4e4e7';
  const art =
    `<path d="M20 172 H340" stroke="${floor}" stroke-width="2" stroke-linecap="round"/>` +
    vehiclesExtras(dark) +
    `<rect x="28" y="92" width="118" height="80" rx="14" fill="${dark ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--primary) / 0.05)'}" stroke="${acc}" stroke-width="2" stroke-dasharray="6 6"/>` +
    `<circle cx="87" cy="132" r="16" fill="${dark ? 'hsl(var(--background))' : '#ffffff'}" stroke="${acc}" stroke-width="2"/>` +
    `<path d="M87 124 v16 M79 132 h16" stroke="${acc}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<g stroke="${dark ? '#555555' : '#d4d4d8'}" stroke-width="2.4" stroke-linecap="round"><path d="M332 118 h18"/><path d="M336 132 h14"/><path d="M332 146 h18"/></g>` +
    `<g transform="translate(166 100) scale(.5)">${carSvg(MONO_PAINT, id)}</g>`;
  return (
    <svg
      viewBox="22 26 330 152"
      aria-hidden="true"
      className={cn('h-auto w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
      // Static art from constants only (see car-art.ts); nothing user-supplied.
      dangerouslySetInnerHTML={{ __html: art }}
    />
  );
}

/**
 * Customers and Rentals (Sep 27 2026): no car, and each picture tells its
 * page's story. Customers: a booking on your site flows into a customer
 * record, and their licence gets a verified tick. Rentals: the booked dates,
 * with what a rental carries around them — payment, signed agreement, keys. Ink, white and one indigo, like the feature cards.
 */
type Pal = { ink: string; card: string; lite: string; acc: string; soft: string; bg: string; mut: string; onAcc: string };
// The themed palette from scene-kit: theme accent, neutral dark surfaces.
function pal(dark: boolean): Pal {return kitPal(dark);}
const txt=(x: number, y: number, t: string, sz: number, w: number, f: string, a = 'start')=>`<text x="${x}" y="${y}" font-family="DM Sans,Helvetica,sans-serif" font-size="${sz}" font-weight="${w}" fill="${f}" text-anchor="${a}">${t}</text>`;
const tickP=(x: number, y: number, c: string, w = 2.4)=>`<path d="M${x} ${y} l4 4 l7 -8" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
function avatar(x: number, y: number, r: number, p: Pal, sk: string, hair: string): string {return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${p.soft}"/><circle cy="${-r*.18}" r="${r*.38}" fill="${sk}"/><path d="M${-r*.65} ${r*.72} Q0 ${r*.05} ${r*.65} ${r*.72}" fill="${p.acc}" opacity=".9"/><path d="M${-r*.38} ${-r*.3} Q${-r*.36} ${-r*.66} 0 ${-r*.66} Q${r*.36} ${-r*.66} ${r*.38} ${-r*.3} Q${r*.18} ${-r*.48} 0 ${-r*.48} Q${-r*.18} ${-r*.48} ${-r*.38} ${-r*.3}Z" fill="${hair}"/></g>`;}

function customersArt(dark: boolean): string {const p=pal(dark),S=`stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
 return `
 <!-- booking site on a phone -->
 <g transform="translate(20 34)">
  <rect width="72" height="124" rx="14" fill="${p.card}" ${S}/>
  <rect x="26" y="7" width="20" height="4" rx="2" fill="${p.ink}"/>
  <rect x="10" y="20" width="52" height="30" rx="6" fill="${p.lite}"/>
  <path d="M18 42 l10 -10 l8 7 l6 -5 l10 8" fill="none" stroke="${p.mut}" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="10" y="58" width="40" height="6" rx="3" fill="${p.ink}"/><rect x="10" y="70" width="28" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="10" y="96" width="52" height="18" rx="9" fill="${p.acc}"/>${txt(36,108.5,'Book',9,700,p.onAcc,'middle')}
 </g>
 <path d="M100 96 C 116 96, 118 96, 132 96" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M126 90 L133 96 L126 102" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <!-- the customer record -->
 <g transform="translate(140 30)">
  <rect width="160" height="136" rx="14" fill="${p.card}" ${S}/>
  ${avatar(30,32,17,p,'#d9a88a','#1f2040')}
  <rect x="56" y="22" width="80" height="8" rx="4" fill="${p.ink}"/><rect x="56" y="37" width="54" height="6" rx="3" fill="${p.lite}"/>
  <path d="M14 62 H146" stroke="${p.lite}" stroke-width="1.5"/>
  ${[0,1,2].map((i: number)=>`<g transform="translate(14 ${72+i*20})"><rect width="${[60,48,56][i]}" height="6" rx="3" fill="${p.lite}"/><rect x="${[92,100,96][i]}" width="${[40,32,36][i]}" height="6" rx="3" fill="${i===0?p.acc:p.lite}" opacity="${i===0?.8:1}"/></g>`).join('')}
 </g>
 <!-- the licence, checked -->
 <g transform="translate(268 104) rotate(6)">
  <rect width="80" height="52" rx="8" fill="${p.card}" ${S}/>
  <rect x="8" y="10" width="22" height="28" rx="4" fill="${p.soft}"/>${avatar(19,22,9,p,'#d9a88a','#1f2040').replace(`<circle r="9" fill="${p.soft}"/>`,'')}
  <rect x="36" y="12" width="34" height="5" rx="2.5" fill="${p.ink}"/><rect x="36" y="23" width="26" height="4" rx="2" fill="${p.lite}"/><rect x="36" y="32" width="30" height="4" rx="2" fill="${p.lite}"/>
  <circle cx="72" cy="0" r="11" fill="${p.acc}"/>${tickP(66.5,0,p.onAcc,2.2).replace('M66.5 0','M66.5 0.5')}
 </g>
 <ellipse cx="184" cy="174" rx="150" ry="6" fill="#000" opacity="${dark?.35:.05}"/>`;}

function rentalsArt(dark: boolean): string {const p=pal(dark),S=`stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
 const chip=(x: number, y: number, inner: string)=>`<g transform="translate(${x} ${y})"><rect width="58" height="46" rx="12" fill="${p.card}" ${S}/>${inner}</g>`;
 return `
 <g transform="translate(92 24)">
  <rect width="176" height="120" rx="14" fill="${p.card}" ${S}/>
  <path d="M0 14 Q0 0 14 0 L162 0 Q176 0 176 14 L176 28 L0 28 Z" fill="${p.ink}"/>
  ${txt(14,19,'May',10,700,dark?'hsl(var(--background))':'#ffffff')}
  <circle cx="44" cy="0" r="5.5" fill="${p.card}" ${S}/><circle cx="132" cy="0" r="5.5" fill="${p.card}" ${S}/>
  ${[0,1,2].map((r: number)=>[0,1,2,3,4,5,6].map((c: number)=>`<rect x="${12+c*22.6}" y="${38+r*25}" width="18" height="18" rx="5" fill="${p.lite}"/>`).join('')).join('')}
  <rect x="${12+2*22.6}" y="63" width="${3*22.6+18}" height="18" rx="6" fill="${p.acc}"/>
  ${avatar(12+2*22.6+9,72,6.5,{...p,soft:p.onAcc,acc:p.onAcc},'#d9a88a','#1f2040')}
 </g>
 <!-- what the rental carries -->
 ${chip(16,34,`${txt(29,28,'$',18,800,p.ink,'middle')}<circle cx="46" cy="12" r="8" fill="${p.acc}"/>${tickP(42,12,p.onAcc,2)}`)}
 ${chip(16,100,`<rect x="14" y="9" width="30" height="28" rx="4" fill="${p.soft}"/><path d="M19 28 C23 20 26 32 30 24 S36 22 40 27" fill="none" stroke="${p.acc}" stroke-width="2" stroke-linecap="round"/><rect x="18" y="14" width="20" height="3.5" rx="1.75" fill="${p.mut}"/>`)}
 ${chip(286,64,`<g transform="translate(18 23) rotate(-20)"><circle r="8" fill="${p.card}" stroke="${p.ink}" stroke-width="2"/><circle r="3" fill="${p.acc}"/><path d="M8 0 H26 M20 0 V6 M25 0 V4" fill="none" stroke="${p.ink}" stroke-width="2" stroke-linecap="round"/></g>`)}
 ${([['M74 57 H92',.8],['M74 123 C84 123 84 110 92 110',.8],['M268 87 H286',.8]] as [string, number][]).map(([d]: [string, number])=>`<path d="${d}" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>`).join('')}
 <ellipse cx="180" cy="162" rx="150" ry="6" fill="#000" opacity="${dark?.35:.05}"/>`;}

function vehiclesExtras(dark: boolean): string {const p=pal(dark),S=`stroke="${p.ink}" stroke-width="2" stroke-linejoin="round"`;
 return `
 <g transform="translate(46 32) rotate(-8)"><rect width="52" height="42" rx="7" fill="${p.card}" ${S}/><rect x="6" y="6" width="40" height="24" rx="4" fill="${p.lite}"/><path d="M10 26 l9 -9 l7 6 l6 -5 l10 8" fill="none" stroke="${p.mut}" stroke-width="1.5" stroke-linejoin="round"/><rect x="6" y="34" width="24" height="3.5" rx="1.75" fill="${p.lite}"/></g>
 <g transform="translate(112 40) rotate(10)"><path d="M0 10 Q0 0 10 0 L44 0 L60 16 L44 32 L10 32 Q0 32 0 22 Z" fill="${p.card}" ${S}/><circle cx="46" cy="16" r="3" fill="${p.ink}"/>${txt(22,21,'$/day',9.5,800,p.acc,'middle')}</g>
 <path d="M76 80 C 80 88, 84 90, 88 94 M126 76 C 118 86, 110 90, 104 94" fill="none" stroke="${p.acc}" stroke-width="1.8" stroke-dasharray="3 4" stroke-linecap="round"/>`;}

function StringScene({ dark, art, viewBox = '0 10 368 180' }: { dark: boolean; art: (dark: boolean) => string; viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      aria-hidden="true"
      className={cn('h-auto w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
      // Static art from constants only; nothing user-supplied.
      dangerouslySetInnerHTML={{ __html: art(dark) }}
    />
  );
}
const CustomersScene = ({ dark }: { dark: boolean }) => <StringScene dark={dark} art={customersArt} />;
// Cropped to its content: the calendar sits higher than the customer scene, so
// the shared frame left a band of empty canvas under it.
const RentalsScene = ({ dark }: { dark: boolean }) => <StringScene dark={dark} art={rentalsArt} viewBox="0 14 368 158" />;

/**
 * Global search, before anything is picked: a search typed above the fleet,
 * and the car it found. The field and the found car carry the accent; the rest
 * of the fleet is a quiet row of placeholder tiles.
 */
function SearchScene({ dark }: { dark: boolean }) {
  const id = useId().replace(/:/g, '');
  const p = pal(dark);
  const floor = dark ? '#3a3a3a' : '#e4e4e7';
  const tile = (x: number) =>
    `<rect x="${x}" y="122" width="54" height="34" rx="9" fill="${p.card}" stroke="${p.lite}" stroke-width="2"/>` +
    `<rect x="${x + 10}" y="134" width="34" height="5" rx="2.5" fill="${p.lite}"/>` +
    `<rect x="${x + 10}" y="143" width="22" height="4" rx="2" fill="${p.lite}"/>`;
  const art =
    `<path d="M20 172 H340" stroke="${floor}" stroke-width="2" stroke-linecap="round"/>` +
    // the search field
    `<rect x="70" y="30" width="220" height="36" rx="18" fill="${p.card}" stroke="${p.acc}" stroke-width="2"/>` +
    `<circle cx="93" cy="46" r="7" fill="none" stroke="${p.acc}" stroke-width="2.4"/>` +
    `<path d="M98 51 l6 6" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<rect x="114" y="43" width="92" height="6" rx="3" fill="${p.ink}" opacity=".8"/>` +
    `<rect x="210" y="40" width="2" height="12" rx="1" fill="${p.acc}"/>` +
    // the thread from the query to the car it found
    `<path d="M180 66 C180 84 206 84 206 100" fill="none" stroke="${p.acc}" stroke-width="1.8" stroke-dasharray="3 4" stroke-linecap="round"/>` +
    // the rest of the fleet, quiet
    tile(34) + tile(96) + tile(292) +
    // the found car, on an accent pad
    `<rect x="156" y="104" width="126" height="62" rx="14" fill="${p.soft}" stroke="${p.acc}" stroke-width="2"/>` +
    `<g transform="translate(160 112) scale(.36)">${carSvg(MONO_PAINT, id)}</g>`;
  return (
    <svg
      viewBox="22 22 330 156"
      aria-hidden="true"
      className={cn('h-auto w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
      // Static art from constants only (see car-art.ts); nothing user-supplied.
      dangerouslySetInnerHTML={{ __html: art }}
    />
  );
}

/* ── Public: one per page, both themes. ───────────────────────────────────── */

function Pair({ Scene, className }: { Scene: (p: { dark: boolean }) => JSX.Element; className?: string }) {
  return (
    <div className={cn('mx-auto w-full', className)}>
      <Scene dark={false} />
      <Scene dark />
    </div>
  );
}

/** Customers: a customer record with a verified badge, and a second card. */
export function CustomersEmptyArt({ className }: { className?: string }) {
  return <Pair Scene={CustomersScene} className={className} />;
}

/** Vehicles: the first car rolling toward an empty, waiting bay. */
export function VehiclesEmptyArt({ className }: { className?: string }) {
  return <Pair Scene={VehiclesScene} className={className} />;
}

/** Rentals: a booking on a calendar, with a key. */
export function RentalsEmptyArt({ className }: { className?: string }) {
  return <Pair Scene={RentalsScene} className={className} />;
}

/** Global search, before anything is picked: a search typed above the fleet, and the car it found. */
export function SearchEmptyArt({ className }: { className?: string }) {
  return <Pair Scene={SearchScene} className={className} />;
}
