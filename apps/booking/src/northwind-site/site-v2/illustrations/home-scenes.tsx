'use client';

/**
 * Northwind booking site v2 — the home page's pictures, in the portal's
 * illustration language (ILLUSTRATION_GUIDE.md; `shared/portal-v2/empty-states`).
 *
 * Static markup from constants only — nothing user-supplied is interpolated,
 * which is what makes `dangerouslySetInnerHTML` safe. The accent is the
 * tenant's `--primary`, so a teal operator gets a teal pin, trim and key fob.
 * Both themes are drawn and the `dark:` class picks one, so there is no flash.
 */

import { carSvg, MONO_PAINT } from '@portal-v2-shared/empty-states/car-art';
import { avatar, ground, makeEmptyArt, pal, tick, txt, type Pal } from '@portal-v2-shared/empty-states/scene-kit';
import { cn } from '@nw/lib/utils';

/** A canvas: its size, where the floor starts, and how far apart the floor's columns run. */
export type Canvas = { w: number; h: number; horizon: number; colStep: number };

/* Wide: the strip runs nearly edge to edge on a desktop. Compact: the same three
   beats packed for a phone or a tablet, where a wide strip would be too thin. */
const WIDE: Canvas = { w: 1160, h: 300, horizon: 24, colStep: 120 };
const COMPACT: Canvas = { w: 520, h: 320, horizon: 56, colStep: 64 };

/** The floor: rows widen toward the viewer, columns run to the vanishing point. */
function grid(c: Canvas): string {
  const vp = { x: c.w / 2, y: c.horizon - 18 };
  let s = '';
  for (let i = 1; i <= 11; i++) {
    const t = i / 11;
    const y = c.horizon + (c.h - c.horizon) * t * t;
    s += `<path d="M-60 ${y.toFixed(1)} L${c.w + 60} ${y.toFixed(1)}"/>`;
  }
  for (let x = -c.w * 1.3; x <= c.w * 2.3; x += c.colStep) {
    s += `<path d="M${x.toFixed(1)} ${c.h} L${(vp.x + (x - vp.x) * 0.1).toFixed(1)} ${c.horizon}"/>`;
  }
  return s;
}

/** The floor, its fade at the top and sides, and one glow under the car. */
export function stage(c: Canvas, p: Pal, id: string, dark: boolean, glow: { cx: number; cy: number; rx: number; ry: number }) {
  const gridInk = dark ? '#3f3f46' : '#dcdbe6';
  return `
<defs>
  <linearGradient id="${id}fade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".25" stop-color="#fff" stop-opacity=".9"/>
    <stop offset="1" stop-color="#fff" stop-opacity="1"/>
  </linearGradient>
  <linearGradient id="${id}side" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".16" stop-color="#fff" stop-opacity="1"/>
    <stop offset=".84" stop-color="#fff" stop-opacity="1"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <mask id="${id}m1"><rect x="-60" y="${c.horizon}" width="${c.w + 120}" height="${c.h - c.horizon}" fill="url(#${id}fade)"/></mask>
  <mask id="${id}m2"><rect x="-60" y="${c.horizon}" width="${c.w + 120}" height="${c.h - c.horizon}" fill="url(#${id}side)"/></mask>
  <radialGradient id="${id}glow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="${p.acc}" stop-opacity="${dark ? 0.38 : 0.22}"/>
    <stop offset="1" stop-color="${p.acc}" stop-opacity="0"/>
  </radialGradient>
</defs>
<g mask="url(#${id}m2)"><g mask="url(#${id}m1)" fill="none" stroke="${gridInk}" stroke-width="1">${grid(c)}</g></g>
<ellipse cx="${glow.cx}" cy="${glow.cy}" rx="${glow.rx}" ry="${glow.ry}" fill="url(#${id}glow)"/>`;
}

/**
 * Beat 1 — booking online: a phone showing the chosen car, the two dates and a
 * ticked "Booked". The only real words in the picture, and the ones a renter
 * needs to recognise: this is the booking, these are the days.
 */
export function phone(x: number, y: number, p: Pal, id: string): string {
  const S = `stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
  const chip = (cx: number, label: string) =>
    `<rect x="${cx}" y="128" width="50" height="30" rx="9" fill="${p.card}" stroke="${p.lite}" stroke-width="1.6"/>` +
    txt(cx + 25, 147.5, label, 11, 700, p.ink, 'middle');
  return `<g transform="translate(${x} ${y}) rotate(-4)">
    <rect width="150" height="236" rx="24" fill="${p.card}" ${S}/>
    <rect x="58" y="11" width="34" height="6" rx="3" fill="${p.lite}"/>
    <rect x="14" y="28" width="122" height="66" rx="12" fill="${p.soft}"/>
    <g transform="translate(22 44) scale(0.32)">${carSvg(MONO_PAINT, `${id}m`)}</g>
    <rect x="14" y="104" width="70" height="8" rx="4" fill="${p.ink}"/>
    <rect x="90" y="104" width="34" height="8" rx="4" fill="${p.lite}"/>
    ${chip(14, 'Fri 24')}
    <path d="M69 143 H81 M77 139 L81 143 L77 147" fill="none" stroke="${p.mut}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    ${chip(86, 'Sun 26')}
    <rect x="14" y="170" width="122" height="7" rx="3.5" fill="${p.lite}"/>
    <rect x="14" y="188" width="122" height="34" rx="17" fill="${p.acc}"/>
    ${tick(50, 205, p.onAcc)}
    ${txt(68, 209.5, 'Booked', 12.5, 800, p.onAcc)}
  </g>`;
}

/**
 * The step label over each beat — the comic-strip caption that turns the
 * picture into "how renting here works": a numbered accent dot and a few words.
 * The width is estimated from the label (DM Sans ≈ half its size a letter) so
 * the pair centres over its beat.
 */
function step(cx: number, y: number, n: number, label: string, p: Pal, size = 15): string {
  const r = size * 0.74;
  const w = r * 2 + 8 + label.length * size * 0.51;
  return `<g transform="translate(${(cx - w / 2).toFixed(1)} ${y})">
    <circle cx="${r}" cy="0" r="${r}" fill="${p.acc}"/>
    ${txt(r, size * 0.3, String(n), size * 0.83, 800, p.onAcc, 'middle')}
    ${txt(r * 2 + 8, size * 0.35, label, size, 700, p.ink)}
  </g>`;
}

/**
 * The person handing over the keys: faceless, upright and still (the guide's
 * rule), facing the car, the key fob held out in the accent so the eye lands
 * on it. A bag in the other hand says "ready to go".
 */
export function keeper(x: number, y: number, p: Pal, dark: boolean): string {
  const skin = '#b77e5f';
  const hair = '#1f2040';
  const coat = dark ? '#8c8376' : '#ebe1d2';
  const trousers = dark ? '#3b3d6b' : '#1f2040';
  const S = `stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
  return `<g transform="translate(${x} ${y})">
    <ellipse cx="0" cy="252" rx="42" ry="6" fill="#000" opacity="${dark ? 0.35 : 0.07}"/>
    <!-- legs and shoes -->
    <rect x="-19" y="146" width="17" height="98" rx="3" fill="${trousers}" ${S}/>
    <rect x="2" y="146" width="17" height="98" rx="3" fill="${trousers}" ${S}/>
    <rect x="-25" y="242" width="25" height="9" rx="4" fill="${p.ink}"/>
    <rect x="1" y="242" width="25" height="9" rx="4" fill="${p.ink}"/>
    <!-- the far arm, down, holding the bag -->
    <path d="M24 58 L32 124" stroke="${p.ink}" stroke-width="15" stroke-linecap="round"/>
    <path d="M24 58 L32 124" stroke="${coat}" stroke-width="10.6" stroke-linecap="round"/>
    <path d="M28 126 Q36 114 44 126" fill="none" stroke="${p.ink}" stroke-width="2.2"/>
    <rect x="22" y="126" width="30" height="36" rx="6" fill="${p.lite}" ${S}/>
    <!-- coat -->
    <path d="M-27 60 Q-27 46 -13 44 L13 44 Q27 46 27 60 L30 150 L-30 150 Z" fill="${coat}" ${S}/>
    <path d="M-9 44 L0 62 L9 44 Z" fill="${p.acc}" ${S}/>
    <path d="M0 62 L0 150" stroke="${p.ink}" stroke-opacity=".35" stroke-width="1.4"/>
    <!-- the near arm, held out to the car with the keys -->
    <path d="M-22 58 L-54 92" stroke="${p.ink}" stroke-width="15" stroke-linecap="round"/>
    <path d="M-22 58 L-54 92" stroke="${coat}" stroke-width="10.6" stroke-linecap="round"/>
    <circle cx="-57" cy="95" r="6.5" fill="${skin}" stroke="${p.ink}" stroke-width="2"/>
    <circle cx="-66" cy="72" r="5.5" fill="none" stroke="${p.ink}" stroke-width="2.2"/>
    <rect x="-77" y="77" width="21" height="34" rx="9" fill="${p.acc}" ${S}/>
    <circle cx="-66.5" cy="89" r="3.2" fill="${p.card}"/>
    <!-- head: no face, as every person in the guide -->
    <rect x="-5" y="34" width="10" height="12" fill="${skin}"/>
    <circle cx="0" cy="18" r="20" fill="${skin}" ${S}/>
    <path d="M-20 16 Q-20 -4 0 -4 Q18 -4 21 12 Q12 4 0 5 Q-12 6 -20 16 Z" fill="${hair}"/>
    <circle cx="18" cy="-1" r="7.5" fill="${hair}"/>
  </g>`;
}

/**
 * The hero, per ILLUSTRATION_GUIDE.md §4c: the approved car on a perspective
 * grid floor, one soft glow under it — and the whole rental in three beats,
 * read left to right like a comic strip: book on your phone, we get the car
 * ready, collect your keys. Each beat has a short numbered caption, because
 * the customer this is for reads pictures before words. Mask and gradient ids
 * carry the theme and the layout, so no two copies on the page share one.
 */
function wideScene(dark: boolean): string {
  const p = pal(dark);
  const id = dark ? 'nwHeroWD' : 'nwHeroWL';
  return `${stage(WIDE, p, id, dark, { cx: 580, cy: 262, rx: 380, ry: 46 })}
<ellipse cx="150" cy="276" rx="70" ry="7" fill="#000" opacity="${dark ? 0.35 : 0.06}"/>
${phone(78, 34, p, id)}
<path d="M232 236 C262 266 300 272 340 268" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-dasharray="3 6" stroke-linecap="round"/>
<g transform="translate(292 30) scale(1.82)">${carSvg(MONO_PAINT, `${id}car`)}</g>
${keeper(1018, 30, p, dark)}
${step(152, -16, 1, 'Book online', p, 21)}
${step(592, -16, 2, 'We get your car ready', p, 21)}
${step(1010, -16, 3, 'Collect your keys', p, 21)}`;
}

/**
 * The same three beats for a phone or a tablet: the phone top left, the car
 * big across the middle, the person just behind its tail with the keys held
 * out over the roof — and the captions larger, so they still read at 360px.
 */
function compactScene(dark: boolean): string {
  const p = pal(dark);
  const id = dark ? 'nwHeroCD' : 'nwHeroCL';
  return `${stage(COMPACT, p, id, dark, { cx: 290, cy: 300, rx: 210, ry: 28 })}
<ellipse cx="66" cy="226" rx="40" ry="5" fill="#000" opacity="${dark ? 0.35 : 0.06}"/>
<g transform="translate(18 74) scale(0.62)">${phone(0, 0, p, id)}</g>
<g transform="translate(462 94) scale(0.64)">${keeper(0, 0, p, dark)}</g>
<path d="M66 226 C72 262 98 284 130 288" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 6" stroke-linecap="round"/>
<g transform="translate(110 152) scale(1.1)">${carSvg(MONO_PAINT, `${id}car`)}</g>
${step(76, 26, 1, 'Book online', p, 19)}
${step(268, 26, 2, 'Car ready', p, 19)}
${step(448, 26, 3, 'Keys in hand', p, 19)}`;
}

const Art = ({ dark, art, viewBox, className }: { dark: boolean; art: (dark: boolean) => string; viewBox: string; className?: string }) => (
  <svg
    viewBox={viewBox}
    aria-hidden="true"
    className={cn('h-auto w-full', dark ? 'hidden dark:block' : 'dark:hidden', className)}
    dangerouslySetInnerHTML={{ __html: art(dark) }}
  />
);

/**
 * The hero picture, sized by the screen's HEIGHT as well as its width, so the
 * whole hero — headline, picture, search — fits in one screen: the art takes
 * whatever height is left after `--hero-rest` (the hero's other parts, set by
 * the hero per breakpoint) and never more than its column. Compact below
 * `lg`, wide from `lg`.
 */
export function HomeHeroScene({ className }: { className?: string }) {
  return (
    <div className={cn('w-full', className)}>
      <div className="mx-auto w-[min(100%,560px,calc((100svh-var(--hero-rest,560px))*1.52))] lg:hidden">
        {[false, true].map((dark) => (
          <Art key={String(dark)} dark={dark} art={compactScene} viewBox="-8 0 540 342" />
        ))}
      </div>
      <div className="mx-auto hidden w-[min(100%,1240px,calc((100svh-var(--hero-rest,480px))*3.47))] lg:block">
        {[false, true].map((dark) => (
          <Art key={String(dark)} dark={dark} art={wideScene} viewBox={`0 -38 ${WIDE.w} ${WIDE.h + 38}`} />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── fleet cards ───────────────────────────── */

const FLOOR: Canvas = { w: 400, h: 120, horizon: 0, colStep: 44 };
const FLOOR_LINES = grid(FLOOR);

/**
 * The hero's grid floor, small, for a car card to stand its car on — so every
 * car on the page sits in the same illustrated world. Lines in `currentColor`
 * (the card sets it per theme), faded to nothing at the top and sides by a CSS
 * mask, so there are no SVG ids to keep unique across a grid of cards.
 */
export function CarFloor({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${FLOOR.w} ${FLOOR.h}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className={cn(
        'pointer-events-none [mask-image:radial-gradient(75%_100%_at_50%_100%,#000_35%,transparent_100%)]',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: `<g fill="none" stroke="currentColor" stroke-width="1">${FLOOR_LINES}</g>` }}
    />
  );
}

/**
 * The illustrated car, for a card whose car has no photo yet: the approved
 * drawing in place of "Photo coming soon", so the card still shows a car.
 * `id` keeps its gradient ids unique when several cards draw it.
 */
export function IllustratedCar({ id, className }: { id: string; className?: string }) {
  return (
    <svg
      viewBox="0 18 334 124"
      aria-hidden="true"
      className={cn('h-auto w-full', className)}
      dangerouslySetInnerHTML={{ __html: carSvg(MONO_PAINT, id) }}
    />
  );
}

/**
 * "Prices are per day": a calendar with a pick-up day and a return day joined
 * by a tinted band, and a clock badge — the days you choose are what you pay
 * for. Accent only on the two days, the band and the clock.
 */
function perDayArt(dark: boolean): string {
  const p = pal(dark);
  const S = `stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"`;
  const cols = [0, 1, 2, 3, 4, 5, 6].map((c) => 58 + c * 22);
  const dots = (y: number, skip: number[] = []) =>
    cols
      .filter((_, c) => !skip.includes(c))
      .map((x) => `<rect x="${x - 5}" y="${y - 2.5}" width="10" height="5" rx="2.5" fill="${p.lite}"/>`)
      .join('');
  return `
  ${ground(150, 150, 96, dark)}
  <rect x="40" y="38" width="190" height="104" rx="16" fill="${p.card}" ${S}/>
  <path d="M84 30 V46 M186 30 V46" stroke="${p.ink}" stroke-width="2.6" stroke-linecap="round"/>
  <rect x="56" y="58" width="58" height="7" rx="3.5" fill="${p.ink}"/>
  <path d="M190 58 l-4 4 l4 4 M204 58 l4 4 l-4 4" fill="none" stroke="${p.mut}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  ${dots(84)}
  <rect x="${cols[2] - 4}" y="96" width="${cols[5] - cols[2] + 8}" height="16" rx="8" fill="${p.soft}"/>
  ${dots(104, [2, 5])}
  <path class="nw-flow" d="M${cols[2] + 10} 104 H${cols[5] - 10}" stroke="${p.acc}" stroke-width="2.4" stroke-dasharray="3 5" stroke-linecap="round"/>
  <circle cx="${cols[2]}" cy="104" r="8.5" fill="${p.acc}"/>
  <circle cx="${cols[5]}" cy="104" r="8.5" fill="${p.acc}"/>
  ${dots(124)}
  <circle cx="226" cy="40" r="15" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>
  <circle cx="226" cy="40" r="8" fill="none" stroke="${p.onAcc}" stroke-width="2"/>
  <path class="nw-hand" style="transform-origin:226px 40px" d="M226 35.5 V40 L229.5 42" fill="none" stroke="${p.onAcc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export const PerDayArt = makeEmptyArt(perDayArt, '24 20 232 136');

/* ───────────────────────────── why rent from us ────────────────────────── */

/** The shared card outline every "why" picture draws with. */
export const inkStroke = (p: Pal, w = 2.2) => `stroke="${p.ink}" stroke-width="${w}" stroke-linejoin="round"`;
/* The motion classes below (`nw-flow`, `nw-pop`, `nw-draw`, `nw-bob`, …) are
   in styles/site.css. The one-off ones play when the picture is revealed or
   shown (`nw-live`); the ambient ones loop gently. Reduced motion: none play. */
export const accDash = (d: string, p: Pal) =>
  `<path class="nw-flow" d="${d}" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>`;
export const badgeTick = (x: number, y: number, p: Pal, delay = 0.35) =>
  `<g class="nw-pop" style="--d:${delay}s"><circle cx="${x}" cy="${y}" r="12" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>${tick(x - 5.5, y + 0.5, p.onAcc)}</g>`;
/** A path that draws itself, like a pen (`pathLength` 1 so one dash covers it). */
export const drawn = (attrs: string) => `<path class="nw-draw" pathLength="1" ${attrs}/>`;

/** Book in a few taps, day or night: the booking phone, a moon, and "24/7". */
function anytimeArt(dark: boolean): string {
  const p = pal(dark);
  const id = dark ? 'nwWhy1D' : 'nwWhy1L';
  return `
  ${ground(178, 182, 110, dark)}
  <g transform="translate(112 8) scale(0.72)">${phone(0, 0, p, id)}</g>
  <g class="nw-bob"><circle cx="266" cy="52" r="24" fill="${p.card}" ${inkStroke(p)}/>
  <path d="M272 38 A15 15 0 1 0 280 62 A12 12 0 1 1 272 38 Z" fill="${p.acc}"/></g>
  <g class="nw-pop" style="--d:.5s"><rect x="236" y="104" width="68" height="30" rx="15" fill="${p.acc}"/>
  ${txt(270, 124, '24/7', 14, 800, p.onAcc, 'middle')}</g>
  ${accDash('M226 136 C232 130 234 124 236 120', p)}
  <circle cx="74" cy="66" r="4" fill="${p.lite}"/><circle cx="58" cy="104" r="3" fill="${p.lite}"/>`;
}

/** The price you see is the price you pay: the receipt, a ticked total, a lock. */
function priceArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  const row = (y: number, w: number) =>
    `<rect x="16" y="${y}" width="${w}" height="7" rx="3.5" fill="${p.lite}"/><rect x="100" y="${y}" width="28" height="7" rx="3.5" fill="${p.lite}"/>`;
  return `
  ${ground(178, 182, 112, dark)}
  <g transform="translate(58 64) rotate(-10)">
    <rect width="112" height="72" rx="11" fill="${p.soft}" ${S}/>
    <rect x="14" y="16" width="20" height="15" rx="4" fill="${p.card}" stroke="${p.ink}" stroke-width="1.6"/>
    <rect x="14" y="46" width="56" height="6" rx="3" fill="${p.ink}"/>
  </g>
  <g transform="translate(148 14)">
    <rect width="144" height="158" rx="14" fill="${p.card}" ${S}/>
    ${row(22, 58)}${row(42, 46)}${row(62, 64)}
    <path d="M16 86 H128" stroke="${p.lite}" stroke-width="2" stroke-dasharray="4 4"/>
    ${txt(16, 114, 'Total', 13, 800, p.ink)}
    <g class="nw-pop" style="--d:.55s"><rect x="72" y="96" width="58" height="26" rx="13" fill="${p.acc}"/>
    ${txt(101, 113.5, '$135', 12, 800, p.onAcc, 'middle')}</g>
    <rect x="16" y="136" width="84" height="7" rx="3.5" fill="${p.soft}"/>
    ${badgeTick(144, 0, p)}
  </g>
  <g class="nw-bob" style="--d:-1.5s"><g transform="translate(306 112)">
    <circle r="22" fill="${p.card}" ${S}/>
    <path d="M-7 -2 V-7 A7 7 0 0 1 7 -7 V-2" fill="none" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="-10" y="-3" width="20" height="15" rx="4" fill="${p.acc}"/>
  </g></g>`;
}

/** Paperwork done before you arrive: the licence, checked, and a signed agreement. */
function paperworkArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  return `
  ${ground(180, 182, 116, dark)}
  <g transform="translate(46 58) rotate(-6)">
    <rect width="132" height="86" rx="12" fill="${p.card}" ${S}/>
    <rect x="1.2" y="1.2" width="129.6" height="14" rx="10" fill="${p.soft}"/>
    ${avatar(32, 50, 17, p)}
    <rect x="58" y="34" width="54" height="7" rx="3.5" fill="${p.ink}"/>
    <rect x="58" y="49" width="60" height="6" rx="3" fill="${p.lite}"/>
    <rect x="58" y="62" width="40" height="6" rx="3" fill="${p.lite}"/>
    ${badgeTick(128, 8, p)}
  </g>
  ${accDash('M184 112 C196 104 204 100 212 98', p)}
  <g transform="translate(212 18)">
    <rect width="114" height="150" rx="12" fill="${p.card}" ${S}/>
    <rect x="14" y="18" width="62" height="7" rx="3.5" fill="${p.ink}"/>
    <rect x="14" y="36" width="86" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="14" y="48" width="80" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="14" y="60" width="86" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="14" y="72" width="54" height="5" rx="2.5" fill="${p.lite}"/>
    ${drawn(`d="M18 116 C24 100 30 124 38 108 S50 98 56 112 S66 116 76 102" fill="none" stroke="${p.acc}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`)}
    <path d="M14 126 H100" stroke="${p.ink}" stroke-width="1.6"/>
    ${badgeTick(114, 0, p, 1.5)}
  </g>`;
}

/** Your rental in your pocket: the account on a phone, and a message to us. */
function pocketArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  const row = (y: number, active: boolean, icon: string) =>
    `<rect x="12" y="${y}" width="98" height="30" rx="10" fill="${active ? p.soft : p.card}" stroke="${active ? p.acc : p.lite}" stroke-width="1.6"/>` +
    `<circle cx="28" cy="${y + 15}" r="8" fill="${active ? p.acc : p.lite}"/>${icon}` +
    `<rect x="42" y="${y + 12}" width="${active ? 50 : 40}" height="6" rx="3" fill="${active ? p.ink : p.lite}"/>`;
  return `
  ${ground(176, 182, 108, dark)}
  <g transform="translate(92 8)">
    <rect width="122" height="170" rx="22" fill="${p.card}" ${S}/>
    <rect x="44" y="10" width="34" height="6" rx="3" fill="${p.lite}"/>
    ${avatar(26, 38, 11, p)}
    <rect x="44" y="34" width="46" height="7" rx="3.5" fill="${p.ink}"/>
    ${row(62, true, `<path d="M24 77 h8 M28 73 v8" stroke="${p.onAcc}" stroke-width="2" stroke-linecap="round"/>`)}
    ${row(98, false, '')}
    ${row(134, false, '')}
  </g>
  <g class="nw-bob"><g transform="translate(232 36)">
    <path d="M16 0 H86 Q102 0 102 16 V36 Q102 52 86 52 H30 L14 64 L18 52 H16 Q0 52 0 36 V16 Q0 0 16 0 Z" fill="${p.acc}"/>
    <circle class="nw-dot" cx="32" cy="26" r="4.5" fill="${p.onAcc}"/><circle class="nw-dot" style="--d:.2s" cx="51" cy="26" r="4.5" fill="${p.onAcc}"/><circle class="nw-dot" style="--d:.4s" cx="70" cy="26" r="4.5" fill="${p.onAcc}"/>
  </g></g>
  <g transform="translate(244 108)">
    <rect width="78" height="40" rx="14" fill="${p.card}" ${S}/>
    <rect x="14" y="13" width="46" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="14" y="23" width="30" height="5" rx="2.5" fill="${p.lite}"/>
  </g>`;
}

const WHY_VIEW = '30 0 310 192';
export const AnytimeArt = makeEmptyArt(anytimeArt, WHY_VIEW);
export const PriceArt = makeEmptyArt(priceArt, WHY_VIEW);
export const PaperworkArt = makeEmptyArt(paperworkArt, WHY_VIEW);
export const PocketArt = makeEmptyArt(pocketArt, WHY_VIEW);

/* ────────────────────────────── how it works ───────────────────────────── */

/** 1 — Choose your dates and place: the calendar, and a pin for where you collect. */
function stepDatesArt(dark: boolean): string {
  const p = pal(dark);
  return `
  <g transform="translate(28 30)">${perDayArt(dark)}</g>
  ${accDash('M268 150 C290 150 304 136 306 116', p)}
  <g transform="translate(306 54)">
    <ellipse cx="0" cy="62" rx="14" ry="4" fill="${p.soft}"/>
    <g class="nw-bob"><path d="M0 60 C-5 47 -22 36 -22 20 A22 22 0 0 1 22 20 C22 36 5 47 0 60 Z" fill="${p.acc}" ${inkStroke(p)}/>
    <circle cx="0" cy="19" r="8" fill="${p.card}"/></g>
  </g>`;
}

/** 2 — Pick your car: two cars side by side, the chosen one ticked and priced. */
function stepPickArt(dark: boolean): string {
  const p = pal(dark);
  const id = dark ? 'nwStep2D' : 'nwStep2L';
  const card = (x: number, y: number, w: number, chosen: boolean, n: string) => `
  <g transform="translate(${x} ${y})">
    <rect width="${w}" height="${w * 1.18}" rx="14" fill="${p.card}" stroke="${chosen ? p.acc : p.ink}" stroke-width="${chosen ? 2.6 : 2.2}"/>
    <rect x="10" y="10" width="${w - 20}" height="${w * 0.52}" rx="9" fill="${chosen ? p.soft : p.lite}" opacity="${chosen ? 1 : 0.6}"/>
    <g transform="translate(16 ${w * 0.17}) scale(${(w - 32) / 330})">${carSvg(MONO_PAINT, `${id}${n}`)}</g>
    <rect x="12" y="${w * 0.72}" width="${w * 0.55}" height="7" rx="3.5" fill="${p.ink}"/>
    <rect x="12" y="${w * 0.84}" width="${w * 0.35}" height="6" rx="3" fill="${p.lite}"/>
    <rect x="12" y="${w * 0.97}" width="${w - 24}" height="${w * 0.13}" rx="${w * 0.065}" fill="${chosen ? p.acc : p.lite}"/>
    ${chosen ? badgeTick(w, 0, p) : ''}
  </g>`;
  return `${ground(180, 196, 128, dark)}${card(54, 42, 112, false, 'a')}${card(186, 28, 124, true, 'b')}`;
}

/** 3 — Confirm your details: the licence in a scanner's frame, checked. */
function stepLicenceArt(dark: boolean): string {
  const p = pal(dark);
  const corner = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x} ${y + dy * 18} V${y} H${x + dx * 18}" fill="none" stroke="${p.acc}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `
  ${ground(180, 192, 112, dark)}
  ${corner(84, 36, 1, 1)}${corner(276, 36, -1, 1)}${corner(84, 176, 1, -1)}${corner(276, 176, -1, -1)}
  <g transform="translate(100 52)">
    <rect width="160" height="108" rx="14" fill="${p.card}" ${inkStroke(p)}/>
    <rect x="1.2" y="1.2" width="157.6" height="18" rx="12" fill="${p.soft}"/>
    <rect x="14" y="30" width="40" height="52" rx="8" fill="${p.lite}"/>
    ${avatar(34, 56, 17, p)}
    <rect x="66" y="34" width="70" height="8" rx="4" fill="${p.ink}"/>
    <rect x="66" y="50" width="78" height="6" rx="3" fill="${p.lite}"/>
    <rect x="66" y="62" width="58" height="6" rx="3" fill="${p.lite}"/>
    <rect x="14" y="90" width="120" height="6" rx="3" fill="${p.lite}"/>
  </g>
  <path class="nw-scan" d="M92 104 H268" stroke="${p.acc}" stroke-width="2" opacity=".55"/>
  ${badgeTick(262, 52, p, 0.9)}`;
}

/** 4 — Add any extras: a short list of switches, one on, its price added. */
function stepExtrasArt(dark: boolean): string {
  const p = pal(dark);
  const row = (y: number, on: boolean) => `
    <circle cx="26" cy="${y}" r="10" fill="${on ? p.soft : p.lite}"/>
    <rect x="44" y="${y - 7}" width="${on ? 70 : 60}" height="7" rx="3.5" fill="${on ? p.ink : p.lite}"/>
    <rect x="44" y="${y + 4}" width="44" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="132" y="${y - 10}" width="36" height="20" rx="10" fill="${on ? p.acc : p.lite}"/>
    <circle${on ? ' class="nw-knob"' : ''} cx="${on ? 158 : 142}" cy="${y}" r="7" fill="${p.card}"/>`;
  return `
  ${ground(180, 192, 104, dark)}
  <g transform="translate(86 26)">
    <rect width="184" height="150" rx="16" fill="${p.card}" ${inkStroke(p)}/>
    ${row(36, false)}
    <path d="M12 58 H172" stroke="${p.lite}" stroke-width="1.4"/>
    ${row(80, true)}
    <path d="M12 102 H172" stroke="${p.lite}" stroke-width="1.4"/>
    ${row(124, false)}
  </g>
  <g class="nw-pop" style="--d:.75s"><rect x="246" y="94" width="56" height="26" rx="13" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>
  ${txt(274, 111.5, '+ $12', 11.5, 800, p.onAcc, 'middle')}</g>`;
}

/** 5 — Pay and sign: the card, and the agreement with your signature, both done. */
function stepPaySignArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  return `
  ${ground(180, 192, 116, dark)}
  <g transform="translate(60 80) rotate(-9)">
    <rect width="124" height="78" rx="12" fill="${p.soft}" ${S}/>
    <rect x="14" y="16" width="22" height="16" rx="4" fill="${p.card}" stroke="${p.ink}" stroke-width="1.6"/>
    <rect x="14" y="50" width="62" height="7" rx="3.5" fill="${p.ink}"/>
    <circle cx="98" cy="54" r="9" fill="${p.acc}"/>
  </g>
  <g transform="translate(196 24)">
    <rect width="118" height="152" rx="13" fill="${p.card}" ${S}/>
    <rect x="14" y="18" width="62" height="7" rx="3.5" fill="${p.ink}"/>
    <rect x="14" y="36" width="90" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="14" y="48" width="84" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="14" y="60" width="90" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="12" y="84" width="94" height="44" rx="10" fill="${p.soft}"/>
    ${drawn(`d="M22 116 C28 98 34 124 42 108 S54 98 60 112 S70 116 80 100" fill="none" stroke="${p.acc}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`)}
    ${badgeTick(118, 0, p, 1.5)}
  </g>
  ${accDash('M186 118 C192 112 194 108 196 104', p)}`;
}

/** 6 — Collect your keys: the car, and someone holding the keys out to you. */
function stepKeysArt(dark: boolean): string {
  const p = pal(dark);
  const id = dark ? 'nwStep6D' : 'nwStep6L';
  return `
  <ellipse cx="160" cy="184" rx="150" ry="18" fill="${p.soft}"/>
  <g transform="translate(296 40) scale(0.56)">${keeper(0, 0, p, dark)}</g>
  <g class="nw-roll-in"><g transform="translate(22 70) scale(0.78)">${carSvg(MONO_PAINT, `${id}car`)}</g></g>`;
}

const STEP_VIEW = '30 10 300 196';
export const StepDatesArt = makeEmptyArt(stepDatesArt, STEP_VIEW);
export const StepPickArt = makeEmptyArt(stepPickArt, STEP_VIEW);
export const StepLicenceArt = makeEmptyArt(stepLicenceArt, STEP_VIEW);
export const StepExtrasArt = makeEmptyArt(stepExtrasArt, STEP_VIEW);
export const StepPaySignArt = makeEmptyArt(stepPaySignArt, STEP_VIEW);
export const StepKeysArt = makeEmptyArt(stepKeysArt, STEP_VIEW);

/* ──────────────────────────────── questions ────────────────────────────── */

/**
 * "Ask us": a chat with your question in grey and our answer in the accent,
 * ticked, and a question mark beside it — questions get answered here.
 */
function askArt(dark: boolean): string {
  const p = pal(dark);
  const S = inkStroke(p);
  const bar = (x: number, y: number, w: number, fill: string, o = 1) =>
    `<rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${fill}" opacity="${o}"/>`;
  return `
  ${ground(190, 184, 104, dark)}
  <rect x="112" y="16" width="156" height="160" rx="18" fill="${p.card}" ${S}/>
  ${bar(128, 32, 58, p.ink)}
  <circle cx="250" cy="35" r="4.5" fill="${p.acc}"/>
  <path d="M112 52 H268" stroke="${p.lite}" stroke-width="1.6"/>
  <rect x="126" y="66" width="96" height="36" rx="12" fill="${p.soft}"/>
  ${bar(138, 77, 60, p.lite)}${bar(138, 88, 40, p.lite)}
  <rect x="150" y="114" width="104" height="46" rx="12" fill="${p.acc}"/>
  ${bar(164, 127, 70, p.onAcc, 0.9)}${bar(164, 139, 50, p.onAcc, 0.9)}
  ${badgeTick(254, 114, p)}
  <circle cx="76" cy="74" r="26" fill="${p.card}" ${S}/>
  ${txt(76, 84, '?', 28, 800, p.acc, 'middle')}
  ${accDash('M102 80 C110 84 116 84 124 84', p)}
  <circle cx="60" cy="130" r="3.5" fill="${p.lite}"/><circle cx="300" cy="64" r="4" fill="${p.lite}"/>`;
}
export const AskArt = makeEmptyArt(askArt, '36 0 290 196');

/* ───────────────────────────────── the close ───────────────────────────── */

const ROAD: Canvas = { w: 900, h: 200, horizon: 20, colStep: 90 };

/**
 * The closing picture: the hero's car on the hero's floor, with the person
 * holding out the keys — the page ends where the rental does.
 */
function ctaScene(dark: boolean, variant: 'S' | 'W'): string {
  const p = pal(dark);
  const id = `nwCta${variant}${dark ? 'D' : 'L'}`;
  return `${stage(ROAD, p, id, dark, { cx: 450, cy: 188, rx: 330, ry: 30 })}
<g transform="translate(222 4) scale(1.3)">${carSvg(MONO_PAINT, `${id}car`)}</g>
<g transform="translate(726 36) scale(0.62)">${keeper(0, 0, p, dark)}</g>`;
}

export function CtaScene({ className }: { className?: string }) {
  return (
    <div className={cn('w-full', className)}>
      {/* A phone gets the car and the person close up; wider screens get the floor too. */}
      <div className="[mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] sm:hidden">
        {[false, true].map((dark) => (
          <Art key={String(dark)} dark={dark} art={(d) => ctaScene(d, 'S')} viewBox="196 0 580 200" />
        ))}
      </div>
      <div className="hidden sm:block">
        {[false, true].map((dark) => (
          <Art key={String(dark)} dark={dark} art={(d) => ctaScene(d, 'W')} viewBox={`0 0 ${ROAD.w} ${ROAD.h}`} />
        ))}
      </div>
    </div>
  );
}
